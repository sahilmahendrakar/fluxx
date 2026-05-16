import { isTaskBlocked } from './taskDependencies';
import type { Task } from './types';

export type CloudInProgressAutostartContext = {
  source: string;
  inFlight: Set<string>;
  logError: (msg: string, data: Record<string, unknown>) => void;
  /** Signed-in user moving / updating the task; used for assignee + autostart gating. */
  actorUid: string | null;
};

/**
 * Cloud in-progress autostart runs only when the actor may work this task:
 * — was already assigned to the actor, or
 * — was unclaimed and the persisted task is now assigned to the actor (caller must patch assignee when claiming).
 * Does not autostart when the task was assigned to someone else.
 */
export function cloudInProgressAutostartAllowedByAssignee(
  previous: Task,
  freshTask: Task,
  actorUid: string | null,
): boolean {
  if (!actorUid) return false;
  const prev = previous.assigneeId;
  if (prev && prev !== actorUid) return false;
  if (!prev && freshTask.assigneeId !== actorUid) return false;
  return true;
}

/**
 * After a successful cloud task write moves a task from **Backlog** into `in-progress`, mirror
 * `maybeAutoStartSessionOnInProgressTransition` from main (local tasks use main’s path).
 */
export async function maybeCloudAutoStartSessionOnInProgressTransition(
  previous: Task,
  updated: Task,
  allTasksForSession: Task[],
  ctx: CloudInProgressAutostartContext,
): Promise<void> {
  const backlogToInProgress =
    previous.status === 'backlog' && updated.status === 'in-progress';
  if (!backlogToInProgress) return;

  if (ctx.inFlight.has(updated.id)) return;
  ctx.inFlight.add(updated.id);
  try {
    let enabled = false;
    try {
      enabled = await window.electronAPI.project.getAutoStartSessionOnInProgress();
    } catch (err) {
      ctx.logError('[task:auto-start] failed to read setting', {
        source: ctx.source,
        taskId: updated.id,
        err: String(err),
      });
      return;
    }
    if (!enabled) return;

    const fresh = allTasksForSession.find((t) => t.id === updated.id) ?? updated;
    if (fresh.status !== 'in-progress') return;
    if (fresh.agent == null) return;
    if (!cloudInProgressAutostartAllowedByAssignee(previous, fresh, ctx.actorUid)) {
      return;
    }
    if (isTaskBlocked(fresh, allTasksForSession)) {
      console.warn('[task:auto-start] skipped — task has incomplete blockers', {
        source: ctx.source,
        taskId: updated.id,
      });
      return;
    }

    try {
      const started = await window.electronAPI.sessions.start(
        fresh,
        allTasksForSession,
        ctx.actorUid ?? undefined,
      );
      if (started && typeof started === 'object' && 'error' in started) {
        const e = started as { error: string; message?: string };
        ctx.logError('[task:auto-start] session start failed', {
          source: ctx.source,
          taskId: updated.id,
          error: e.error,
          message: e.message,
        });
      }
    } catch (err) {
      ctx.logError('[task:auto-start] unexpected failure', {
        source: ctx.source,
        taskId: updated.id,
        err: String(err),
      });
    }
  } finally {
    ctx.inFlight.delete(updated.id);
  }
}
