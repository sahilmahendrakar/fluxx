import type { Task, TaskPullRequestIpcResult } from '../../types';
import { notifyAutoTaskTransition } from '../notifyAutoTaskTransition';
import { buildCloudGithubPrRefreshPatch } from './cloudGithubPrRefreshReconcile';
import type { TaskProvider } from './TaskProvider';

/**
 * After `tasks:refreshPullRequest` succeeds, sync cloud tasks to Firestore (local
 * tasks are updated in the main process, which broadcasts `tasks:changed`).
 */
export async function applyGithubPrRefreshFromRenderer(input: {
  projectKind: 'local' | 'cloud';
  taskId: string;
  live: Task;
  snapshot: Task[];
  result: Extract<TaskPullRequestIpcResult, { ok: true }>;
  provider: TaskProvider | null;
  autoMarkDoneWhenPrMerged: boolean;
  autoMoveToReviewWhenPrOpen: boolean;
  gitIntegrationEnabled?: boolean;
  onCloudPrMergedAutoDone?: (args: { previous: Task; updated: Task }) => Promise<void>;
}): Promise<void> {
  const {
    projectKind,
    taskId,
    live,
    snapshot,
    result,
    provider,
    autoMarkDoneWhenPrMerged,
    autoMoveToReviewWhenPrOpen,
    gitIntegrationEnabled,
    onCloudPrMergedAutoDone,
  } = input;
  if (projectKind === 'local') {
    if (provider?.reloadFromMain) {
      await provider.reloadFromMain();
    }
    return;
  }
  if (!provider) return;
  const patch = buildCloudGithubPrRefreshPatch({
    live,
    refreshed: result.githubPr,
    snapshot,
    autoMarkDoneWhenPrMerged,
    autoMoveToReviewWhenPrOpen,
    gitIntegrationEnabled,
  });
  if (!patch) return;
  const updated = await provider.update(taskId, patch);
  if (patch.status === 'done') {
    notifyAutoTaskTransition({
      task: live,
      previousStatus: live.status,
      nextStatus: 'done',
      reason: 'pr-merged',
    });
    if (onCloudPrMergedAutoDone) {
      await onCloudPrMergedAutoDone({ previous: live, updated });
    }
  } else if (patch.status === 'review') {
    notifyAutoTaskTransition({
      task: live,
      previousStatus: live.status,
      nextStatus: 'review',
      reason: 'pr-opened',
    });
  }
}
