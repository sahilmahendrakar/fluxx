import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskStore } from './TaskStore';
import { builtInLocalDeviceRef } from '../executionDevices/parse';

describe('TaskStore executionDevice', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('persists executionDevice on create and update', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-device-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      executionDevice: builtInLocalDeviceRef(),
    });
    expect(created.executionDevice).toEqual(builtInLocalDeviceRef());
    const updated = await store.update(created.id, {
      executionDevice: { kind: 'ssh', deviceId: 'devbox' },
    });
    expect(updated.executionDevice).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    const onDisk = JSON.parse(
      await fs.readFile(path.join(dir, 'tasks.json'), 'utf8'),
    ) as Array<{ executionDevice?: unknown }>;
    expect(onDisk[0].executionDevice).toEqual({ kind: 'ssh', deviceId: 'devbox' });
  });

  it('clears executionDevice when patch is null', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-device-clear-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      executionDevice: builtInLocalDeviceRef(),
    });
    const updated = await store.update(created.id, { executionDevice: null });
    expect(updated.executionDevice).toBeUndefined();
  });
});
