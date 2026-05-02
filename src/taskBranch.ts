/** Mirrors task worktree branch naming in `WorktreeService`. */
export function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

export function branchForTaskId(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}
