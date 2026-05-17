import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ptyState = vi.hoisted(() => ({
  calls: [] as Array<{
    command: string;
    args: string[];
    options: { env?: Record<string, string | undefined> };
  }>,
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn((command: string, args: string[], options: { env?: Record<string, string | undefined> }) => {
    ptyState.calls.push({ command, args, options });
    return {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
  }),
}));

const originalEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  SHELL: process.env.SHELL,
};

describe('TerminalRuntimeManager planning PTY env', () => {
  beforeEach(() => {
    ptyState.calls = [];
    process.env.HOME = '/Users/dev';
    process.env.PATH = '/usr/bin';
    process.env.SHELL = '/bin/zsh';
  });

  afterEach(() => {
    if (originalEnv.HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalEnv.HOME;
    }
    if (originalEnv.PATH === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalEnv.PATH;
    }
    if (originalEnv.SHELL === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalEnv.SHELL;
    }
  });

  it('overlays Flux CLI bridge vars without dropping agent auth env', async () => {
    const { TerminalRuntimeManager } = await import('../main/TerminalRuntimeManager');
    const terminalRuntime = new TerminalRuntimeManager({ deliverStreamFrame: () => undefined });

    const result = terminalRuntime.startPlanning({
      projectId: 'project-1',
      agent: 'claude-code',
      planningDir: '/tmp/planning',
      command: 'claude',
      args: [],
      cols: 80,
      rows: 24,
      ptyEnv: {
        FLUX_AUTOMATION_URL: 'http://127.0.0.1:1234',
        FLUX_AUTOMATION_TOKEN: 'token',
        PATH: '/flux-cli:/usr/bin',
      },
    });

    expect(result).toMatchObject({ projectId: 'project-1', status: 'running' });
    const env = ptyState.calls[0].options.env;
    expect(env?.HOME).toBe('/Users/dev');
    expect(env?.SHELL).toBe('/bin/zsh');
    expect(env?.FLUX_AUTOMATION_URL).toBe('http://127.0.0.1:1234');
    expect(env?.FLUX_AUTOMATION_TOKEN).toBe('token');
    expect(env?.PATH).toBe('/flux-cli:/usr/bin');
  });
});
