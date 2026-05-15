import { describe, expect, it } from 'vitest';
import {
  AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES,
  shouldAutoMoveTaskToReviewForOpenPr,
} from './githubPrReviewWhenOpenAutomation';

describe('shouldAutoMoveTaskToReviewForOpenPr', () => {
  const taskId = 'abc123';
  const legacyTask = { id: taskId };

  it('requires enabled + open PR + allowed source column', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: false,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'merged' },
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'needs-input',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        task: legacyTask,
      }),
    ).toBe(true);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'backlog',
        githubPr: { url: 'https://github.com/o/r/pull/1', state: 'open' },
        task: legacyTask,
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
        task: legacyTask,
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
        task: legacyTask,
      }),
    ).toBe(true);
  });

  it('uses persisted fluxWorkBranch when matching head', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: {
          url: 'https://github.com/o/r/pull/1',
          state: 'open',
          headBranch: 'jane/add-auth',
        },
        task: { id: taskId, fluxWorkBranch: 'jane/add-auth' },
      }),
    ).toBe(true);
  });

  it('documents allowed sources', () => {
    expect(AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES).toEqual(['backlog', 'in-progress']);
  });
});
