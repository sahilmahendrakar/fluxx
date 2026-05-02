import { describe, expect, it } from 'vitest';
import {
  AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES,
  shouldAutoMoveTaskToReviewForOpenPr,
} from './githubPrReviewWhenOpenAutomation';

describe('shouldAutoMoveTaskToReviewForOpenPr', () => {
  const taskId = 'abc123';

  it('requires enabled + open PR + allowed source column', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: false,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        taskId,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'merged' },
        taskId,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'needs-input',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        taskId,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        taskId,
      }),
    ).toBe(true);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'backlog',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        taskId,
      }),
    ).toBe(true);
  });

  it('rejects head branch mismatch when head is present', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: {
          url: 'https://github.com/o/r/pull/1',
          state: 'open',
          headBranch: 'someone-else/branch',
        },
        taskId,
      }),
    ).toBe(false);
  });

  it('allows when head matches Flux task branch', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: {
          url: 'https://github.com/o/r/pull/1',
          state: 'open',
          headBranch: 'flux/task-abc123',
        },
        taskId,
      }),
    ).toBe(true);
  });

  it('documents allowed sources', () => {
    expect(AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES).toEqual(['backlog', 'in-progress']);
  });
});
