/** Pure render gates for git-dependent UI (unit-tested without React). */

export function shouldShowGithubPrIconButton(props: {
  gitEnabled?: boolean;
  hasWorktree: boolean;
  onTaskPrClick?: (taskId: string) => void;
}): boolean {
  if (props.gitEnabled === false) return false;
  return props.hasWorktree && typeof props.onTaskPrClick === 'function';
}

export function shouldShowTaskSourceBranchPicker(gitEnabled?: boolean): boolean {
  return gitEnabled !== false;
}
