import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { ValidationRunStore } from './ValidationRunStore';
import { unregisterValidatorSession } from './validatorSessionLifecycle';

export type TeardownValidationRunsForTaskDeps = {
  validationRunStore: ValidationRunStore;
  terminalBackend: TerminalBackend;
  taskId: string;
};

export type TeardownValidationRunsForTaskResult = {
  errors: string[];
  deletedRunIds: string[];
};

/**
 * Stops live validator sessions for the task, removes persisted run rows, and
 * deletes `<projectDir>/validation-runs/<runId>/` artifact trees.
 */
export async function teardownValidationRunsForTask(
  deps: TeardownValidationRunsForTaskDeps,
): Promise<TeardownValidationRunsForTaskResult> {
  const taskId = deps.taskId.trim();
  const errors: string[] = [];
  if (!taskId) {
    return { errors, deletedRunIds: [] };
  }

  let runs: Awaited<ReturnType<ValidationRunStore['listForTask']>> = [];
  try {
    runs = await deps.validationRunStore.listForTask(taskId);
  } catch (err) {
    errors.push(
      `Could not list validation runs: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { errors, deletedRunIds: [] };
  }

  const liveSessionIds = new Set(
    (await deps.terminalBackend.listSessions()).map((session) => session.id),
  );

  for (const run of runs) {
    const sessionId = run.validatorSessionId?.trim();
    if (!sessionId || !liveSessionIds.has(sessionId)) continue;
    unregisterValidatorSession(sessionId);
    try {
      await deps.terminalBackend.closeShellsForSession(sessionId);
    } catch (err) {
      errors.push(
        `Validator session ${sessionId} shells: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await deps.terminalBackend.stopSession(sessionId);
    } catch (err) {
      errors.push(
        `Validator session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  try {
    const deleted = await deps.validationRunStore.deleteForTask(taskId);
    return { errors, deletedRunIds: deleted.deletedRunIds };
  } catch (err) {
    errors.push(
      `Validation run cleanup: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { errors, deletedRunIds: [] };
  }
}
