import { getBlockingTasks, getBlockedTasks, isTaskBlocked } from './taskDependencies';
import type { Task } from './types';

/** Per-project and per-task toggles, plus the existing “in progress” auto-start. */
export type UnblockAutostartPolicy = {
  autoStartSessionOnInProgress: boolean;
  /**
   * Project default for dependency-unblock autostart. Only applies when the task
   * has an assignee. Per-task `autoStartOnUnblock` overrides: `true` forces on,
   * `false` forces off, omitted inherits this flag.
   */
  autoStartWhenUnblocked: boolean;
};

/**
 * Cloud dependency-unblock autostart: when a task has an assignee, only that
 * member’s client should move it to in-progress or start a session.
 *
 * @param clientUid When `undefined`, the gate is skipped (local main process).
 *   When `null` or a string (cloud), an assigned task requires a matching uid.
 */
export function cloudUnblockAutostartAssigneeGateAllows(
  task: Task,
  clientUid: string | null | undefined,
): boolean {
  if (clientUid === undefined) return true;
  const assignee = task.assigneeId?.trim();
  if (!assignee) return true;
  if (clientUid == null || String(clientUid).trim() === '') return false;
  return assignee === String(clientUid).trim();
}

/**
 * Dependency-unblock auto-start only (ignores {@link UnblockAutostartPolicy.autoStartSessionOnInProgress}).
 * `autoStartOnUnblock`: omitted = inherit project default (when unblocked + assignee); `true` / `false` override.
 */
export function effectiveWhenUnblockedAutostart(task: Task, projectWhenUnblocked: boolean): boolean {
  if (task.autoStartOnUnblock === true) return true;
  if (task.autoStartOnUnblock === false) return false;
  return projectWhenUnblocked === true && Boolean(task.assigneeId?.trim());
}

/**
 * Board / detail UI: whether the blocked chip (and matching checkbox) should show the
 * “will auto-start when unblocked” state. When the project default is on, inheriting tasks
 * read as enabled unless explicitly opted out — even when an assignee is still required
 * at unblock time for cloud automation (see {@link effectiveWhenUnblockedAutostart}).
 */
export function whenUnblockedAutostartBoardChipEffective(
  task: Task,
  projectWhenUnblocked: boolean,
): boolean {
  if (task.autoStartOnUnblock === false) return false;
  if (task.autoStartOnUnblock === true) return true;
  return projectWhenUnblocked === true;
}

/**
 * Single-click toggle for the blocked-row control: flip effective when-unblocked autostart
 * and return a patch (`null` clears stored value = inherit project default).
 */
export function patchAutoStartOnUnblockAfterToggle(
  task: Task,
  projectWhenUnblocked: boolean,
): { autoStartOnUnblock: boolean | null } {
  const eff = whenUnblockedAutostartBoardChipEffective(task, projectWhenUnblocked);
  const cur = task.autoStartOnUnblock;

  if (eff) {
    if (cur === true) {
      return { autoStartOnUnblock: projectWhenUnblocked ? false : null };
    }
    return { autoStartOnUnblock: false };
  }
  if (cur === false) {
    return { autoStartOnUnblock: projectWhenUnblocked ? null : true };
  }
  return { autoStartOnUnblock: true };
}

export function shouldAutostartUnblockedTask(
  task: Task,
  policy: UnblockAutostartPolicy,
): boolean {
  if (task.status === 'done') return false;
  return (
    effectiveWhenUnblockedAutostart(task, policy.autoStartWhenUnblocked === true) ||
    policy.autoStartSessionOnInProgress === true
  );
}

/**
 * True if `dependent` has at least one non-done dependency in `before`, and
 * none in `after` (fully unblocked).
 */
export function isFullUnblockTransition(dependent: Task, before: Task[], after: Task[]): boolean {
  return getBlockingTasks(dependent, before).length > 0 && getBlockingTasks(dependent, after).length === 0;
}

/**
 * When `completedBlocker` transitions to done, return dependents that should
 * be considered for auto-start (eligibility: backlog / in-progress, not done, fully unblocked).
 * Policy is applied by the caller; this only finds structural matches.
 */
export function findDependentsForUnblockAutostart(
  completedBlocker: Task,
  beforeBlocker: Task,
  allBefore: Task[],
  allAfter: Task[],
): Task[] {
  if (beforeBlocker.status === 'done' || completedBlocker.status !== 'done') {
    return [];
  }
  const fromAfter = getBlockedTasks(completedBlocker.id, allAfter);
  return fromAfter.filter((d) => {
    if (d.id === completedBlocker.id) return false;
    if (d.status === 'done') return false;
    if (d.status !== 'backlog' && d.status !== 'in-progress') return false;
    if (!isFullUnblockTransition(d, allBefore, allAfter)) return false;
    if (isTaskBlocked(d, allAfter)) return false;
    return true;
  });
}
