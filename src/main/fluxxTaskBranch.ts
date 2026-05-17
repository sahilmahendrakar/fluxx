import type { Task } from '../types';
import { normalizeGitBranchShortName } from '../taskBranches';

function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Pre-rebrand task work branch (`flux/task-<sanitised-id>`). Honored when reading
 * legacy rows and when resolving on-disk worktrees created before the fluxx prefix.
 */
export function preRebrandFluxTaskWorkBranchName(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}

/**
 * Default Fluxx task work branch (`fluxx/task-<sanitised-id>`) when a task has no
 * persisted {@link Task.fluxxWorkBranch}.
 */
export function legacyFluxxTaskWorkBranchName(taskId: string): string {
  return `fluxx/task-${sanitiseTaskId(taskId)}`;
}

/** @deprecated Prefer {@link legacyFluxxTaskWorkBranchName} or {@link expectedFluxxWorkBranchForTask}. */
export function fluxxTaskWorkBranchName(taskId: string): string {
  return legacyFluxxTaskWorkBranchName(taskId);
}

/** Canonical Flux work branch for a task row (persisted when a worktree exists). */
export function expectedFluxxWorkBranchForTask(task: Pick<Task, 'id' | 'fluxxWorkBranch'>): string {
  const persisted = normalizeGitBranchShortName(task.fluxxWorkBranch ?? '');
  if (persisted) return persisted;
  return legacyFluxxTaskWorkBranchName(task.id);
}
