import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { shouldAutoTeardownWorkspaceForCloudDoneTransition } from './cloudTaskDoneFollowUp';

const base = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p',
  ...t,
});

describe('shouldAutoTeardownWorkspaceForCloudDoneTransition', () => {
  const me = 'user-a';
  const other = 'user-b';

  it('is false without actor uid', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done', assigneeId: me }),
        null,
      ),
    ).toBe(false);
  });

  it('is false when task is unassigned', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done' }),
        me,
      ),
    ).toBe(false);
  });

  it('is false when assignee id is null', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done', assigneeId: null }),
        me,
      ),
    ).toBe(false);
  });

  it('is false when assignee id is empty string', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done', assigneeId: '' }),
        me,
      ),
    ).toBe(false);
  });

  it('is false when actor is not the assignee', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done', assigneeId: other }),
        me,
      ),
    ).toBe(false);
  });

  it('is true when actor matches current assignee', () => {
    expect(
      shouldAutoTeardownWorkspaceForCloudDoneTransition(
        base({ id: '1', title: '', status: 'done', assigneeId: me }),
        me,
      ),
    ).toBe(true);
  });
});
