import type { Task, TaskGithubPr, TaskStatus } from './types';
import { isTaskBlocked } from './taskDependencies';

/**
 * Columns where an automatic Done transition on merged PR is allowed (avoids
 * pulling backlog items to Done without an explicit workflow step).
 */
const ALLOWED_STATUS_FOR_PR_MERGE_AUTO_DONE: ReadonlySet<TaskStatus> = new Set([
  'in-progress',
  'needs-input',
  'review',
]);

/**
 * True when GitHub PR metadata indicates the PR is merged (`state: 'merged'`
 * and/or a non-empty `mergedAt`), aligned with board refresh semantics.
 */
export function githubPrIndicatesMerged(githubPr: TaskGithubPr | undefined): boolean {
  if (!githubPr) return false;
  if (githubPr.state === 'merged') return true;
  if (typeof githubPr.mergedAt === 'string' && githubPr.mergedAt.trim() !== '') return true;
  return false;
}

/**
 * Whether to mark the task Done after a PR refresh that produced new merged
 * metadata. Requires a linked PR URL, allowed column, no incomplete blockers,
 * and the project preference enabled.
 */
export function shouldAutoMarkDoneAfterPrMergeRefresh(args: {
  task: Task;
  refreshedGithubPr: TaskGithubPr;
  prefEnabled: boolean;
  allTasks: Task[];
}): boolean {
  const { task, refreshedGithubPr, prefEnabled, allTasks } = args;
  if (!prefEnabled) return false;
  if (task.status === 'done') return false;
  if (!ALLOWED_STATUS_FOR_PR_MERGE_AUTO_DONE.has(task.status)) return false;
  const url = refreshedGithubPr.url?.trim() ?? task.githubPr?.url?.trim() ?? '';
  if (!url) return false;
  if (!githubPrIndicatesMerged(refreshedGithubPr)) return false;
  if (isTaskBlocked(task, allTasks)) return false;
  return true;
}
