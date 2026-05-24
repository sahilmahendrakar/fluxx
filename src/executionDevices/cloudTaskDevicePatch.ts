import type { TaskExecutionDeviceRef } from '../types';
import {
  isPrivateDirectExecutionDeviceKind,
  shouldPersistExecutionDeviceToFirestore,
} from './parse';

export type CloudExecutionDevicePatchRoute =
  | 'local-binding-only'
  | 'firestore-only'
  | 'clear-local-binding'
  | 'noop';

/**
 * How a cloud task `executionDevice` patch should be routed (never writes private SSH to Firestore).
 */
export function cloudExecutionDevicePatchRoute(
  patch: TaskExecutionDeviceRef | null | undefined,
): CloudExecutionDevicePatchRoute {
  if (patch === undefined) return 'noop';
  if (patch === null) return 'clear-local-binding';
  if (shouldPersistExecutionDeviceToFirestore(patch)) return 'firestore-only';
  if (isPrivateDirectExecutionDeviceKind(patch.kind)) return 'local-binding-only';
  return 'noop';
}

export function firestoreUpdateIncludesExecutionDevice(
  patch: TaskExecutionDeviceRef | null | undefined,
): boolean {
  return (
    patch !== undefined &&
    shouldPersistExecutionDeviceToFirestore(patch ?? undefined)
  );
}
