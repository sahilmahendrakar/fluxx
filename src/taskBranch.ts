import type { Task } from './types';
import { normalizeGitBranchShortName } from './taskBranches';

/** Mirrors legacy task worktree branch naming (`flux/task-<id>`). */
export function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

export function branchForTaskId(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}

/** Flux work branch for PR/automation checks: persisted name, else legacy `flux/task-*`. */
export function expectedTaskFluxWorkBranch(task: Pick<Task, 'id' | 'fluxWorkBranch'>): string {
  const n = normalizeGitBranchShortName(task.fluxWorkBranch ?? '');
  if (n) return n;
  return branchForTaskId(task.id);
}
