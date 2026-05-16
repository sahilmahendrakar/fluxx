import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';

/**
 * Pure logic extracted from the main.ts onSessionExit handler for testability.
 * Given a session exit event and a task lookup, determines the transition.
 */
function computeSessionExitTransition(
  session: Pick<Session, 'id' | 'status' | 'taskId'>,
  sessionTaskMap: Map<string, string>,
  getTask: (taskId: string) => { status: string } | undefined,
): { action: 'transition'; taskId: string } | { action: 'skip'; reason: string } {
  const taskId = sessionTaskMap.get(session.id);
  if (!taskId) return { action: 'skip', reason: 'no-task-mapping' };

  if (session.status !== 'stopped') {
    return { action: 'skip', reason: `session-status-${session.status}` };
  }

  const task = getTask(taskId);
  if (!task) return { action: 'skip', reason: 'task-not-found' };
  if (task.status !== 'in-progress') {
    return { action: 'skip', reason: `task-status-${task.status}` };
  }

  return { action: 'transition', taskId };
}

describe('session exit → needs-input transition', () => {
  const makeSession = (overrides: Partial<Session> = {}): Session => ({
    id: 'sess-1',
    taskId: 'task-1',
    projectId: 'proj-1',
    worktreePath: '/tmp/wt',
    branch: 'main',
    status: 'stopped',
    startedAt: new Date().toISOString(),
    ...overrides,
  });

  it('transitions when agent exits cleanly and task is in-progress', () => {
    const map = new Map([['sess-1', 'task-1']]);
    const result = computeSessionExitTransition(
      makeSession({ status: 'stopped' }),
      map,
      () => ({ status: 'in-progress' }),
    );
    expect(result).toEqual({ action: 'transition', taskId: 'task-1' });
  });

  it('skips when session exited with error', () => {
    const map = new Map([['sess-1', 'task-1']]);
    const result = computeSessionExitTransition(
      makeSession({ status: 'error' }),
      map,
      () => ({ status: 'in-progress' }),
    );
    expect(result).toEqual({ action: 'skip', reason: 'session-status-error' });
  });

  it('skips when task is already needs-input', () => {
    const map = new Map([['sess-1', 'task-1']]);
    const result = computeSessionExitTransition(
      makeSession({ status: 'stopped' }),
      map,
      () => ({ status: 'needs-input' }),
    );
    expect(result).toEqual({ action: 'skip', reason: 'task-status-needs-input' });
  });

  it('skips when no task mapping exists', () => {
    const map = new Map<string, string>();
    const result = computeSessionExitTransition(
      makeSession({ status: 'stopped' }),
      map,
      () => ({ status: 'in-progress' }),
    );
    expect(result).toEqual({ action: 'skip', reason: 'no-task-mapping' });
  });

  it('skips when task is not found', () => {
    const map = new Map([['sess-1', 'task-1']]);
    const result = computeSessionExitTransition(
      makeSession({ status: 'stopped' }),
      map,
      () => undefined,
    );
    expect(result).toEqual({ action: 'skip', reason: 'task-not-found' });
  });
});
