import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildOpenSshArgv,
  buildRemoteHelperShellCommand,
  createOpenSshRunner,
  defaultProbeTimeoutMs,
  wrapRemoteShellScript,
} from './opensshRunner';

describe('buildOpenSshArgv', () => {
  it('builds argv with host alias, user, port, timeout, extra args, and remote command', () => {
    const argv = buildOpenSshArgv({
      ssh: {
        host: 'devbox',
        user: 'builder',
        port: 2222,
        connectTimeoutSeconds: 12,
        extraArgs: ['-o', 'BatchMode=yes'],
      },
      remoteCommand: buildRemoteHelperShellCommand('probe'),
    });
    expect(argv).toEqual([
      'ssh',
      '-o',
      'ConnectTimeout=12',
      '-p',
      '2222',
      '-o',
      'BatchMode=yes',
      'builder@devbox',
      '--',
      wrapRemoteShellScript('"$HOME/.fluxx/bin/fluxx-remote-helper" probe --json'),
    ]);
  });

  it('wraps bootstrap mkdir in a single remote sh -c argument', () => {
    const argv = buildOpenSshArgv({
      ssh: { host: 'ec2-test' },
      remoteCommand: ['sh', '-c', 'mkdir -p "$HOME/.fluxx/bin"'],
    });
    expect(argv[argv.length - 1]).toBe(wrapRemoteShellScript('mkdir -p "$HOME/.fluxx/bin"'));
  });

  it('adds ForwardAgent=yes when forwardAgent is enabled', () => {
    const argv = buildOpenSshArgv({
      ssh: { host: 'ec2-test', forwardAgent: true },
      remoteCommand: ['true'],
    });
    expect(argv).toContain('-o');
    expect(argv).toContain('ForwardAgent=yes');
  });

  it('does not inject shell metacharacters from host alias into separate argv slots', () => {
    const argv = buildOpenSshArgv({
      ssh: { host: 'devbox;rm -rf /' },
      remoteCommand: ['echo', 'ok'],
    });
    expect(argv).toContain('devbox;rm -rf /');
    expect(argv[argv.length - 2]).toBe('echo');
    expect(argv[argv.length - 1]).toBe('ok');
  });
});

describe('defaultProbeTimeoutMs', () => {
  it('extends connect timeout with probe budget', () => {
    expect(defaultProbeTimeoutMs({ host: 'x', connectTimeoutSeconds: 10 })).toBeGreaterThanOrEqual(
      60_000,
    );
  });
});

describe('createOpenSshRunner', () => {
  it('times out long-running ssh commands', async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: () => void; end: () => void };
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.kill = vi.fn(() => {
        setTimeout(() => child.emit('close', null, 'SIGTERM'), 0);
      });
      return child as never;
    });
    const runner = createOpenSshRunner({ spawnFn });
    const result = await runner.run({ argv: ['ssh', 'host', '--', 'true'], timeoutMs: 20 });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('');
  });

  it('captures stdout from completed commands', async () => {
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: () => void; end: () => void };
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.kill = vi.fn();
      setTimeout(() => {
        child.stdout.emit('data', '{"ok":true}\n');
        child.emit('close', 0, null);
      }, 5);
      return child as never;
    });
    const runner = createOpenSshRunner({ spawnFn });
    const result = await runner.run({ argv: ['ssh', 'host', '--', 'true'], timeoutMs: 500 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('{"ok":true}');
  });
});
