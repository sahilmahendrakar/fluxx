import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { computeSessionExitTransition } from '../main/validatorSessionLifecycle';

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

  it('skips validator sessions', () => {
    const map = new Map([['sess-1', 'task-1']]);
    const result = computeSessionExitTransition(
      makeSession({ status: 'stopped' }),
      map,
      () => ({ status: 'in-progress' }),
      (id) => id === 'sess-1',
    );
    expect(result).toEqual({ action: 'skip', reason: 'validator-session' });
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
