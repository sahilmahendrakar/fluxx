import type { Session } from '../types';

export type ValidatorSessionBinding = {
  runId: string;
  taskId: string;
};

const validatorSessionBindings = new Map<string, ValidatorSessionBinding>();

export function registerValidatorSession(sessionId: string, binding: ValidatorSessionBinding): void {
  validatorSessionBindings.set(sessionId, binding);
}

export function unregisterValidatorSession(sessionId: string): void {
  validatorSessionBindings.delete(sessionId);
}

export function getValidatorSessionBinding(sessionId: string): ValidatorSessionBinding | undefined {
  return validatorSessionBindings.get(sessionId);
}

export function isValidatorSessionId(sessionId: string): boolean {
  return validatorSessionBindings.has(sessionId);
}

export function hydrateValidatorSessionBindings(
  runs: ReadonlyArray<{ id: string; taskId: string; validatorSessionId?: string }>,
  liveSessions: ReadonlyArray<Pick<Session, 'id'>>,
): number {
  const liveIds = new Set(liveSessions.map((s) => s.id));
  let hydrated = 0;
  for (const run of runs) {
    const sessionId = run.validatorSessionId?.trim();
    if (!sessionId || !liveIds.has(sessionId)) continue;
    if (validatorSessionBindings.has(sessionId)) continue;
    registerValidatorSession(sessionId, { runId: run.id, taskId: run.taskId });
    hydrated += 1;
  }
  return hydrated;
}

/**
 * Task agent sessions transition in-progress → needs-input on clean exit.
 * Validator sessions must not affect task status.
 */
export function computeSessionExitTransition(
  session: Pick<Session, 'id' | 'status' | 'taskId'>,
  sessionTaskMap: Map<string, string>,
  getTask: (taskId: string) => { status: string } | undefined,
  isValidatorSession: (sessionId: string) => boolean = isValidatorSessionId,
): { action: 'transition'; taskId: string } | { action: 'skip'; reason: string } {
  if (isValidatorSession(session.id)) {
    return { action: 'skip', reason: 'validator-session' };
  }
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
