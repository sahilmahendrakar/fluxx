import type { Task } from '../types';
import { normalizeGitBranchShortName } from '../taskBranches';

function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Legacy Flux work branch (`flux/task-<sanitised-id>`). Still used when a task has
 * no persisted {@link Task.fluxWorkBranch} (older tasks) and as a fallback for
 * best-effort cleanup when git metadata is missing.
 */
export function legacyFluxTaskWorkBranchName(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}

/** @deprecated Prefer {@link legacyFluxTaskWorkBranchName} or {@link expectedFluxWorkBranchForTask}. */
export function fluxTaskWorkBranchName(taskId: string): string {
  return legacyFluxTaskWorkBranchName(taskId);
}

/** Canonical Flux work branch for a task row (persisted when a worktree exists). */
export function expectedFluxWorkBranchForTask(task: Pick<Task, 'id' | 'fluxWorkBranch'>): string {
  const persisted = normalizeGitBranchShortName(task.fluxWorkBranch ?? '');
  if (persisted) return persisted;
  return legacyFluxTaskWorkBranchName(task.id);
}
