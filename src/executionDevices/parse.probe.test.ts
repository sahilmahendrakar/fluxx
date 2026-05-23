import { describe, expect, it } from 'vitest';
import { parseExecutionDeviceConfig } from './parse';

describe('parseExecutionDeviceConfig probe fields', () => {
  it('parses extended probe capabilities and error metadata', () => {
    const parsed = parseExecutionDeviceConfig({
      id: 'devbox',
      kind: 'ssh',
      displayName: 'Devbox',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tmux: { enabled: true },
      workspaceRoot: '~/.fluxx/workspaces',
      ssh: { host: 'devbox' },
      lastProbe: {
        status: 'unavailable',
        checkedAt: '2026-01-02T00:00:00.000Z',
        message: 'tmux missing',
        phase: 'probe',
        errorCode: 'REMOTE_TMUX_MISSING',
        helperVersion: '0.1.0',
        capabilities: {
          os: 'Linux',
          git: { found: true },
          tmux: { found: false },
        },
      },
    });
    expect(parsed?.lastProbe?.errorCode).toBe('REMOTE_TMUX_MISSING');
    expect(parsed?.lastProbe?.capabilities?.git?.found).toBe(true);
    expect(parsed?.lastProbe?.capabilities?.tmux?.found).toBe(false);
  });
});
