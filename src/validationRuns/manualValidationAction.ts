import type { Task } from '../types';
import { effectiveTaskRepoId } from '../repoIdentity';
import type { ValidationRun } from './types';

export type ManualValidationRunResult =
  | { ok: true; run: ValidationRun; validatorSessionId: string }
  | { ok: false; error: string };

/**
 * Creates a validation run and launches the validator agent session.
 * Used by the task detail Validation section (electron-playwright v1).
 */
export async function runManualValidationForTask(input: {
  task: Task;
  primaryRepoId: string;
  worktreePath?: string | null;
}): Promise<ManualValidationRunResult> {
  const { task } = input;
  if (task.agent == null) {
    return { ok: false, error: 'Choose an agent for this task before running validation.' };
  }
  if (task.status !== 'review') {
    return { ok: false, error: 'Validation can only be started from Review tasks.' };
  }

  const repoId = effectiveTaskRepoId(task, input.primaryRepoId);
  const createResult = await window.electronAPI.validationRuns.create({
    taskId: task.id,
    projectId: task.projectId,
    packId: 'electron-playwright',
    validatorAgent: task.agent,
    ...(repoId ? { repoId } : {}),
    ...(input.worktreePath?.trim() ? { worktreeCwd: input.worktreePath.trim() } : {}),
  });
  if ('error' in createResult) {
    return { ok: false, error: createResult.error };
  }

  const launchResult = await window.electronAPI.validationRuns.launchValidator({
    runId: createResult.run.id,
    task,
  });
  if ('error' in launchResult) {
    return { ok: false, error: launchResult.error };
  }

  return {
    ok: true,
    run: launchResult.run,
    validatorSessionId: launchResult.validatorSessionId,
  };
}
