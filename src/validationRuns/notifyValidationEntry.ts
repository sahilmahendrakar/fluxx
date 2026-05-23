import type { Task, TaskStatus } from '../types';

/** Cloud task updates: ask main to auto-start validation after entering Validation. */
export async function notifyCloudValidationEntryIfNeeded(
  previous: Pick<Task, 'status'>,
  updated: Task,
): Promise<void> {
  if (previous.status === updated.status || updated.status !== 'validation') return;
  await window.electronAPI.validationTasks.onEnteredValidation({
    previousStatus: previous.status as TaskStatus,
    task: updated,
  });
}
