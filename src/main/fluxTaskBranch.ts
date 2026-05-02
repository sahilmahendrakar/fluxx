function sanitiseTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Generated Flux work branch (`flux/task-<id>`). */
export function fluxTaskWorkBranchName(taskId: string): string {
  return `flux/task-${sanitiseTaskId(taskId)}`;
}
