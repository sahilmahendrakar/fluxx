import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tmuxAvailability', () => ({
  probeTmuxAvailability: vi.fn(async () => ({ available: true, version: 'tmux 3.4' })),
}));

vi.mock('./tmuxSpawn', () => ({
  spawnFluxxTmuxSession: vi.fn(async () => undefined),
}));

const ptyState = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (info: { exitCode: number }) => void) => void;
    emitData: (data: string) => void;
  }>,
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
    ptyState.instances.push(fake);
    if (command === 'tmux') {
      expect(args[0]).toBe('-L');
      expect(args[1]).toBe(process.env.FLUXX_TMUX_SOCKET_NAME ?? 'fluxx');
      expect(args[2]).toBe('-f');
      expect(args[4]).toBe('attach-session');
      expect(args[5]).toBe('-t');
      expect(args[6]).toMatch(/^fluxx-/);
    }
    return fake;
  }),
}));

import { spawnFluxxTmuxSession } from './tmuxSpawn';
import { createTerminalRuntime, shouldUseTmuxRuntime } from './terminalRuntimeFactory';

describe('terminalRuntimeFactory', () => {
  const priorEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...priorEnv };
    delete process.env.FLUX_AUX_DEV_SERVER_PORT;
    delete process.env.FLUXX_TMUX_SOCKET_NAME;
    ptyState.instances.length = 0;
    vi.mocked(spawnFluxxTmuxSession).mockClear();
  });

  it('selects direct PTY when persist setting is off', async () => {
    expect(
      await shouldUseTmuxRuntime({
        kind: 'task',
        terminalId: 't1',
        projectSlugSource: 'demo',
        persistTerminalsWithTmux: false,
        tmuxSpawnLauncherPath: '/launcher.cjs',
      }),
    ).toBe(false);
    const { runtime, tmuxSessionName } = await createTerminalRuntime(
      {
        kind: 'task',
        terminalId: 't1',
        projectSlugSource: 'demo',
        persistTerminalsWithTmux: false,
        tmuxSpawnLauncherPath: '/launcher.cjs',
      },
      { command: 'echo', args: ['hi'], cwd: '/tmp', cols: 40, rows: 12 },
      { onData: () => undefined, onExit: () => undefined },
    );
    expect(tmuxSessionName).toBeUndefined();
    expect(runtime.isTmuxBacked).toBe(false);
    expect(spawnFluxxTmuxSession).not.toHaveBeenCalled();
  });

  it('selects tmux runtime when setting is on and tmux is available', async () => {
    const { runtime, tmuxSessionName } = await createTerminalRuntime(
      {
        kind: 'planning',
        terminalId: 'p1',
        projectSlugSource: 'My Project',
        persistTerminalsWithTmux: true,
        tmuxSpawnLauncherPath: '/launcher.cjs',
      },
      { command: 'agent', args: [], cwd: '/tmp/plan', cols: 50, rows: 10 },
      { onData: () => undefined, onExit: () => undefined },
    );
    expect(runtime.isTmuxBacked).toBe(true);
    expect(tmuxSessionName).toMatch(/^fluxx-planning-/);
    expect(spawnFluxxTmuxSession).toHaveBeenCalledOnce();
    expect(ptyState.instances.length).toBeGreaterThan(0);
  });

  it('uses tmux on aux dev with the isolated fluxx-aux socket', async () => {
    process.env.FLUX_AUX_DEV_SERVER_PORT = '5180';
    process.env.FLUXX_TMUX_SOCKET_NAME = 'fluxx-aux';
    expect(
      await shouldUseTmuxRuntime({
        kind: 'task',
        terminalId: 't1',
        projectSlugSource: 'demo',
        persistTerminalsWithTmux: true,
        tmuxSpawnLauncherPath: '/launcher.cjs',
      }),
    ).toBe(true);
    const { runtime, tmuxSessionName } = await createTerminalRuntime(
      {
        kind: 'task',
        terminalId: 't1',
        projectSlugSource: 'demo',
        persistTerminalsWithTmux: true,
        tmuxSpawnLauncherPath: '/launcher.cjs',
      },
      { command: 'echo', args: ['hi'], cwd: '/tmp', cols: 40, rows: 12 },
      { onData: () => undefined, onExit: () => undefined },
    );
    expect(tmuxSessionName).toMatch(/^fluxx-task-/);
    expect(runtime.isTmuxBacked).toBe(true);
    expect(spawnFluxxTmuxSession).toHaveBeenCalledOnce();
    expect(ptyState.instances.length).toBeGreaterThan(0);
  });
});
