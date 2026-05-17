import type { Task } from './types';
import { normalizeGitBranchShortName } from './taskBranches';

/** Mirrors legacy task worktree branch naming (`fluxx/task-<id>`). */
export function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

export function branchForTaskId(taskId: string): string {
  return `fluxx/task-${sanitiseTaskId(taskId)}`;
}

/** Flux work branch for PR/automation checks: persisted name, else legacy `fluxx/task-*`. */
export function expectedTaskFluxxWorkBranch(task: Pick<Task, 'id' | 'fluxxWorkBranch'>): string {
  const n = normalizeGitBranchShortName(task.fluxxWorkBranch ?? '');
  if (n) return n;
  return branchForTaskId(task.id);
}
