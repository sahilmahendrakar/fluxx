import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalBindingStore } from './LocalBindingStore';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? '/tmp/flux-test-userdata' : '/tmp'),
  },
}));

describe('LocalBindingStore device overrides', () => {
  let filePath: string;

  afterEach(async () => {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  });

  it('round-trips per-task device overrides and project default', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-bindings-'));
    filePath = path.join(dir, 'localBindings.json');
    const store = new LocalBindingStore();
    (store as unknown as { filePath: string }).filePath = filePath;
    await store.init();
    await store.set('cloud-1', '/tmp/repo');
    await store.setDefaultDeviceId('cloud-1', 'devbox');
    await store.setPerTaskDeviceOverride('cloud-1', 'task-a', {
      kind: 'ssh',
      deviceId: 'devbox',
    });
    expect(store.getDefaultDeviceId('cloud-1')).toBe('devbox');
    expect(store.getPerTaskDeviceOverride('cloud-1', 'task-a')).toEqual({
      kind: 'ssh',
      deviceId: 'devbox',
    });
    const reloaded = new LocalBindingStore();
    (reloaded as unknown as { filePath: string }).filePath = filePath;
    await reloaded.init();
    expect(reloaded.getPerTaskDeviceOverrides('cloud-1')).toEqual({
      'task-a': { kind: 'ssh', deviceId: 'devbox' },
    });
    await reloaded.setPerTaskDeviceOverride('cloud-1', 'task-a', null);
    expect(reloaded.getPerTaskDeviceOverride('cloud-1', 'task-a')).toBeUndefined();
  });
});
