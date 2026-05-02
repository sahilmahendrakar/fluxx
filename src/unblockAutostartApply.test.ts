import { describe, expect, it, vi } from 'vitest';
import type { Task } from './types';
import {
  applyUnblockAutostartForCompletedBlocker,
  type UnblockAutostartApplyContext,
} from './unblockAutostartApply';
import type { UnblockAutostartPolicy } from './unblockAutostart';

const base = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p',
  ...t,
});

describe('applyUnblockAutostartForCompletedBlocker cloud assignee gate', () => {
  const noopLog = vi.fn() as UnblockAutostartApplyContext['logError'];
  const policy: UnblockAutostartPolicy = {
    autoStartSessionOnInProgress: true,
    autoStartWhenUnblocked: true,
  };

  it('does not move backlog or start session when dependent assignee mismatches client uid', async () => {
    const blocker = base({ id: 'b', title: 'B', status: 'in-progress' });
    const dependent = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['b'],
      assigneeId: 'alice',
    });
    const bDone = { ...blocker, status: 'done' as const };
    const allBefore = [blocker, dependent];
    const allAfter = [bDone, dependent];

    const moveBacklogToInProgress = vi.fn(async () => undefined);
    const moveBacklogToInProgressThenStartSessionWithoutImplicitInProg = vi.fn(
      async () => undefined,
    );
    const startSession = vi.fn(async () => ({}));

    await applyUnblockAutostartForCompletedBlocker(
      blocker,
      bDone,
      allBefore,
      allAfter,
      policy,
      {
        inFlight: new Set(),
        source: 'test',
        logError: noopLog,
        getCurrentList: () => allAfter,
        cloudUnblockAutostartClientUid: 'bob',
        startSession,
        moveBacklogToInProgress,
        moveBacklogToInProgressThenStartSessionWithoutImplicitInProg,
      },
    );

    expect(moveBacklogToInProgress).not.toHaveBeenCalled();
    expect(moveBacklogToInProgressThenStartSessionWithoutImplicitInProg).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('moves backlog when assignee matches cloud client uid', async () => {
    const blocker = base({ id: 'b', title: 'B', status: 'in-progress' });
    const dependent = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['b'],
      assigneeId: 'alice',
    });
    const bDone = { ...blocker, status: 'done' as const };
    const allBefore = [blocker, dependent];
    const allAfter = [bDone, dependent];

    const moveBacklogToInProgress = vi.fn(async () => undefined);
    const startSession = vi.fn(async () => ({}));

    await applyUnblockAutostartForCompletedBlocker(
      blocker,
      bDone,
      allBefore,
      allAfter,
      policy,
      {
        inFlight: new Set(),
        source: 'test',
        logError: noopLog,
        getCurrentList: () => allAfter,
        cloudUnblockAutostartClientUid: 'alice',
        startSession,
        moveBacklogToInProgress,
        moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: vi.fn(
          async () => undefined,
        ),
      },
    );

    expect(moveBacklogToInProgress).toHaveBeenCalledTimes(1);
    expect(moveBacklogToInProgress).toHaveBeenCalledWith('d');
  });

  it('omitting cloudUnblockAutostartClientUid runs without assignee gate', async () => {
    const blocker = base({ id: 'b', title: 'B', status: 'in-progress' });
    const dependent = base({
      id: 'd',
      title: 'D',
      status: 'backlog',
      blockedByTaskIds: ['b'],
      assigneeId: 'alice',
    });
    const bDone = { ...blocker, status: 'done' as const };
    const allBefore = [blocker, dependent];
    const allAfter = [bDone, dependent];

    const moveBacklogToInProgress = vi.fn(async () => undefined);

    await applyUnblockAutostartForCompletedBlocker(
      blocker,
      bDone,
      allBefore,
      allAfter,
      policy,
      {
        inFlight: new Set(),
        source: 'test',
        logError: noopLog,
        getCurrentList: () => allAfter,
        startSession: vi.fn(async () => ({})),
        moveBacklogToInProgress,
        moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: vi.fn(
          async () => undefined,
        ),
      },
    );

    expect(moveBacklogToInProgress).toHaveBeenCalledTimes(1);
  });

  it('does not start session for in-progress dependent when assignee mismatches', async () => {
    const blocker = base({ id: 'b', title: 'B', status: 'in-progress' });
    const dependent = base({
      id: 'd',
      title: 'D',
      status: 'in-progress',
      blockedByTaskIds: ['b'],
      assigneeId: 'alice',
    });
    const bDone = { ...blocker, status: 'done' as const };
    const allBefore = [blocker, dependent];
    const allAfter = [bDone, dependent];

    const startSession = vi.fn(async () => ({}));

    await applyUnblockAutostartForCompletedBlocker(
      blocker,
      bDone,
      allBefore,
      allAfter,
      policy,
      {
        inFlight: new Set(),
        source: 'test',
        logError: noopLog,
        getCurrentList: () => allAfter,
        cloudUnblockAutostartClientUid: 'bob',
        startSession,
        moveBacklogToInProgress: vi.fn(async () => undefined),
        moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: vi.fn(
          async () => undefined,
        ),
      },
    );

    expect(startSession).not.toHaveBeenCalled();
  });
});
