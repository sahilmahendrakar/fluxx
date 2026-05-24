import { describe, expect, it } from 'vitest';
import { buildCloudGithubPrRefreshPatch } from './cloudGithubPrRefreshReconcile';
import { shouldDispatchAutoTransitionNotification } from '../../taskAutoTransitionNotification';
import { DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS } from '../../taskAutoTransitionNotificationPrefs';
import type { Task } from '../../types';

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'Example',
    status: 'in-progress',
    orderKey: 'a',
    agent: 'cursor',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('cloud PR refresh automation notifications', () => {
  it('review patch would notify with pr-opened', () => {
    const live = baseTask({ status: 'in-progress' });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: {
        url: 'https://github.com/o/r/pull/1',
        state: 'open',
        merged: false,
      },
      snapshot: [live],
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: true,
    });
    expect(patch?.status).toBe('review');
    expect(
      shouldDispatchAutoTransitionNotification(
        {
          taskTitle: live.title,
          previousStatus: live.status,
          nextStatus: 'review',
          reason: 'pr-opened',
        },
        DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
      ),
    ).toBe(true);
  });

  it('done patch would notify with pr-merged', () => {
    const live = baseTask({ status: 'review', githubPr: { url: 'https://github.com/o/r/pull/1' } });
    const patch = buildCloudGithubPrRefreshPatch({
      live,
      refreshed: {
        url: 'https://github.com/o/r/pull/1',
        state: 'merged',
        merged: true,
      },
      snapshot: [live],
      autoMarkDoneWhenPrMerged: true,
      autoMoveToReviewWhenPrOpen: true,
    });
    expect(patch?.status).toBe('done');
    expect(
      shouldDispatchAutoTransitionNotification(
        {
          taskTitle: live.title,
          previousStatus: live.status,
          nextStatus: 'done',
          reason: 'pr-merged',
        },
        DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
      ),
    ).toBe(true);
  });
});
