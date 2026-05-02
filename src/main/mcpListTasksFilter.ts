import type { TaskStatus } from '../types';

/** Task column values accepted by `flux__list_tasks` `excludeStatuses`. */
export const FLUX_TASK_STATUS_VALUES = [
  'backlog',
  'in-progress',
  'needs-input',
  'done',
] as const satisfies readonly TaskStatus[];

/** Drop tasks whose `status` appears in `excludeStatuses`; no-op when absent or empty. */
export function filterTasksByExcludeStatuses<T extends { status: TaskStatus }>(
  tasks: T[],
  excludeStatuses?: TaskStatus[] | undefined,
): T[] {
  if (excludeStatuses == null || excludeStatuses.length === 0) {
    return tasks;
  }
  const excluded = new Set(excludeStatuses);
  return tasks.filter((t) => !excluded.has(t.status));
}
