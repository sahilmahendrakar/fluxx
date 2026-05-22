import type { Task, TaskExecutionDeviceRef } from '../types';
import { builtInLocalDeviceRef } from './parse';

export type ExecutionDeviceResolutionInput = {
  /** Explicit task field (local tasks.json or merged cloud view). */
  taskExecutionDevice?: TaskExecutionDeviceRef;
  /** Cloud-only: per-task override from localBindings.json. */
  cloudPerTaskOverride?: TaskExecutionDeviceRef;
  /** Project default from config.json or cloud local binding. */
  projectDefaultDeviceId?: string;
  /** Global default from executionDevices.json. */
  globalDefaultDeviceId?: string;
};

function refFromDeviceId(
  deviceId: string,
  builtinLocalId: string,
): TaskExecutionDeviceRef {
  if (deviceId === builtinLocalId) {
    return { kind: 'local', deviceId };
  }
  return { kind: 'ssh', deviceId };
}

/**
 * Resolves the effective execution device for a task:
 * task explicit → cloud local override → project default → global default → built-in local.
 */
export function resolveEffectiveExecutionDevice(
  input: ExecutionDeviceResolutionInput,
  builtinLocalId: string = builtInLocalDeviceRef().deviceId,
): TaskExecutionDeviceRef {
  if (input.taskExecutionDevice) {
    return input.taskExecutionDevice;
  }
  if (input.cloudPerTaskOverride) {
    return input.cloudPerTaskOverride;
  }
  const projectDefault = input.projectDefaultDeviceId?.trim();
  if (projectDefault) {
    return refFromDeviceId(projectDefault, builtinLocalId);
  }
  const globalDefault = input.globalDefaultDeviceId?.trim();
  if (globalDefault) {
    return refFromDeviceId(globalDefault, builtinLocalId);
  }
  return builtInLocalDeviceRef();
}

/** Legacy tasks without a device field behave as local. */
export function resolveEffectiveExecutionDeviceForTask(
  task: Pick<Task, 'executionDevice'>,
  ctx: Omit<ExecutionDeviceResolutionInput, 'taskExecutionDevice'>,
): TaskExecutionDeviceRef {
  return resolveEffectiveExecutionDevice({
    ...ctx,
    taskExecutionDevice: task.executionDevice,
  });
}

/** Default device snapshot for new tasks (project → global → built-in local). */
export function resolveDefaultExecutionDeviceForNewTask(ctx: {
  projectDefaultDeviceId?: string;
  globalDefaultDeviceId?: string;
}): TaskExecutionDeviceRef {
  return resolveEffectiveExecutionDevice(ctx);
}
