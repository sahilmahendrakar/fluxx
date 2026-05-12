import { describe, expect, it } from 'vitest';
import type { Session } from './types';
import { taskDeleteNeedsWorkspaceConfirmation } from './taskDeleteWorkspaceConfirmation';

const session = (taskId: string, worktreePath = ''): Session => ({
  id: `session-${taskId}`,
  taskId,
  projectId: 'p',
  worktreePath,
  branch: 'main',
  status: 'running',
  startedAt: '2020-01-01',
});

describe('taskDeleteNeedsWorkspaceConfirmation', () => {
  it('returns false when there is no disk worktree and no linked session', () => {
    expect(taskDeleteNeedsWorkspaceConfirmation('t1', [], {})).toBe(false);
    expect(taskDeleteNeedsWorkspaceConfirmation('t1', [session('other')], { t1: false })).toBe(
      false,
    );
  });

  it('returns true when the task has a resolved disk worktree', () => {
    expect(taskDeleteNeedsWorkspaceConfirmation('t1', [], { t1: true })).toBe(true);
  });

  it('returns true when any agent session is linked to the task', () => {
    expect(taskDeleteNeedsWorkspaceConfirmation('t1', [session('t1')], {})).toBe(true);
    expect(
      taskDeleteNeedsWorkspaceConfirmation('t1', [session('t1', '/tmp/worktree')], {}),
    ).toBe(true);
  });
});
