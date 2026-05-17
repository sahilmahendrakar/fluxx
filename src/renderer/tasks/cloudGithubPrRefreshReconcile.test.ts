import { describe, expect, it } from 'vitest';
import type { Task, TaskGithubPr } from '../../types';
import { buildCloudGithubPrRefreshPatch } from './cloudGithubPrRefreshReconcile';

const baseTask = (over: Partial<Task>): Task =>
  ({
    id: 't1',
    projectId: 'p1',
    title: 'x',
    description: '',
    status: 'in-progress',
    agent: 'claude-code',
    orderKey: 'a',
    createdAt: '2020-01-01',
    ...over,
  }) as Task;

describe('buildCloudGithubPrRefreshPatch', () => {
  const mergedPr: TaskGithubPr = {
    url: 'https://github.com/o/r/pull/1',
    state: 'merged',
    mergedAt: '2020-02-01',
  };

  it('returns null when metadata matches and no automation applies', () => {
    const live = baseTask({
      githubPr: mergedPr,
      status: 'done',
    });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: mergedPr,
      snapshot: [live],
      autoMarkDoneWhenPrMerged: true,
      autoMoveToReviewWhenPrOpen: true,
    });
    expect(patch).toBeNull();
  });

  it('returns status-only patch when metadata already matches merged PR but task is still in review', () => {
    const live = baseTask({
      githubPr: mergedPr,
      status: 'review',
    });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: mergedPr,
      snapshot: [live],
      autoMarkDoneWhenPrMerged: true,
      autoMoveToReviewWhenPrOpen: false,
    });
    expect(patch).not.toBeNull();
    expect(patch?.githubPr).toBeUndefined();
    expect(patch?.status).toBe('done');
    expect(typeof patch?.orderKey).toBe('string');
  });

  it('includes githubPr when view differs', () => {
    const oldPr: TaskGithubPr = { url: mergedPr.url, state: 'open' };
    const live = baseTask({ githubPr: oldPr, status: 'in-progress' });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: mergedPr,
      snapshot: [live],
      autoMarkDoneWhenPrMerged: true,
      autoMoveToReviewWhenPrOpen: false,
    });
    expect(patch?.githubPr?.state).toBe('merged');
    expect(patch?.status).toBe('done');
  });

  it('moves to review when open PR metadata matches and pref enabled', () => {
    const openPr: TaskGithubPr = {
      url: 'https://github.com/o/r/pull/2',
      state: 'open',
      headBranch: 'fluxx/task-t1',
    };
    const live = baseTask({
      id: 't1',
      githubPr: openPr,
      status: 'in-progress',
    });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: openPr,
      snapshot: [live],
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: true,
    });
    expect(patch?.status).toBe('review');
    expect(patch?.githubPr).toBeUndefined();
  });
});
