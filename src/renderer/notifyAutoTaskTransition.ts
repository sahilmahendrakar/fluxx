import type { Task, TaskStatus } from '../types';
import type { AutoTransitionReason } from '../taskAutoTransitionNotification';

/** Fire-and-forget desktop notification for an automatic status transition (renderer → main). */
export function notifyAutoTaskTransition(args: {
  task: Pick<Task, 'title'>;
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  reason: AutoTransitionReason;
}): void {
  void window.electronAPI.notifications
    .notifyAutoTransition({
      taskTitle: args.task.title,
      previousStatus: args.previousStatus,
      nextStatus: args.nextStatus,
      reason: args.reason,
    })
    .catch((err) => {
      console.warn('[task:notify] IPC notifyAutoTransition failed', {
        nextStatus: args.nextStatus,
        reason: args.reason,
        err: String(err),
      });
    });
}
