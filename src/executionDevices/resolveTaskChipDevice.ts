import type { Task, TaskExecutionDeviceRef } from '../types';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';
import { resolveEffectiveExecutionDeviceForTask } from './resolve';

/** Board/session chip resolution — mirrors main-process effective device (incl. cloud overrides). */
export function resolveTaskChipExecutionDevice(
  task: Pick<Task, 'id' | 'executionDevice'>,
  ctx: ExecutionDeviceDefaults | undefined,
): TaskExecutionDeviceRef {
  return resolveEffectiveExecutionDeviceForTask(task, {
    projectDefaultDeviceId: ctx?.projectDefaultDeviceId,
    globalDefaultDeviceId: ctx?.globalDefaultDeviceId,
    cloudPerTaskOverride: ctx?.cloudPerTaskOverrides?.[task.id],
  });
}
