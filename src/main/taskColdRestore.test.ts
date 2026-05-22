import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { mergeTaskSessionsWithColdResume } from './planningColdRestore';

describe('mergeTaskSessionsWithColdResume', () => {
  const live: Session[] = [
    {
      id: 'live-1',
      taskId: 't1',
      projectId: 'p1',
      worktreePath: '/wt',
      branch: 'b',
      status: 'running',
      startedAt: '2020-01-01T00:00:00.000Z',
    },
  ];

  const cold: Session[] = [
    {
      id: 'cold-1',
      taskId: 't2',
      projectId: 'p1',
      worktreePath: '/wt2',
      branch: 'b2',
      status: 'interrupted',
      startedAt: '2020-01-02T00:00:00.000Z',
      stoppedAt: '2020-01-02T01:00:00.000Z',
    },
    {
      id: 'live-1',
      taskId: 't1',
      projectId: 'p1',
      worktreePath: '/wt',
      branch: 'b',
      status: 'interrupted',
      startedAt: '2020-01-01T00:00:00.000Z',
    },
  ];

  it('appends cold rows without duplicating live ids', () => {
    const merged = mergeTaskSessionsWithColdResume(live, cold);
    expect(merged.map((s) => s.id)).toEqual(['live-1', 'cold-1']);
  });
});
