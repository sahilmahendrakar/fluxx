import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFluxxTmuxArgv } from './tmuxCommands';
import {
  resolveFluxxTmuxConfigPath,
  setFluxxTmuxConfigPathOverride,
} from './resolveFluxxTmuxConfigPath';

describe('buildFluxxTmuxArgv', () => {
  afterEach(() => {
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
});

describe('resolveFluxxTmuxConfigPath', () => {
  it('resolves resources/fluxx-tmux.conf in dev', () => {
    const resolved = resolveFluxxTmuxConfigPath();
    expect(resolved).toMatch(/fluxx-tmux\.conf$/);
    expect(resolved).toContain('resources');
  });
});
