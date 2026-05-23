import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceStore } from './DeviceStore';
import { BUILTIN_LOCAL_DEVICE_ID } from '../executionDevices/constants';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/unused',
  },
}));

describe('DeviceStore', () => {
  let dir: string;
  let filePath: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('bootstraps built-in local device on fresh install', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-device-store-'));
    filePath = path.join(dir, 'executionDevices.json');
    const store = new DeviceStore({ filePath });
    await store.init();
    const devices = store.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe(BUILTIN_LOCAL_DEVICE_ID);
    expect(devices[0].kind).toBe('local');
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      schemaVersion: number;
      devices: unknown[];
    };
    expect(raw.schemaVersion).toBe(1);
    expect(raw.devices).toHaveLength(1);
  });

  it('migrates tmux preference into synthesized local device', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-device-store-tmux-'));
    filePath = path.join(dir, 'executionDevices.json');
    const store = new DeviceStore({ filePath });
    await store.init({ legacyLocalTmuxEnabled: true });
    expect(store.getBuiltInLocalDevice().tmux.enabled).toBe(true);
  });

  it('creates, updates, and removes ssh devices', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-device-store-crud-'));
    filePath = path.join(dir, 'executionDevices.json');
    const store = new DeviceStore({ filePath });
    await store.init();
    const created = await store.createSshDevice({
      displayName: 'GPU box',
      host: 'gpu',
      workspaceRoot: '~/.fluxx/workspaces',
      tmuxEnabled: true,
    });
    expect(created.kind).toBe('ssh');
    expect(created.ssh?.host).toBe('gpu');
    const withAgent = await store.updateDevice(created.id, { forwardAgent: true });
    expect(withAgent.ssh?.forwardAgent).toBe(true);
    const withoutAgent = await store.updateDevice(created.id, { forwardAgent: false });
    expect(withoutAgent.ssh?.forwardAgent).toBeUndefined();
    const updated = await store.updateDevice(created.id, {
      displayName: 'GPU Box',
      enabled: false,
    });
    expect(updated.displayName).toBe('GPU Box');
    expect(updated.enabled).toBe(false);
    await store.removeDevice(created.id);
    expect(store.listDevices().some((d) => d.id === created.id)).toBe(false);
  });

  it('persists global default device id', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-device-store-default-'));
    filePath = path.join(dir, 'executionDevices.json');
    const store = new DeviceStore({ filePath });
    await store.init();
    await store.setGlobalDefaultDeviceId('local');
    expect(store.getGlobalDefaultDeviceId()).toBe('local');
    const reloaded = new DeviceStore({ filePath });
    await reloaded.init();
    expect(reloaded.getGlobalDefaultDeviceId()).toBe('local');
  });
});
