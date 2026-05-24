import { describe, expect, it, vi } from 'vitest';
import type { ExecutionDeviceConfig } from '../../types';
import { DeviceProbeService } from './DeviceProbeService';
import type { DeviceStore } from '../DeviceStore';
import type { RemoteHelperClient } from './RemoteHelperClient';
import { FLUXX_REMOTE_HELPER_VERSION } from '../../remoteHelper/constants';

const sshDevice: ExecutionDeviceConfig = {
  id: 'dev-1',
  kind: 'ssh',
  displayName: 'Devbox',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'devbox' },
};

function mockStore(device: ExecutionDeviceConfig | null): DeviceStore {
  return {
    getDevice: vi.fn(() => device),
    setLastProbe: vi.fn(async () => device!),
  } as unknown as DeviceStore;
}

describe('DeviceProbeService', () => {
  it('persists available probe results with capabilities', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({ ok: true as const, version: FLUXX_REMOTE_HELPER_VERSION })),
      probe: vi.fn(async () => ({
        ok: true as const,
        version: FLUXX_REMOTE_HELPER_VERSION,
        capabilities: { os: 'Darwin', git: { found: true } },
      })),
    } as unknown as RemoteHelperClient;
    const store = mockStore(sshDevice);
    const service = new DeviceProbeService(store, {
      projectStore: {} as never,
      bindingStore: {} as never,
      activeKey: null,
    }, helper);

    const result = await service.probeDevice('dev-1');
    expect(result.status).toBe('available');
    expect(result.capabilities?.os).toBe('Darwin');
    expect(store.setLastProbe).toHaveBeenCalledTimes(2);
  });

  it('marks probe available when no agent CLIs are detected', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({ ok: true as const, version: FLUXX_REMOTE_HELPER_VERSION })),
      probe: vi.fn(async () => ({
        ok: true as const,
        version: FLUXX_REMOTE_HELPER_VERSION,
        capabilities: {
          agents: [
            { command: 'claude', found: false },
            { command: 'agent', found: false },
            { command: 'codex', found: false },
          ],
        },
      })),
    } as unknown as RemoteHelperClient;
    const store = mockStore(sshDevice);
    const service = new DeviceProbeService(store, {
      projectStore: {} as never,
      bindingStore: {} as never,
      activeKey: null,
    }, helper);

    const result = await service.probeDevice('dev-1');
    expect(result.status).toBe('available');
    expect(result.message).toContain('no agent CLIs detected');
  });

  it('maps helper handshake auth failures to actionable probe errors', async () => {
    const helper = {
      ensureInstalled: vi.fn(async () => ({
        ok: false as const,
        phase: 'helper-handshake' as const,
        message: 'Devbox (devbox) (SSH_AUTH_FAILED): Permission denied',
      })),
      probe: vi.fn(),
    } as unknown as RemoteHelperClient;
    const store = mockStore(sshDevice);
    const service = new DeviceProbeService(store, {
      projectStore: {} as never,
      bindingStore: {} as never,
      activeKey: null,
    }, helper);

    const result = await service.probeDevice('dev-1');
    expect(result.status).toBe('unavailable');
    expect(result.errorCode).toBe('SSH_AUTH_FAILED');
    expect(result.phase).toBe('helper-handshake');
  });
});
