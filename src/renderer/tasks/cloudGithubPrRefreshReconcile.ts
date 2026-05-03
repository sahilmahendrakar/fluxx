import type { Task, TaskGithubPr } from '../../types';
import { githubPrRefreshViewEqual } from '../../githubPrMetadata';
import { shouldAutoMarkDoneAfterPrMergeRefresh } from '../../autoMarkDoneWhenPrMerged';
import { shouldAutoMoveTaskToReviewForOpenPr } from '../../githubPrReviewWhenOpenAutomation';
import { keyForInsert, sortColumn } from './orderKey';
import type { TaskPatch } from './TaskProvider';

/**
 * Builds a Firestore patch after `refreshPullRequest` for cloud tasks, including
 * status-only reconciliation when persisted PR metadata already matches GitHub.
 */
export function buildCloudGithubPrRefreshPatch(input: {
  live: Task;
  refreshed: TaskGithubPr;
  snapshot: Task[];
  autoMarkDoneWhenPrMerged: boolean;
  autoMoveToReviewWhenPrOpen: boolean;
}): TaskPatch | null {
  const { live, refreshed, snapshot, autoMarkDoneWhenPrMerged, autoMoveToReviewWhenPrOpen } = input;
  const prViewEqual = githubPrRefreshViewEqual(live.githubPr, refreshed);

  const patch: TaskPatch = {};
  if (!prViewEqual) {
    patch.githubPr = refreshed;
  }

  let automation = false;
  if (
    shouldAutoMarkDoneAfterPrMergeRefresh({
      task: live,
      refreshedGithubPr: refreshed,
      prefEnabled: autoMarkDoneWhenPrMerged,
      allTasks: snapshot,
    })
  ) {
    const destCol = sortColumn(
      snapshot.filter((t) => t.id !== live.id),
      'done',
    );
    let nextOrderKey: string;
    try {
      nextOrderKey = keyForInsert(destCol, destCol.length);
    } catch (err) {
      console.error('[githubPrRefresh] keyForInsert failed', live.id, err);
      nextOrderKey = String(Date.now());
    }
    patch.status = 'done';
    patch.orderKey = nextOrderKey;
    automation = true;
  } else if (
    shouldAutoMoveTaskToReviewForOpenPr({
      enabled: autoMoveToReviewWhenPrOpen,
      taskStatus: live.status,
      githubPr: refreshed,
      taskId: live.id,
    })
  ) {
    patch.status = 'review';
    automation = true;
  }

  if (!prViewEqual || automation) {
    return patch;
  }
  return null;
}
