import type { TaskStatus } from './types';

/** Status pill styles for task detail and dependency rows (theme-aware). */
export const TASK_STATUS_CHIP: Record<TaskStatus, string> = {
  backlog: 'border-border bg-muted/60 text-muted-foreground',
  'in-progress':
    'border-status-success/25 bg-status-success/15 text-status-success-foreground',
  'needs-input':
    'border-status-needs-input/25 bg-status-needs-input/15 text-status-needs-input-foreground',
  validation:
    'border-status-validation/25 bg-status-validation/15 text-status-validation-foreground',
  review: 'border-status-review/25 bg-status-review/15 text-status-review-foreground',
  done: 'border-border bg-muted/40 text-muted-foreground',
};
