import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamFrame } from '../daemon/protocol';

const ptyState = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (info: { exitCode: number; signal?: number }) => void) => void;
    emitData: (data: string) => void;
    emitExit: (exitCode: number, signal?: number) => void;
  }>,
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let dataCb: ((data: string) => void) | undefined;
    let exitCb: ((info: { exitCode: number; signal?: number }) => void) | undefined;
    const fake = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (data: string) => void) => {
        dataCb = cb;
      },
      onExit: (cb: (info: { exitCode: number; signal?: number }) => void) => {
        exitCb = cb;
      },
      emitData: (data: string) => dataCb?.(data),
      emitExit: (exitCode: number, signal?: number) => exitCb?.({ exitCode, signal }),
    };
    ptyState.instances.push(fake);
    return fake;
  }),
}));

describe('TerminalRuntimeManager', () => {
  beforeEach(() => {
    ptyState.instances.length = 0;
  });

  it('create/list/attach/write/resize/stop session with mocked PTY', async () => {
    const frames: StreamFrame[] = [];
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: (f) => frames.push(f),
    });

    const created = mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'p1',
      agent: 'claude-code',
      command: 'echo',
      args: ['hi'],
      cols: 40,
      rows: 12,
    });
    expect('id' in created).toBe(true);
    if (!('id' in created)) return;
    const { id } = created;

    expect(mgr.listSessions()).toEqual([expect.objectContaining({ id, status: 'running' })]);

    const pty = ptyState.instances[ptyState.instances.length - 1];
    pty.emitData('hello');
    expect(frames.some((f) => f.kind === 'data' && f.target === 'session' && f.id === id)).toBe(
      true,
    );

    const attach = await mgr.attachSession(id);
    expect(attach?.replay).toContain('hello');
    expect(attach?.cols).toBe(40);
    expect(attach?.rows).toBe(12);
    expect(attach?.streamSeq).toBeGreaterThanOrEqual(1);

    mgr.writeSession(id, 'x');
    expect(pty.write).toHaveBeenCalledWith('x');

    mgr.resizeSession(id, 80, 24);
    expect(pty.resize).toHaveBeenCalledWith(80, 24);

    mgr.stopSession(id);
    expect(pty.kill).toHaveBeenCalled();
    expect(mgr.listSessions()).toEqual([]);
  });

  it('emits session-exit with stopped status on zero exit', async () => {
    const frames: StreamFrame[] = [];
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: (f) => frames.push(f) });

    const s = mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'p1',
      agent: 'claude-code',
      command: 'sh',
      args: ['-c', 'true'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in s)) throw new Error('expected session');
    const pty = ptyState.instances[ptyState.instances.length - 1];
    pty.emitExit(0);

    const exit = frames.find((f) => f.kind === 'session-exit');
    expect(exit?.kind === 'session-exit' && exit.session.status).toBe('stopped');
    expect(mgr.listSessions()[0]?.status).toBe('stopped');
  });

  it('emits session-exit with error status on non-zero exit and invokes onSessionExit', async () => {
    const frames: StreamFrame[] = [];
    const exits: unknown[] = [];
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: (f) => frames.push(f),
      onSessionExit: (session) => exits.push(session),
    });

    const s = mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'p1',
      agent: 'claude-code',
      command: 'sh',
      args: ['-c', 'false'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in s)) throw new Error('expected session');
    const pty = ptyState.instances[ptyState.instances.length - 1];
    pty.emitExit(1);

    const exit = frames.find((f) => f.kind === 'session-exit');
    expect(exit?.kind === 'session-exit' && exit.session.status).toBe('error');
    expect(exits).toHaveLength(1);
    expect((exits[0] as { status: string }).status).toBe('error');
  });

  it('emits agent-state silent and calls onAgentState (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const frames: StreamFrame[] = [];
      const agentStates: Array<{ id: string; state: string }> = [];
      const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
      const mgr = new TerminalRuntimeManager({
        deliverStreamFrame: (f) => frames.push(f),
        onAgentState: (id, state) => agentStates.push({ id, state }),
      });

      const s = mgr.createSession({
        worktreePath: '/tmp/wt',
        branch: 'main',
        taskId: 't1',
        projectId: 'p1',
        agent: 'claude-code',
        command: 'sleep',
        args: ['999'],
        cols: 40,
        rows: 12,
      });
      if (!('id' in s)) throw new Error('expected session');

      vi.advanceTimersByTime(10_001);
      const silentFrames = frames.filter((f) => f.kind === 'agent-state');
      expect(silentFrames.some((f) => f.kind === 'agent-state' && f.state === 'silent')).toBe(true);
      expect(agentStates.some((a) => a.state === 'silent' && a.id === s.id)).toBe(true);

      const silence = mgr.getSessionSilenceStates().find((x) => x.id === s.id);
      expect(silence?.state).toBe('silent');

      mgr.stopSession(s.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('planning attach includes session metadata', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });

    const p = mgr.startPlanning({
      projectId: 'p1',
      agent: 'cursor',
      planningDir: '/tmp/plan',
      command: 'true',
      args: [],
      cols: 50,
      rows: 10,
    });
    if ('error' in p) throw new Error(p.message);
    const attach = await mgr.attachPlanning(p.id);
    expect(attach?.session.id).toBe(p.id);
    expect(attach?.session.planningDir).toBe('/tmp/plan');
  });

  it('shell create/list/attach/write/resize/close', async () => {
    const frames: StreamFrame[] = [];
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: (f) => frames.push(f) });

    const shell = mgr.createShell({
      sessionId: 'sess-1',
      worktreePath: '/tmp/wt',
      cols: 30,
      rows: 8,
    });
    expect(mgr.listShells()).toHaveLength(1);
    expect(mgr.listShells('sess-1')).toEqual([expect.objectContaining({ id: shell.id })]);

    const pty = ptyState.instances[ptyState.instances.length - 1];
    pty.emitData('sh-out');
    expect(frames.some((f) => f.kind === 'data' && f.target === 'shell' && f.id === shell.id)).toBe(
      true,
    );

    const attach = await mgr.attachShell(shell.id);
    expect(attach?.replay).toContain('sh-out');

    mgr.writeShell(shell.id, 'ls\n');
    expect(pty.write).toHaveBeenCalledWith('ls\n');
    mgr.resizeShell(shell.id, 100, 20);
    expect(pty.resize).toHaveBeenCalledWith(100, 20);

    mgr.closeShell(shell.id);
    expect(pty.kill).toHaveBeenCalled();
    expect(mgr.listShells()).toHaveLength(0);
  });

  it('wires trust autoresponder when roots + flag are set', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({ deliverStreamFrame: vi.fn() });
    const roots = [path.resolve('/tmp/flux-worktrees')];
    const s = mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'p1',
      agent: 'claude-code',
      command: 'true',
      args: [],
      cols: 40,
      rows: 12,
      trustPromptAutorespond: true,
      trustPromptAutorespondRoots: roots,
    });
    expect('id' in s).toBe(true);
    mgr.stopSession((s as { id: string }).id);
  });
});
