import type { TaskStatus } from './types';

/** Kanban status dot colors (TaskCard, sidebar, session tabs). */
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  'in-progress': 'bg-status-success',
  'needs-input': 'bg-status-needs-input',
  validation: 'bg-status-validation',
  review: 'bg-status-review',
  backlog: 'bg-muted-foreground/50',
  done: 'bg-muted-foreground/50',
};

/** Dot class for a task workspace tab/sidebar row from board status + daemon run state. */
export function workspaceSessionStatusDotClass(
  taskStatus: TaskStatus | undefined,
  sessionRunning: boolean,
): string {
  if (!sessionRunning) return 'bg-muted-foreground/50';
  if (!taskStatus) return 'bg-muted-foreground/50';
  return TASK_STATUS_DOT[taskStatus];
}
