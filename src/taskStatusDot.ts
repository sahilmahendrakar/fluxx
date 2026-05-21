import type { TaskStatus } from './types';

/** Kanban status dot colors (TaskCard, sidebar, session tabs). */
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  'in-progress': 'bg-emerald-400/80',
  'needs-input': 'bg-amber-400/80',
  review: 'bg-sky-400/85',
  backlog: 'bg-zinc-600',
  done: 'bg-zinc-600',
};

/** Dot class for a task workspace tab/sidebar row from board status + daemon run state. */
export function workspaceSessionStatusDotClass(
  taskStatus: TaskStatus | undefined,
  sessionRunning: boolean,
): string {
  if (!sessionRunning) return 'bg-zinc-600';
  if (!taskStatus) return 'bg-zinc-600';
  return TASK_STATUS_DOT[taskStatus];
}
