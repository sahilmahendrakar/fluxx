import type { Session } from './types';

/**
 * When true, deleting the task should show an in-app confirm first (board `TaskCard` uses
 * disk worktree map + session list; any task-linked session covers agents before a path exists).
 */
export function taskDeleteNeedsWorkspaceConfirmation(
  taskId: string,
  sessions: Session[],
  taskHasWorktreeById: Record<string, boolean>,
): boolean {
  if (taskHasWorktreeById[taskId] === true) return true;
  return sessions.some((s) => s.taskId === taskId);
}
