import type { TaskExecutionDeviceRef } from '../types';
import {
  isSharedFirestoreExecutionDeviceKind,
  parseTaskExecutionDeviceRef,
  shouldPersistExecutionDeviceToFirestore,
} from './parse';

/** Reads team-visible execution device refs from Firestore (not direct-SSH v1). */
export function parseSharedExecutionDeviceFromFirestore(
  raw: unknown,
): { executionDevice: TaskExecutionDeviceRef } | Record<string, never> {
  const ref = parseTaskExecutionDeviceRef(raw);
  if (!ref || !isSharedFirestoreExecutionDeviceKind(ref.kind)) {
    return {};
  }
  return { executionDevice: ref };
}

export { shouldPersistExecutionDeviceToFirestore };
