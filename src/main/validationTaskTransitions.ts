import type { Session, Task } from '../types';
import { effectiveTaskRepoId } from '../repoIdentity';
import {
  pickLatestValidationRun,
  validationRunIsActive,
} from '../validationRuns/display';
import type { ValidationRun } from '../validationRuns/types';
import type { ValidationRunStore } from './ValidationRunStore';
import { defaultValidatorAgent } from './startValidatorSession';
import {
  getValidatorSessionBinding,
  isValidatorSessionId,
} from './validatorSessionLifecycle';

export type LaunchValidatorSessionFn = (input: {
  task: Task;
  runId: string;
}) => Promise<
  | { ok: true; run: ValidationRun; sessionId: string }
  | { ok: false; error: string }
>;

export type AutoStartValidationOnEntryDeps = {
  validationRunStore: ValidationRunStore;
  launchValidatorSession: LaunchValidatorSessionFn;
  getValidationEnabled: () => Promise<boolean>;
  getPrimaryRepoId: () => Promise<string | undefined>;
  resolveWorktreePath: (task: Task) => Promise<string | undefined>;
  listTerminalSessions?: () => Promise<Session[]>;
  ensureValidatorBindingsHydrated?: () => Promise<void>;
  reconcileActiveRun?: (run: ValidationRun, source: string) => Promise<ValidationRun>;
};

/**
 * When a task transitions into Validation, create a queued run and launch the validator
 * (same path as manual Run validation). Skips when validation is off, agent missing,
 * or a run is already active.
 */
export async function autoStartValidationOnEntry(
  previous: Task,
  updated: Task,
  deps: AutoStartValidationOnEntryDeps,
  source: string,
): Promise<void> {
  if (previous.status === updated.status) return;
  if (updated.status !== 'validation') return;
  if (!(await deps.getValidationEnabled())) return;

  await deps.ensureValidatorBindingsHydrated?.();

  if (updated.agent == null) {
    console.warn('[validation:auto-start] skipped — no agent', {
      source,
      taskId: updated.id,
    });
    return;
  }

  const runs = await deps.validationRunStore.listForTask(updated.id);
  let latest = pickLatestValidationRun(runs);
  if (latest && validationRunIsActive(latest.status) && deps.reconcileActiveRun) {
    latest = await deps.reconcileActiveRun(latest, source);
  }
  if (validationRunIsActive(latest?.status)) {
    console.warn('[validation:auto-start] skipped — run already active', {
      source,
      taskId: updated.id,
    });
    return;
  }

  if (deps.listTerminalSessions) {
    const sessions = await deps.listTerminalSessions();
    const liveValidator = sessions.find((s) => {
      if (s.kind === 'validator' || isValidatorSessionId(s.id)) {
        const binding = getValidatorSessionBinding(s.id);
        return binding?.taskId === updated.id;
      }
      return false;
    });
    if (liveValidator && liveValidator.status !== 'stopped' && liveValidator.status !== 'error') {
      console.warn('[validation:auto-start] skipped — validator session still live', {
        source,
        taskId: updated.id,
        validatorSessionId: liveValidator.id,
        status: liveValidator.status,
      });
      return;
    }
  }

  try {
    const primaryRepoId = await deps.getPrimaryRepoId();
    const repoId = primaryRepoId ? effectiveTaskRepoId(updated, primaryRepoId) : undefined;
    const worktreeCwd = await deps.resolveWorktreePath(updated);

    const run = await deps.validationRunStore.create({
      taskId: updated.id,
      projectId: updated.projectId,
      packId: 'electron-playwright',
      validatorAgent: updated.agent ?? defaultValidatorAgent(),
      ...(repoId ? { repoId } : {}),
      ...(worktreeCwd ? { worktreeCwd } : {}),
      ...(updated.validationPlan !== undefined ? { validationPlan: updated.validationPlan } : {}),
    });

    const launched = await deps.launchValidatorSession({ task: updated, runId: run.id });
    if (!launched.ok) {
      await deps.validationRunStore.updateStatus({
        runId: run.id,
        status: 'errored',
        verdictReason: launched.error,
      });
      console.error('[validation:auto-start] launch failed', {
        source,
        taskId: updated.id,
        runId: run.id,
        error: launched.error,
      });
    }
  } catch (err) {
    console.error('[validation:auto-start] unexpected failure', {
      source,
      taskId: updated.id,
      err,
    });
  }
}

export type MoveTaskToReviewAfterPassDeps = {
  getValidationEnabled: () => Promise<boolean>;
  getTask: (taskId: string) => Promise<Task | null>;
  updateTaskToReview: (taskId: string) => Promise<void>;
};

/**
 * After a validation run passes, move tasks still in Validation to Review.
 */
export async function maybeMoveTaskToReviewAfterValidationPass(
  run: ValidationRun,
  deps: MoveTaskToReviewAfterPassDeps,
  source: string,
): Promise<void> {
  if (run.status !== 'passed') return;
  if (!(await deps.getValidationEnabled())) return;

  const task = await deps.getTask(run.taskId);
  if (!task || task.status !== 'validation') return;

  try {
    await deps.updateTaskToReview(run.taskId);
    console.log('[validation:pass] validation → review', {
      source,
      taskId: run.taskId,
      runId: run.id,
    });
  } catch (err) {
    console.error('[validation:pass] failed to move task to review', {
      source,
      taskId: run.taskId,
      runId: run.id,
      err,
    });
  }
}
