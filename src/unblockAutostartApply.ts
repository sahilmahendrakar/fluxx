import { isTaskBlocked } from './taskDependencies';
import type { Task } from './types';
import {
  cloudUnblockAutostartAssigneeGateAllows,
  findDependentsForUnblockAutostart,
  shouldAutostartUnblockedTask,
  type UnblockAutostartPolicy,
} from './unblockAutostart';

export type UnblockAutostartApplyContext = {
  inFlight: Set<string>;
  source: string;
  logError: (msg: string, data: Record<string, unknown>) => void;
  getCurrentList: () => Task[];
  /**
   * Cloud renderer / done follow-up: when set (including `null` before auth),
   * skip unblock autostart for tasks assigned to someone else. Omit for local
   * main (single-user).
   */
  cloudUnblockAutostartClientUid?: string | null;
  startSession: (task: Task, all: Task[]) => Promise<unknown>;
  /**
   * Move a backlog task to in-progress. Use the environment’s main-process
   * auto-start (local) or skip it (cloud) via the other callback.
   */
  moveBacklogToInProgress: (id: string) => Promise<void>;
  /**
   * When “in progress” auto-start is off but dependency-unblock still wants a
   * session, after moving to in-progress with no implicit start, run the session.
   */
  moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: (id: string) => Promise<void>;
};

/**
 * After a task transitions to `done`, run follow-up for dependents (shared by
 * main and cloud renderer). Callers build `getCurrentList` / move callbacks.
 */
export async function applyUnblockAutostartForCompletedBlocker(
  previous: Task,
  completed: Task,
  allBefore: Task[],
  allAfter: Task[],
  policy: UnblockAutostartPolicy,
  ctx: UnblockAutostartApplyContext,
): Promise<void> {
  if (completed.status !== 'done' || previous.status === 'done') {
    return;
  }
  const dependents = findDependentsForUnblockAutostart(
    completed,
    previous,
    allBefore,
    allAfter,
  );
  const sorted = [...dependents].sort((a, b) => a.id.localeCompare(b.id));
  for (const d of sorted) {
    if (!shouldAutostartUnblockedTask(d, policy)) {
      continue;
    }
    if (ctx.inFlight.has(d.id)) {
      continue;
    }
    ctx.inFlight.add(d.id);
    try {
      const columnTasks = ctx.getCurrentList();
      const current = columnTasks.find((t) => t.id === d.id) ?? d;
      if (
        ctx.cloudUnblockAutostartClientUid !== undefined &&
        !cloudUnblockAutostartAssigneeGateAllows(current, ctx.cloudUnblockAutostartClientUid)
      ) {
        continue;
      }
      if (current.status === 'done' || isTaskBlocked(current, columnTasks)) {
        continue;
      }
      if (current.agent == null) {
        continue;
      }
      if (current.status === 'in-progress') {
        const started = await ctx.startSession(current, columnTasks);
        if (started && typeof started === 'object' && 'error' in (started as object)) {
          const e = started as { error: string; message: string };
          ctx.logError('[task:unblock-autostart] session start failed', {
            source: ctx.source,
            taskId: current.id,
            error: e.error,
            message: e.message,
          });
        }
      } else if (current.status === 'backlog') {
        if (policy.autoStartSessionOnInProgress) {
          await ctx.moveBacklogToInProgress(d.id);
        } else {
          await ctx.moveBacklogToInProgressThenStartSessionWithoutImplicitInProg(d.id);
        }
      }
    } catch (err) {
      ctx.logError('[task:unblock-autostart] unexpected failure', {
        source: ctx.source,
        taskId: d.id,
        err: String(err),
      });
    } finally {
      ctx.inFlight.delete(d.id);
    }
  }
}

export type { UnblockAutostartPolicy } from './unblockAutostart';
