import { describe, expect, it } from 'vitest';
import {
  agentStateTaskStatusTransition,
  AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES,
  linkedAgentSessionStateForTask,
  shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive,
  shouldAutoMoveTaskToReviewForOpenPr,
} from './githubPrReviewWhenOpenAutomation';

describe('shouldAutoMoveTaskToReviewForOpenPr', () => {
  const taskId = 'abc123';
  const legacyTask = { id: taskId };
  const openPr = { url: 'https://github.com/o/r/pull/1', state: 'open' as const };

  it('requires enabled + open PR + allowed source column', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: false,
        taskStatus: 'in-progress',
        githubPr: openPr,
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: { url: openPr.url, state: 'merged' },
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'needs-input',
        githubPr: openPr,
        task: legacyTask,
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: openPr,
        task: legacyTask,
      }),
    ).toBe(true);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'backlog',
        githubPr: openPr,
        task: legacyTask,
      }),
    ).toBe(true);
  });

  it('does not move to review while linked agent session is active', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: openPr,
        task: legacyTask,
        linkedAgentSessionState: 'active',
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: openPr,
        task: legacyTask,
        linkedAgentSessionState: 'silent',
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
          headBranch: 'fluxx/task-abc123',
        },
        task: legacyTask,
      }),
    ).toBe(true);
  });

  it('uses persisted fluxxWorkBranch when matching head', () => {
    expect(
      shouldAutoMoveTaskToReviewForOpenPr({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: {
          url: 'https://github.com/o/r/pull/1',
          state: 'open',
          headBranch: 'jane/add-auth',
        },
        task: { id: taskId, fluxxWorkBranch: 'jane/add-auth' },
      }),
    ).toBe(true);
  });

  it('documents allowed sources', () => {
    expect(AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES).toEqual(['backlog', 'in-progress']);
  });
});

describe('shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive', () => {
  const task = { id: 't1', fluxxWorkBranch: 'fluxx/task-t1' };
  const openPr = {
    url: 'https://github.com/o/r/pull/1',
    state: 'open' as const,
    headBranch: 'fluxx/task-t1',
  };

  it('moves review → in-progress only when agent is active', () => {
    expect(
      shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive({
        enabled: true,
        taskStatus: 'review',
        githubPr: openPr,
        task,
        linkedAgentSessionState: 'active',
      }),
    ).toBe(true);
    expect(
      shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive({
        enabled: true,
        taskStatus: 'review',
        githubPr: openPr,
        task,
        linkedAgentSessionState: 'silent',
      }),
    ).toBe(false);
    expect(
      shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive({
        enabled: true,
        taskStatus: 'in-progress',
        githubPr: openPr,
        task,
        linkedAgentSessionState: 'active',
      }),
    ).toBe(false);
  });
});

describe('linkedAgentSessionStateForTask', () => {
  it('returns none when no running session is linked', () => {
    expect(linkedAgentSessionStateForTask('t1', [])).toBe('none');
    expect(
      linkedAgentSessionStateForTask('t1', [{ id: 's1', taskId: 't2', state: 'active' }]),
    ).toBe('none');
  });

  it('prefers active when any linked session is active', () => {
    expect(
      linkedAgentSessionStateForTask('t1', [
        { id: 's1', taskId: 't1', state: 'silent' },
        { id: 's2', taskId: 't1', state: 'active' },
      ]),
    ).toBe('active');
  });
});

describe('agentStateTaskStatusTransition', () => {
  const openPr = { url: 'https://github.com/o/r/pull/1', state: 'open' as const };
  const task = {
    id: 't1',
    status: 'in-progress' as const,
    githubPr: openPr,
    fluxxWorkBranch: 'fluxx/task-t1',
  };

  it('silent + open PR + pref → review; otherwise needs-input', () => {
    expect(
      agentStateTaskStatusTransition({
        state: 'silent',
        task,
        autoMoveToReviewWhenPrOpen: true,
        linkedAgentSessionState: 'silent',
      }),
    ).toBe('review');
    expect(
      agentStateTaskStatusTransition({
        state: 'silent',
        task,
        autoMoveToReviewWhenPrOpen: false,
        linkedAgentSessionState: 'silent',
      }),
    ).toBe('needs-input');
    expect(
      agentStateTaskStatusTransition({
        state: 'silent',
        task,
        autoMoveToReviewWhenPrOpen: true,
        linkedAgentSessionState: 'active',
      }),
    ).toBe('needs-input');
  });

  it('active + review + open PR + pref → in-progress', () => {
    expect(
      agentStateTaskStatusTransition({
        state: 'active',
        task: { ...task, status: 'review' },
        autoMoveToReviewWhenPrOpen: true,
        linkedAgentSessionState: 'active',
      }),
    ).toBe('in-progress');
  });
});
