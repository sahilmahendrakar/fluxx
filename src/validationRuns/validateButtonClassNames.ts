import type { TaskStatus } from '../types';

/** Filled Validate button (needs-input). */
export const validateButtonFilledClassName =
  'border-status-validation/40 bg-status-validation text-white hover:bg-status-validation/90 hover:text-white';

/** Outline Validate button (in-progress). */
export const validateButtonOutlineClassName =
  'border-status-validation/35 bg-status-validation/12 text-status-validation hover:bg-status-validation/20 dark:text-status-validation-foreground dark:hover:bg-status-validation/15';

export function validateButtonClassNameForStatus(status: TaskStatus): string {
  return status === 'needs-input' ? validateButtonFilledClassName : validateButtonOutlineClassName;
}
