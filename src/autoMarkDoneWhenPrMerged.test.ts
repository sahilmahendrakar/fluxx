import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
  githubPrIndicatesMerged,
  shouldAutoMarkDoneAfterPrMergeRefresh,
} from './autoMarkDoneWhenPrMerged';

function baseTask(over: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'T',
    status: 'in-progress',
    agent: 'cursor',
    createdAt: '2020-01-01T00:00:00.000Z',
    projectId: 'p1',
    githubPr: { url: 'https://github.com/o/r/pull/1' },
    ...over,
  };
}

describe('githubPrIndicatesMerged', () => {
  it('is true for state merged', () => {
    expect(githubPrIndicatesMerged({ url: 'u', state: 'merged' })).toBe(true);
  });
  it('is true when mergedAt is set', () => {
    expect(githubPrIndicatesMerged({ url: 'u', mergedAt: '2024-01-02' })).toBe(true);
  });
  it('is false for open', () => {
    expect(githubPrIndicatesMerged({ url: 'u', state: 'open' })).toBe(false);
  });
  it('is false when undefined', () => {
    expect(githubPrIndicatesMerged(undefined)).toBe(false);
  });
});

describe('shouldAutoMarkDoneAfterPrMergeRefresh', () => {
  const mergedPr = { url: 'https://github.com/o/r/pull/1', state: 'merged' as const };

  it('returns false when pref off', () => {
    const task = baseTask({});
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: false,
        allTasks: [task],
      }),
    ).toBe(false);
  });

  it('returns false for backlog', () => {
    const task = baseTask({ status: 'backlog' });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: true,
        allTasks: [task],
      }),
    ).toBe(false);
  });

  it('returns false when blocked', () => {
    const blocker = baseTask({ id: 'b', status: 'in-progress' });
    const task = baseTask({ blockedByTaskIds: ['b'] });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: true,
        allTasks: [blocker, task],
      }),
    ).toBe(false);
  });

  it('returns false without PR URL', () => {
    const task = baseTask({ githubPr: undefined });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: { url: '' },
        prefEnabled: true,
        allTasks: [task],
      }),
    ).toBe(false);
  });

  it('returns true for in-progress, merged, pref on, not blocked', () => {
    const task = baseTask({ status: 'in-progress' });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: true,
        allTasks: [task],
      }),
    ).toBe(true);
  });

  it('returns true for needs-input', () => {
    const task = baseTask({ status: 'needs-input' });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: true,
        allTasks: [task],
      }),
    ).toBe(true);
  });

  it('returns true for review', () => {
    const task = baseTask({ status: 'review' });
    expect(
      shouldAutoMarkDoneAfterPrMergeRefresh({
        task,
        refreshedGithubPr: mergedPr,
        prefEnabled: true,
        allTasks: [task],
      }),
    ).toBe(true);
  });
});
