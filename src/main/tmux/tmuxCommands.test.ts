import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFluxxTmuxArgv,
  FLUXX_TMUX_AUX_SOCKET_NAME,
  FLUXX_TMUX_SOCKET_NAME,
  FLUXX_TMUX_SOCKET_NAME_ENV,
  resolveFluxxTmuxSocketName,
} from './tmuxCommands';
import {
  resolveFluxxTmuxConfigPath,
  setFluxxTmuxConfigPathOverride,
} from './resolveFluxxTmuxConfigPath';

describe('buildFluxxTmuxArgv', () => {
  const priorEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...priorEnv };
    setFluxxTmuxConfigPathOverride(undefined);
  });

  it('prefixes subcommands with -f and the bundled fluxx-tmux.conf path', () => {
    const configPath = path.resolve(process.cwd(), 'resources', 'fluxx-tmux.conf');
    setFluxxTmuxConfigPathOverride(configPath);
    expect(buildFluxxTmuxArgv(['new-session', '-d', '-s', 'fluxx-task-demo-abc'])).toEqual([
      '-L',
      'fluxx',
      '-f',
      configPath,
      'new-session',
      '-d',
      '-s',
      'fluxx-task-demo-abc',
    ]);
  });

  it('includes -f for attach-session argv used by the attach bridge', () => {
    const configPath = '/opt/fluxx/fluxx-tmux.conf';
    setFluxxTmuxConfigPathOverride(configPath);
    expect(buildFluxxTmuxArgv(['attach-session', '-t', 'fluxx-shell-p-xyz'])).toEqual([
      '-L',
      'fluxx',
      '-f',
      configPath,
      'attach-session',
      '-t',
      'fluxx-shell-p-xyz',
    ]);
  });

  it('uses FLUXX_TMUX_SOCKET_NAME when set', () => {
    process.env[FLUXX_TMUX_SOCKET_NAME_ENV] = 'fluxx-test';
    delete process.env.FLUX_AUX_DEV_SERVER_PORT;
    expect(resolveFluxxTmuxSocketName()).toBe('fluxx-test');
  });

  it('defaults aux dev to fluxx-aux socket when port env is set', () => {
    delete process.env[FLUXX_TMUX_SOCKET_NAME_ENV];
    process.env.FLUX_AUX_DEV_SERVER_PORT = '5180';
    expect(resolveFluxxTmuxSocketName()).toBe(FLUXX_TMUX_AUX_SOCKET_NAME);
  });

  it('prefers explicit socket env over aux dev default', () => {
    process.env[FLUXX_TMUX_SOCKET_NAME_ENV] = 'custom';
    process.env.FLUX_AUX_DEV_SERVER_PORT = '5180';
    expect(resolveFluxxTmuxSocketName()).toBe('custom');
  });

  it('uses primary socket name by default', () => {
    delete process.env[FLUXX_TMUX_SOCKET_NAME_ENV];
    delete process.env.FLUX_AUX_DEV_SERVER_PORT;
    expect(resolveFluxxTmuxSocketName()).toBe(FLUXX_TMUX_SOCKET_NAME);
  });
});

describe('resolveFluxxTmuxConfigPath', () => {
  it('resolves resources/fluxx-tmux.conf in dev', () => {
    const resolved = resolveFluxxTmuxConfigPath();
    expect(resolved).toMatch(/fluxx-tmux\.conf$/);
    expect(resolved).toContain('resources');
  });
});
