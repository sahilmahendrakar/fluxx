import type { ActiveProjectKey, LocalProject, Task, TaskExecutionDeviceRef } from '../types';
import type { DeviceStore } from './DeviceStore';
import type { LocalBindingStore } from './LocalBindingStore';
import type { ProjectStore } from './ProjectStore';
import {
  resolveDefaultExecutionDeviceForNewTask,
  resolveEffectiveExecutionDeviceForTask,
} from '../executionDevices/resolve';
import {
  parseTaskExecutionDeviceRef,
  validateTaskExecutionDeviceRef,
} from '../executionDevices/parse';

export type ExecutionDeviceHostContext = {
  deviceStore: DeviceStore;
  projectStore: ProjectStore;
  bindingStore: LocalBindingStore;
  activeKey: ActiveProjectKey | null;
};

export function projectDefaultDeviceIdForContext(
  ctx: ExecutionDeviceHostContext,
): string | undefined {
  const key = ctx.activeKey;
  if (!key) return undefined;
  if (key.kind === 'local') {
    return ctx.projectStore.get()?.defaultDeviceId;
  }
  return ctx.bindingStore.get(key.id)?.defaultDeviceId;
}

export function cloudPerTaskDeviceOverride(
  ctx: ExecutionDeviceHostContext,
  taskId: string,
): TaskExecutionDeviceRef | undefined {
  if (ctx.activeKey?.kind !== 'cloud') return undefined;
  return ctx.bindingStore.getPerTaskDeviceOverride(ctx.activeKey.id, taskId);
}

export function resolveEffectiveExecutionDeviceForTaskInContext(
  ctx: ExecutionDeviceHostContext,
  task: Pick<Task, 'id' | 'executionDevice'>,
): TaskExecutionDeviceRef {
  return resolveEffectiveExecutionDeviceForTask(task, {
    cloudPerTaskOverride:
      ctx.activeKey?.kind === 'cloud'
        ? cloudPerTaskDeviceOverride(ctx, task.id)
        : undefined,
    projectDefaultDeviceId: projectDefaultDeviceIdForContext(ctx),
    globalDefaultDeviceId: ctx.deviceStore.getGlobalDefaultDeviceId(),
  });
}

export function resolveDefaultExecutionDeviceForNewTaskInContext(
  ctx: ExecutionDeviceHostContext,
): TaskExecutionDeviceRef {
  return resolveDefaultExecutionDeviceForNewTask({
    projectDefaultDeviceId: projectDefaultDeviceIdForContext(ctx),
    globalDefaultDeviceId: ctx.deviceStore.getGlobalDefaultDeviceId(),
  });
}

export function validateExecutionDeviceRefForStore(
  deviceStore: DeviceStore,
  ref: TaskExecutionDeviceRef,
): { ok: true } | { ok: false; message: string } {
  return validateTaskExecutionDeviceRef(ref, deviceStore.getConfiguredDeviceIds());
}

export function parseAndValidateExecutionDeviceInput(
  deviceStore: DeviceStore,
  raw: unknown,
): { ok: true; ref: TaskExecutionDeviceRef } | { ok: false; message: string } {
  const ref = parseTaskExecutionDeviceRef(raw);
  if (!ref) {
    return { ok: false, message: 'Invalid executionDevice' };
  }
  const v = validateExecutionDeviceRefForStore(deviceStore, ref);
  if (!v.ok) return v;
  return { ok: true, ref };
}

export async function inferLegacyLocalTmuxForDeviceBootstrap(
  projectStore: ProjectStore,
  bindingStore: LocalBindingStore,
  activeKey: ActiveProjectKey | null,
): Promise<boolean | undefined> {
  if (activeKey?.kind === 'local') {
    const project = projectStore.get();
    if (project?.kind === 'local') {
      return project.persistTerminalsWithTmux;
    }
    try {
      const dir = projectStore.getProjectDir();
      if (dir) {
        return await projectStore.getPersistTerminalsWithTmuxAt(dir);
      }
    } catch {
      return undefined;
    }
  }
  if (activeKey?.kind === 'cloud') {
    const binding = bindingStore.get(activeKey.id);
    if (binding?.persistTerminalsWithTmux === true) return true;
    if (binding?.persistTerminalsWithTmux === false) return false;
  }
  return undefined;
}

export function localProjectDefaultDeviceId(project: LocalProject): string | undefined {
  return project.defaultDeviceId;
}
