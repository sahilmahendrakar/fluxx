import type { Task, TaskExecutionDeviceRef } from '../types';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';
import { resolveEffectiveExecutionDeviceForTask } from './resolve';

/**
 * Board/session chip resolution.
 * Cloud: only team-visible Firestore refs or this Desktop's local override — never
 * infer another teammate's private SSH choice from project/global defaults.
 * Local: full effective device (task field → defaults).
 */
export function resolveTaskChipExecutionDevice(
  task: Pick<Task, 'id' | 'executionDevice'>,
  ctx: ExecutionDeviceDefaults | undefined,
  opts?: { cloudProject?: boolean },
): TaskExecutionDeviceRef | undefined {
  if (opts?.cloudProject) {
    if (task.executionDevice) {
      return task.executionDevice;
    }
    const override = ctx?.cloudPerTaskOverrides?.[task.id];
    return override;
  }
  return resolveEffectiveExecutionDeviceForTask(task, {
    projectDefaultDeviceId: ctx?.projectDefaultDeviceId,
    globalDefaultDeviceId: ctx?.globalDefaultDeviceId,
    cloudPerTaskOverride: ctx?.cloudPerTaskOverrides?.[task.id],
  });
}
