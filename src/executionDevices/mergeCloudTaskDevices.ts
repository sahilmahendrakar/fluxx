import type { Task, TaskExecutionDeviceRef } from '../types';
import { isPrivateDirectExecutionDeviceKind } from './parse';

/** Applies per-machine cloud task device overrides onto Firestore task rows. */
export function mergeCloudTasksWithLocalDeviceOverrides(
  tasks: Task[],
  overrides: Record<string, TaskExecutionDeviceRef> | undefined,
): Task[] {
  if (!overrides || Object.keys(overrides).length === 0) {
    return tasks;
  }
  return tasks.map((t) => {
    const override = overrides[t.id];
    if (!override) return t;
    return { ...t, executionDevice: override };
  });
}

/**
 * Strips private direct-SSH device refs from Firestore-shaped tasks so teammates
 * do not see another user's SSH choice when shared fields are added later.
 */
export function stripPrivateExecutionDeviceFromFirestoreTask(task: Task): Task {
  const ref = task.executionDevice;
  if (!ref || !isPrivateDirectExecutionDeviceKind(ref.kind)) {
    return task;
  }
  const next = { ...task };
  delete next.executionDevice;
  return next;
}
