import type { Session } from '../types';
import { validationRunIsActive } from '../validationRuns/display';
import type { ValidationRun } from '../validationRuns/types';
import { finalizeValidationRun } from './finalizeValidationRun';
import type { TerminalBackend } from './terminalBackend/TerminalBackend';
import type { ValidationRunStore } from './ValidationRunStore';
import { getValidatorSessionBinding, isValidatorSessionId } from './validatorSessionLifecycle';

const QUEUED_LAUNCH_TIMEOUT_MS = 120_000;

export type ReconcileValidationRunDeps = {
  validationRunStore: ValidationRunStore;
  terminalBackend: TerminalBackend;
};

function liveValidatorSessionForRun(
  run: ValidationRun,
  liveSessions: readonly Session[],
): Session | undefined {
  const sessionId = run.validatorSessionId?.trim();
  if (!sessionId) return undefined;
  return liveSessions.find((s) => s.id === sessionId);
}

/**
 * Heal active validation runs whose validator PTY is missing or already exited.
 * Prevents the UI from spinning on stale `running`/`queued` rows forever.
 */
export async function reconcileActiveValidationRun(
  deps: ReconcileValidationRunDeps,
  run: ValidationRun,
  source: string,
): Promise<ValidationRun> {
  if (!validationRunIsActive(run.status)) return run;

  const liveSessions = await deps.terminalBackend.listSessions();
  const sessionId = run.validatorSessionId?.trim();
  const live = sessionId ? liveValidatorSessionForRun(run, liveSessions) : undefined;

  if (run.status === 'queued' && !sessionId) {
    const ageMs = Date.now() - Date.parse(run.startedAt);
    if (ageMs > QUEUED_LAUNCH_TIMEOUT_MS) {
      return deps.validationRunStore.updateStatus({
        runId: run.id,
        status: 'errored',
        verdictReason: 'Validation run never launched.',
      });
    }
    return run;
  }

  if (run.status === 'running' && !sessionId) {
    return deps.validationRunStore.updateStatus({
      runId: run.id,
      status: 'errored',
      verdictReason: 'Validator session id missing for running validation run.',
    });
  }

  if (run.status === 'running' && sessionId && !live) {
    const finalized = await finalizeValidationRun(deps.validationRunStore, {
      runId: run.id,
      source: 'finish',
    });
    if (finalized.ok) {
      return finalized.run;
    }
    return deps.validationRunStore.updateStatus({
      runId: run.id,
      status: 'errored',
      verdictReason: 'Validator session ended before validation completed.',
    });
  }

  if (
    run.status === 'running' &&
    live &&
    (live.status === 'stopped' || live.status === 'error') &&
    (isValidatorSessionId(live.id) || getValidatorSessionBinding(live.id))
  ) {
    const finalized = await finalizeValidationRun(deps.validationRunStore, {
      runId: run.id,
      session: live,
      source: 'session-exit',
    });
    if (finalized.ok) {
      return finalized.run;
    }
  }

  return run;
}

export async function reconcileActiveValidationRunsForTask(
  deps: ReconcileValidationRunDeps,
  taskId: string,
  source: string,
): Promise<ValidationRun[]> {
  const runs = await deps.validationRunStore.listForTask(taskId);
  const reconciled: ValidationRun[] = [];
  for (const run of runs) {
    reconciled.push(await reconcileActiveValidationRun(deps, run, source));
  }
  reconciled.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return reconciled;
}
