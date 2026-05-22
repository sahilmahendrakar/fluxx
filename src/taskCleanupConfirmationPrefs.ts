/** localStorage key: skip task workspace cleanup confirmation (board broom + session chrome). */
export const TASK_CLEANUP_SKIP_CONFIRMATION_KEY = 'flux.taskCleanupSkipConfirmation.v1';

export function readTaskCleanupSkipConfirmation(): boolean {
  try {
    return localStorage.getItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTaskCleanupSkipConfirmation(skip: boolean): void {
  try {
    if (skip) {
      localStorage.setItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY, '1');
    } else {
      localStorage.removeItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY);
    }
  } catch {
    /* quota / private mode */
  }
}
