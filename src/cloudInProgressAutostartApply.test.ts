import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import { cloudInProgressAutostartAllowedByAssignee } from './cloudInProgressAutostartApply';

const base = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p',
  ...t,
});

describe('cloudInProgressAutostartAllowedByAssignee', () => {
  const me = 'user-a';
  const other = 'user-b';

  it('is false without actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        null,
      ),
    ).toBe(false);
  });

  it('is false when task was assigned to someone else', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog', assigneeId: other }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: other }),
        me,
      ),
    ).toBe(false);
  });

  it('is true when task was already assigned to the actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog', assigneeId: me }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        me,
      ),
    ).toBe(true);
  });

  it('is true when unclaimed and fresh task is assigned to the actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        me,
      ),
    ).toBe(true);
  });

  it('is false when unclaimed but fresh task still has no assignee', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress' }),
        me,
      ),
    ).toBe(false);
  });
});
