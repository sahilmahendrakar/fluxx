import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  mergeCloudTasksWithLocalDeviceOverrides,
  stripPrivateExecutionDeviceFromFirestoreTask,
} from './mergeCloudTaskDevices';

const baseTask = (id: string): Task => ({
  id,
  title: 't',
  status: 'backlog',
  agent: 'cursor',
  createdAt: '2026-01-01T00:00:00.000Z',
  projectId: 'p1',
});

describe('mergeCloudTasksWithLocalDeviceOverrides', () => {
  it('applies override without mutating unrelated tasks', () => {
    const tasks = [baseTask('a'), baseTask('b')];
    const merged = mergeCloudTasksWithLocalDeviceOverrides(tasks, {
      a: { kind: 'ssh', deviceId: 'devbox' },
    });
    expect(merged[0].executionDevice).toEqual({ kind: 'ssh', deviceId: 'devbox' });
    expect(merged[1].executionDevice).toBeUndefined();
  });
});

describe('stripPrivateExecutionDeviceFromFirestoreTask', () => {
  it('removes private ssh/local refs from shared task rows', () => {
    const task = {
      ...baseTask('x'),
      executionDevice: { kind: 'ssh' as const, deviceId: 'devbox' },
    };
    const stripped = stripPrivateExecutionDeviceFromFirestoreTask(task);
    expect(stripped.executionDevice).toBeUndefined();
  });

  it('keeps shared runner refs', () => {
    const task = {
      ...baseTask('x'),
      executionDevice: {
        kind: 'runner' as const,
        deviceId: 'r1',
        ownerUid: 'u1',
      },
    };
    expect(stripPrivateExecutionDeviceFromFirestoreTask(task).executionDevice).toEqual(
      task.executionDevice,
    );
  });
});
