import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tmuxAvailability', () => ({
  probeTmuxAvailability: vi.fn(async () => ({ available: true, version: 'tmux 3.4' })),
}));

vi.mock('./tmux/tmuxSpawn', () => ({
  spawnFluxxTmuxSession: vi.fn(async () => undefined),
}));

vi.mock('./tmux/tmuxCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tmux/tmuxCommands')>();
  return {
    ...actual,
    tmuxKillSession: vi.fn(async () => undefined),
  };
});

const ptyState = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (info: { exitCode: number }) => void) => void;
    emitData: (data: string) => void;
  }>,
  calls: [] as Array<{ command: string; args: string[] }>,
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn((command: string, args: string[]) => {
    let dataCb: ((data: string) => void) | undefined;
    const fake = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (data: string) => void) => {
        dataCb = cb;
      },
      onExit: () => undefined,
      emitData: (data: string) => dataCb?.(data),
    };
    ptyState.calls.push({ command, args });
    ptyState.instances.push(fake);
    return fake;
  }),
}));

import path from 'node:path';
import { wrapAsXtermBracketedPaste } from './sessionInputDebug';
import { tmuxKillSession } from './tmux/tmuxCommands';
import { setFluxxTmuxConfigPathOverride } from './tmux/resolveFluxxTmuxConfigPath';
import { tmuxAttachWriteSettleMs } from './tmux/tmuxAttachWriteSettle';

const fluxxTmuxConf = path.resolve(process.cwd(), 'resources', 'fluxx-tmux.conf');

describe('TerminalRuntimeManager tmux', () => {
  beforeEach(() => {
    setFluxxTmuxConfigPathOverride(fluxxTmuxConf);
    ptyState.instances.length = 0;
    ptyState.calls.length = 0;
    vi.mocked(tmuxKillSession).mockClear();
  });

  it('reuses one attach bridge across repeated attach snapshots', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: vi.fn(),
      resolveTerminalRuntimeContext: () => ({
        persistTerminalsWithTmux: true,
        projectSlugSource: 'demo',
      }),
      tmuxSpawnLauncherPath: '/launcher.cjs',
    });

    const created = await mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'demo',
      agent: 'claude-code',
      command: 'echo',
      args: ['hi'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in created)) throw new Error('expected session');

    const attachCallsBefore = ptyState.calls.filter((c) => c.command === 'tmux').length;
    expect(attachCallsBefore).toBe(1);
    expect(ptyState.calls[0]?.args).toEqual([
      '-L',
      'fluxx',
      '-f',
      fluxxTmuxConf,
      'attach-session',
      '-t',
      expect.stringMatching(/^fluxx-task-/),
    ]);

    await mgr.attachSession(created.id);
    await mgr.attachSession(created.id);
    const attachCallsAfter = ptyState.calls.filter((c) => c.command === 'tmux').length;
    expect(attachCallsAfter).toBe(1);
  });

  it('releaseRegistriesForAppQuit detaches tmux without killing sessions', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: vi.fn(),
      resolveTerminalRuntimeContext: () => ({
        persistTerminalsWithTmux: true,
        projectSlugSource: 'demo',
      }),
      tmuxSpawnLauncherPath: '/launcher.cjs',
    });

    const created = await mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'demo',
      agent: 'claude-code',
      command: 'sleep',
      args: ['9'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in created)) throw new Error('expected session');

    const attachPty = ptyState.instances.find((_, i) => ptyState.calls[i]?.command === 'tmux');
    expect(attachPty).toBeDefined();

    await mgr.gracefulShutdownForAppQuit(200);

    expect(tmuxKillSession).not.toHaveBeenCalled();
    expect(attachPty?.kill).toHaveBeenCalled();
    expect(attachPty?.write).not.toHaveBeenCalledWith('\x03');
    expect(mgr.listSessions()).toEqual([]);
  });

  it('writeSessionAwait pauses between paste and submit on tmux attach bridge', async () => {
    const graceful = await import('./gracefulAgentExit');
    const sleepSpy = vi.spyOn(graceful, 'sleepMs').mockResolvedValue(undefined);

    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: vi.fn(),
      resolveTerminalRuntimeContext: () => ({
        persistTerminalsWithTmux: true,
        projectSlugSource: 'demo',
      }),
      tmuxSpawnLauncherPath: '/launcher.cjs',
    });

    const created = await mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'demo',
      agent: 'claude-code',
      command: 'echo',
      args: ['hi'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in created)) throw new Error('expected session');

    const attachIdx = ptyState.calls.findIndex((c) => c.command === 'tmux');
    expect(attachIdx).toBeGreaterThanOrEqual(0);
    const attachPty = ptyState.instances[attachIdx];

    const paste = wrapAsXtermBracketedPaste('line one\nline two');
    await mgr.writeSessionAwait(created.id, paste);
    await mgr.writeSessionAwait(created.id, '\r');

    expect(sleepSpy).toHaveBeenCalledWith(tmuxAttachWriteSettleMs(paste));
    expect(sleepSpy).toHaveBeenCalledWith(tmuxAttachWriteSettleMs('\r'));
    expect(attachPty.write.mock.calls.map(([d]) => d)).toEqual([paste, '\r']);

    sleepSpy.mockRestore();
  });

  it('stopSession kills tmux session for explicit cleanup', async () => {
    const { TerminalRuntimeManager } = await import('./TerminalRuntimeManager');
    const mgr = new TerminalRuntimeManager({
      deliverStreamFrame: vi.fn(),
      resolveTerminalRuntimeContext: () => ({
        persistTerminalsWithTmux: true,
        projectSlugSource: 'demo',
      }),
      tmuxSpawnLauncherPath: '/launcher.cjs',
    });

    const created = await mgr.createSession({
      worktreePath: '/tmp/wt',
      branch: 'main',
      taskId: 't1',
      projectId: 'demo',
      agent: 'claude-code',
      command: 'sleep',
      args: ['9'],
      cols: 40,
      rows: 12,
    });
    if (!('id' in created)) throw new Error('expected session');

    const meta = mgr.getTerminalRuntimeMeta(created.id, 'session');
    expect(meta?.runtime).toBe('tmux');
    expect(meta?.tmuxSessionName).toMatch(/^fluxx-task-/);

    mgr.stopSession(created.id);
    expect(tmuxKillSession).toHaveBeenCalledWith(meta?.tmuxSessionName);
  });
});
