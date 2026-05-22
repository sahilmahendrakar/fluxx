import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { mergeCloudTasksWithLocalDeviceOverrides } from './mergeCloudTaskDevices';

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
