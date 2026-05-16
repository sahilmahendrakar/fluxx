import { describe, expect, it } from 'vitest';
import type { Task } from '../../types';
import {
  applyProviderSnapshotWithPending,
  mergeServerTaskWithPendingPatchOntoLocal,
} from './mergePendingTaskSnapshot';

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Task',
  status: 'backlog',
  agent: 'claude-code',
  createdAt: '1',
  projectId: 'p1',
  ...over,
});

describe('mergeServerTaskWithPendingPatchOntoLocal', () => {
  it('re-applies pending description over a stale snapshot row', () => {
    const local = baseTask({ description: 'D1' });
    const server = baseTask({ description: 'D0' });
    const merged = mergeServerTaskWithPendingPatchOntoLocal(local, server, {
      description: 'D1',
    });
    expect(merged.description).toBe('D1');
  });
});

describe('applyProviderSnapshotWithPending', () => {
  it('preserves optimistic description when snapshot is behind pending patch', () => {
    const local = [baseTask({ description: 'D1' })];
    const server = [baseTask({ description: 'D0' })];
    const pending = new Map([['t1', { patch: { description: 'D1' } }]]);
    const merged = applyProviderSnapshotWithPending(server, local, pending);
    expect(merged[0]?.description).toBe('D1');
  });

  it('uses server truth when there is no pending patch', () => {
    const local = [baseTask({ description: 'stale-local' })];
    const server = [baseTask({ description: 'from-server' })];
    const merged = applyProviderSnapshotWithPending(server, local, new Map());
    expect(merged[0]?.description).toBe('from-server');
  });
});
