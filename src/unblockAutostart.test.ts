import { describe, expect, it } from 'vitest';
import type { Task } from './types';
import {
  cloudUnblockAutostartAssigneeGateAllows,
  findDependentsForUnblockAutostart,
  isFullUnblockTransition,
  shouldAutostartUnblockedTask,
} from './unblockAutostart';

const base = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p',
  ...t,
});

describe('shouldAutostartUnblockedTask', () => {
  const p = (a: boolean, w: boolean): { autoStartSessionOnInProgress: boolean; autoStartWhenUnblocked: boolean } => ({
    autoStartSessionOnInProgress: a,
    autoStartWhenUnblocked: w,
  });

  it('is false when task is done', () => {
    expect(shouldAutostartUnblockedTask(base({ id: 'x', title: '', status: 'done' }), p(true, true))).toBe(false);
  });

  it('is false when project “when unblocked” is on but task is unassigned', () => {
    expect(shouldAutostartUnblockedTask(base({ id: 'x', title: '', status: 'backlog' }), p(false, true))).toBe(
      false,
    );
  });

  it('is true when project “when unblocked” is on and task has an assignee', () => {
    expect(
      shouldAutostartUnblockedTask(
        base({ id: 'x', title: '', status: 'backlog', assigneeId: 'alice' }),
        p(false, true),
      ),
    ).toBe(true);
  });

  it('is true when per-task auto is on', () => {
    expect(
      shouldAutostartUnblockedTask(
        base({ id: 'x', title: '', status: 'backlog', autoStartOnUnblock: true }),
        p(false, false),
      ),
    ).toBe(true);
  });

  it('is true when in-progress autostart is on (parity with column transition)', () => {
    expect(shouldAutostartUnblockedTask(base({ id: 'x', title: '', status: 'backlog' }), p(true, false))).toBe(true);
  });

  it('is false when all flags are off', () => {
    expect(shouldAutostartUnblockedTask(base({ id: 'x', title: '', status: 'backlog' }), p(false, false))).toBe(false);
  });
});

describe('isFullUnblockTransition', () => {
  it('is false when still blocked', () => {
    const a = base({ id: 'a', title: 'A', status: 'in-progress' });
    const b = base({ id: 'b', title: 'B', status: 'in-progress' });
    const d = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['a', 'b'],
    });
    const before = [a, b, d];
    const after = [
      { ...a, status: 'done' as const },
      b,
      d,
    ];
    expect(isFullUnblockTransition(d, before, after)).toBe(false);
  });

  it('is true when the last blocker completes', () => {
    const a = base({ id: 'a', title: 'A', status: 'done' });
    const b = base({ id: 'b', title: 'B', status: 'in-progress' });
    const d = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['a', 'b'],
    });
    const before = [a, b, d];
    const after = [a, { ...b, status: 'done' as const }, d];
    expect(isFullUnblockTransition(d, before, after)).toBe(true);
  });
});

describe('cloudUnblockAutostartAssigneeGateAllows', () => {
  it('skips gate when clientUid is undefined (local)', () => {
    expect(
      cloudUnblockAutostartAssigneeGateAllows(
        base({ id: 'x', title: '', status: 'backlog', assigneeId: 'someone' }),
        undefined,
      ),
    ).toBe(true);
  });

  it('allows unassigned task when cloud uid is null', () => {
    expect(
      cloudUnblockAutostartAssigneeGateAllows(
        base({ id: 'x', title: '', status: 'backlog' }),
        null,
      ),
    ).toBe(true);
  });

  it('denies assigned task when cloud uid is null', () => {
    expect(
      cloudUnblockAutostartAssigneeGateAllows(
        base({ id: 'x', title: '', status: 'backlog', assigneeId: 'alice' }),
        null,
      ),
    ).toBe(false);
  });

  it('allows when assignee matches client uid', () => {
    expect(
      cloudUnblockAutostartAssigneeGateAllows(
        base({ id: 'x', title: '', status: 'backlog', assigneeId: 'alice' }),
        'alice',
      ),
    ).toBe(true);
  });

  it('denies when assignee differs from client uid', () => {
    expect(
      cloudUnblockAutostartAssigneeGateAllows(
        base({ id: 'x', title: '', status: 'backlog', assigneeId: 'alice' }),
        'bob',
      ),
    ).toBe(false);
  });
});

describe('findDependentsForUnblockAutostart', () => {
  it('returns a backlog dependent when the only blocker is completed', () => {
    const b = base({ id: 'b', title: 'B', status: 'in-progress' });
    const d = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['b'],
    });
    const allBefore = [b, d];
    const bDone = { ...b, status: 'done' as const };
    const allAfter = [bDone, d];
    const found = findDependentsForUnblockAutostart(bDone, b, allBefore, allAfter);
    expect(found.map((x) => x.id)).toEqual(['d']);
  });

  it('is empty when still blocked by another task', () => {
    const a = base({ id: 'a', title: 'A', status: 'in-progress' });
    const b = base({ id: 'b', title: 'B', status: 'in-progress' });
    const d = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['a', 'b'],
    });
    const allBefore = [a, b, d];
    const bDone = { ...b, status: 'done' as const };
    const allAfter = [a, bDone, d];
    const found = findDependentsForUnblockAutostart(bDone, b, allBefore, allAfter);
    expect(found).toHaveLength(0);
  });

  it('includes in-progress dependent that was blocked', () => {
    const b = base({ id: 'b', title: 'B', status: 'in-progress' });
    const d = base({
      id: 'd',
      title: 'D',
      status: 'in-progress',
      blockedByTaskIds: ['b'],
    });
    const allBefore = [b, d];
    const bDone = { ...b, status: 'done' as const };
    const allAfter = [bDone, d];
    const found = findDependentsForUnblockAutostart(bDone, b, allBefore, allAfter);
    expect(found.map((x) => x.id)).toEqual(['d']);
  });

  it('is empty when completed task was already done in before', () => {
    const b = base({ id: 'b', title: 'B', status: 'done' });
    const d = base({ id: 'd', title: 'D', status: 'backlog' });
    const allBefore = [b, d];
    const allAfter = [b, d];
    const found = findDependentsForUnblockAutostart(b, b, allBefore, allAfter);
    expect(found).toHaveLength(0);
  });
});
