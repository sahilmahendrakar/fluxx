import type { TaskStatus } from './types';

/** Board columns that participate in background `refreshPullRequest` sweeps. */
const GITHUB_PR_BOARD_REFRESH_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'in-progress',
  'needs-input',
  'validation',
  'review',
]);

export function taskEligibleForGithubPrBoardRefresh(status: TaskStatus): boolean {
  return GITHUB_PR_BOARD_REFRESH_STATUSES.has(status);
}
