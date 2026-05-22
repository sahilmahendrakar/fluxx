import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSessionRecord } from '../types';

vi.mock('./tmuxAvailability', () => ({
  probeTmuxAvailability: vi.fn(async () => ({ available: true, version: 'tmux 3.4' })),
}));

vi.mock('./tmux/tmuxSpawn', () => ({
  spawnFluxxTmuxSession: vi.fn(async () => undefined),
}));

const tmuxCommands = vi.hoisted(() => ({
  hasSession: vi.fn(async (_name: string) => true),
  listNames: vi.fn(async () => ['fluxx-task-p1-live', 'fluxx-task-p1-untracked']),
  killSession: vi.fn(async () => undefined),
}));

vi.mock('./tmux/tmuxCommands', () => ({
  tmuxHasSession: (name: string) => tmuxCommands.hasSession(name),
  tmuxListSessionNames: () => tmuxCommands.listNames(),
  tmuxKillSession: tmuxCommands.killSession,
}));

const ptyState = vi.hoisted(() => ({
  instances: [] as Array<{ kill: ReturnType<typeof vi.fn> }>,
  calls: [] as Array<{ command: string; args: string[] }>,
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn((command: string, args: string[]) => {
    const fake = { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: () => undefined, onExit: () => undefined };
    ptyState.calls.push({ command, args });
    ptyState.instances.push(fake);
    return fake;
  }),
}));

function taskRecord(id: string, tmuxSessionName: string): TerminalSessionRecord {
  return {
    id,
    kind: 'task',
    runtime: 'tmux',
    projectId: 'p1',
    tmuxSessionName,
    cwd: '/tmp/wt',
    command: 'agent',
    args: [],
    cols: 80,
    rows: 24,
    startedAt: '2026-01-01T00:00:00.000Z',
    task: {
      taskId: 't1',
      agent: 'claude-code',
      worktreePath: '/tmp/wt',
      fluxxWorkBranch: 'fluxx/t1',
    },
  };
}

describe('TerminalRuntimeManager tmux restore', () => {
  beforeEach(() => {
    ptyState.instances.length = 0;
    ptyState.calls.length = 0;
    tmuxCommands.hasSession.mockReset();
    tmuxCommands.hasSession.mockImplementation(async () => true);
    tmuxCommands.listNames.mockReset();
    tmuxCommands.listNames.mockResolvedValue(['fluxx-task-p1-live', 'fluxx-task-p1-untracked']);
    tmuxCommands.killSession.mockClear();
  });

  it('restores live tmux task session into registry', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: vi.fn(),
      resolveTerminalRuntimeContext: () => ({
        persistTerminalsWithTmux: true,
        projectSlugSource: 'p1',
      }),
      tmuxSpawnLauncherPath: '/launcher.cjs',
    });

    const record = taskRecord('live', 'fluxx-task-p1-live');
    const out = await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [record],
      pathStillPresent: async () => true,
    });

    expect(out.restored.task).toBe(1);
    expect(out.missing.task).toBe(0);
    expect(out.restoredSessionTaskPairs).toEqual([{ sessionId: 'live', taskId: 't1' }]);
    expect(mgr.listSessions()).toHaveLength(1);
    expect(mgr.listSessions()[0]?.id).toBe('live');
    expect(ptyState.calls.some((c) => c.command === 'tmux' && c.args.includes('fluxx-task-p1-live'))).toBe(
      true,
    );
    expect(tmuxCommands.killSession).not.toHaveBeenCalled();
  });

  it('classifies tmux-missing task without registering live session', async () => {
    tmuxCommands.hasSession.mockImplementation(async (name: string) => name !== 'fluxx-task-p1-gone');

    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });

    const record = taskRecord('gone', 'fluxx-task-p1-gone');
    const out = await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [record],
      pathStillPresent: async () => true,
    });

    expect(out.restored.task).toBe(0);
    expect(out.missing.task).toBe(1);
    expect(out.missingTerminalRecords.map((r) => r.id)).toEqual(['gone']);
    expect(mgr.listSessions()).toHaveLength(0);
  });

  it('workspace-missing skips restore and does not count as tmux missing', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });

    const record = taskRecord('ws', 'fluxx-task-p1-ws');
    const out = await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [record],
      pathStillPresent: async () => false,
    });

    expect(out.workspaceMissing.task).toBe(1);
    expect(out.missing.task).toBe(0);
    expect(out.workspaceMissingTerminalRecords.map((r) => r.id)).toEqual(['ws']);
    expect(mgr.listSessions()).toHaveLength(0);
  });

  it('reports untracked fluxx- sessions without killing them', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });

    const out = await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [taskRecord('live', 'fluxx-task-p1-live')],
      pathStillPresent: async () => true,
    });

    expect(out.untrackedFluxxSessions).toEqual(['fluxx-task-p1-untracked']);
    expect(tmuxCommands.killSession).not.toHaveBeenCalled();
  });

  it('shell tmux missing is classified without live shell row', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });

    const parent = taskRecord('parent', 'fluxx-task-p1-parent');
    await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [parent],
      pathStillPresent: async () => true,
    });

    tmuxCommands.hasSession.mockImplementation(
      async (name: string) => name !== 'fluxx-shell-p1-shell-1',
    );

    const shell: TerminalSessionRecord = {
      id: 'shell-1',
      kind: 'shell',
      runtime: 'tmux',
      projectId: 'p1',
      tmuxSessionName: 'fluxx-shell-p1-shell-1',
      cwd: '/tmp/wt',
      command: 'bash',
      args: [],
      cols: 80,
      rows: 24,
      startedAt: '2026-01-01T00:00:00.000Z',
      shell: { parentSessionId: 'parent', worktreePath: '/tmp/wt' },
    };

    const out = await mgr.reconcileTmuxPersistedTerminals({
      projectId: 'p1',
      records: [parent, shell],
      pathStillPresent: async () => true,
    });

    expect(out.missing.shell).toBe(1);
    expect(mgr.listShells('parent')).toHaveLength(0);
  });
});
