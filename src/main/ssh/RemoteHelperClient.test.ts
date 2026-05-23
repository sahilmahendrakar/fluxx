import { describe, expect, it, vi } from 'vitest';
import type { ExecutionDeviceConfig } from '../../types';
import { RemoteHelperClient } from './RemoteHelperClient';
import type { OpenSshRunner } from './opensshRunner';

const sshDevice: ExecutionDeviceConfig = {
  id: 'dev-1',
  kind: 'ssh',
  displayName: 'EC2',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'ec2-test', user: 'ec2-user' },
};

function mockRunner(
  impl: OpenSshRunner['run'],
): OpenSshRunner {
  return { run: vi.fn(impl) };
}

describe('RemoteHelperClient.probe', () => {
  it('parses helper error JSON from stdout when ssh exits non-zero', async () => {
    const runner = mockRunner(async () => ({
      argv: [],
      exitCode: 1,
      signal: null,
      stdout:
        '{"ok":false,"version":"1.0.0","error":{"code":"REMOTE_TMUX_MISSING","message":"tmux was not found on PATH"},"data":{"os":"Linux"}}',
      stderr: '',
      timedOut: false,
    }));
    const client = new RemoteHelperClient({ runner });
    const result = await client.probe(sshDevice, { requireTmux: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('REMOTE_TMUX_MISSING');
      expect(result.message).toBe('tmux was not found on PATH');
    }
  });

  it('maps to SSH failure when stdout is not helper JSON', async () => {
    const runner = mockRunner(async () => ({
      argv: [],
      exitCode: 255,
      signal: null,
      stdout: '',
      stderr: 'Connection reset by peer',
      timedOut: false,
    }));
    const client = new RemoteHelperClient({ runner });
    const result = await client.probe(sshDevice, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SSH_CONNECT_FAILED');
      expect(result.message).toContain('Connection reset');
    }
  });
});
