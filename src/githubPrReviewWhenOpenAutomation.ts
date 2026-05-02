import type { TaskGithubPr, TaskStatus } from './types';
import { branchForTaskId } from './taskBranch';
import { normalizeGitBranchShortName } from './taskBranches';

/**
 * Columns from which an open PR may auto-move a task into Review. Keeps Needs input /
 * Review / Done untouched so enabling the pref does not surprise users, and pairs with
 * a future “Done when PR merged” automation (merged PRs are never `open`, so no
 * review ↔ done oscillation from this rule).
 */
export const AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'in-progress',
];

export function shouldAutoMoveTaskToReviewForOpenPr(input: {
  enabled: boolean;
  taskStatus: TaskStatus;
  githubPr: TaskGithubPr | undefined;
  taskId: string;
}): boolean {
  if (!input.enabled) return false;
  if (input.githubPr?.state !== 'open') return false;
  if (!AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES.includes(input.taskStatus)) {
    return false;
  }
  const head = input.githubPr.headBranch?.trim() ?? '';
  if (head.length > 0) {
    const expected = branchForTaskId(input.taskId);
    const nh = normalizeGitBranchShortName(head);
    const ne = normalizeGitBranchShortName(expected);
    if (nh && ne && nh !== ne) {
      return false;
    }
  }
  return true;
}
