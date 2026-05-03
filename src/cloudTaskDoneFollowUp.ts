import type { Task } from './types';
import { applyUnblockAutostartForCompletedBlocker } from './unblockAutostartApply';
import type { UnblockAutostartPolicy } from './unblockAutostart';
import type { TaskPatch, TaskProvider } from './renderer/tasks/TaskProvider';

/**
 * Auto workspace teardown on Done (cloud, pref on) runs only when the signed-in
 * client user is the task’s current assignee. Unassigned tasks never auto-clean
 * (assignee must use the broom). Callers must pass that user as `actorUid` (e.g.
 * merged-PR auto-Done in App passes `uidRef.current`); a null actor skips cleanup.
 */
export function shouldAutoTeardownWorkspaceForCloudDoneTransition(
  task: Task,
  actorUid: string | null,
): boolean {
  if (!actorUid) return false;
  const assignee = task.assigneeId;
  if (assignee == null || assignee === '') return false;
  return assignee === actorUid;
}

export type CloudDoneFollowUpResult = {
  task: Task;
  /** True when teardown + workspaceCleanedAt was applied (same as broom confirm). */
  workspaceCleaned: boolean;
};

/**
 * After a cloud task is persisted as `done`, run dependency auto-start, then
 * optionally run workspace cleanup (broom) when the project pref is enabled
 * and {@link shouldAutoTeardownWorkspaceForCloudDoneTransition} passes (assignee
 * matches `actorUid`: explicit Done transitions, MCP, or merged-PR refresh when wired).
 */
export async function runCloudDoneTransitionFollowUp(args: {
  previous: Task;
  updated: Task;
  /** Board snapshot with `updated` merged in for the edited row. */
  allAfter: Task[];
  provider: TaskProvider;
  actorUid: string | null;
  unblockInFlight: Set<string>;
  getTasks: () => Task[];
  /** Called with task id before cleanup starts and with `null` when finished (for UI loading). */
  setCleanupLoadingTaskId?: (taskId: string | null) => void;
  /** After teardown, clear session tabs for this task (renderer state). */
  onStripSessions?: (taskId: string) => void;
}): Promise<CloudDoneFollowUpResult> {
  const {
    previous,
    updated,
    allAfter,
    provider,
    actorUid,
    unblockInFlight,
    getTasks,
    setCleanupLoadingTaskId,
    onStripSessions,
  } = args;
  if (previous.status === 'done' || updated.status !== 'done') {
    return { task: updated, workspaceCleaned: false };
  }

  let inProg = false;
  let whenUnb = false;
  let autoCleanup = false;
  try {
    [inProg, whenUnb, autoCleanup] = await Promise.all([
      window.electronAPI.project.getAutoStartSessionOnInProgress(),
      window.electronAPI.project.getAutoStartWhenUnblocked(),
      window.electronAPI.project.getAutoCleanupWorkspaceWhenDone(),
    ]);
  } catch {
    return { task: updated, workspaceCleaned: false };
  }

  const policy: UnblockAutostartPolicy = {
    autoStartSessionOnInProgress: inProg,
    autoStartWhenUnblocked: whenUnb,
  };
  const allBefore = allAfter.map((x) => (x.id === updated.id ? previous : x));

  await applyUnblockAutostartForCompletedBlocker(previous, updated, allBefore, allAfter, policy, {
    inFlight: unblockInFlight,
    source: 'cloud:doneFollowUp',
    logError: (msg, data) => console.error(msg, data),
    getCurrentList: getTasks,
    cloudUnblockAutostartClientUid: actorUid ?? null,
    startSession: (task, all) =>
      window.electronAPI.sessions.start(task, all, actorUid ?? undefined),
    moveBacklogToInProgress: async (id) => {
      const row = getTasks().find((x) => x.id === id);
      const patch: TaskPatch = { status: 'in-progress' };
      if (actorUid && !row?.assigneeId) {
        patch.assigneeId = actorUid;
      }
      const moved = await provider.update(id, patch);
      if (inProg) {
        const all = getTasks().map((x) => (x.id === id ? moved : x));
        const r = await window.electronAPI.sessions.start(moved, all, actorUid ?? undefined);
        if (r && typeof r === 'object' && 'error' in r) {
          console.error('[task:unblock-autostart] session start failed', {
            taskId: id,
            error: (r as { error: string }).error,
          });
        }
      }
    },
    moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: async (id) => {
      const row = getTasks().find((x) => x.id === id);
      const patch: TaskPatch = { status: 'in-progress' };
      if (actorUid && !row?.assigneeId) {
        patch.assigneeId = actorUid;
      }
      const moved = await provider.update(id, patch);
      const all = getTasks().map((x) => (x.id === id ? moved : x));
      const r = await window.electronAPI.sessions.start(moved, all, actorUid ?? undefined);
      if (r && typeof r === 'object' && 'error' in r) {
        console.error('[task:unblock-autostart] session start failed', {
          taskId: id,
          error: (r as { error: string }).error,
        });
      }
    },
  });

  if (
    !autoCleanup ||
    updated.workspaceCleanedAt ||
    !shouldAutoTeardownWorkspaceForCloudDoneTransition(updated, actorUid)
  ) {
    return { task: updated, workspaceCleaned: false };
  }

  setCleanupLoadingTaskId?.(updated.id);
  try {
    const { errors } = await window.electronAPI.tasks.cleanupResources(updated.id);
    onStripSessions?.(updated.id);
    if (errors.length > 0) {
      console.error('[cloudTaskDoneFollowUp] cleanupResources', errors);
      return { task: updated, workspaceCleaned: false };
    }
    const patched = await provider.update(updated.id, {
      workspaceCleanedAt: new Date().toISOString(),
    });
    return { task: patched, workspaceCleaned: true };
  } finally {
    setCleanupLoadingTaskId?.(null);
  }
}
