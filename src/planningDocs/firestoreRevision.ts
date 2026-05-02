/**
 * Stable revision tokens derived from Firestore `updatedAt` timestamps.
 * Used for optimistic concurrency when pushing planning doc edits.
 */

export function revisionFromFirestoreUpdatedAt(updatedAt: unknown): string {
  if (
    updatedAt &&
    typeof updatedAt === 'object' &&
    'seconds' in updatedAt &&
    typeof (updatedAt as { seconds: unknown }).seconds === 'number'
  ) {
    const s = (updatedAt as { seconds: number }).seconds;
    const n =
      'nanoseconds' in updatedAt && typeof (updatedAt as { nanoseconds: unknown }).nanoseconds === 'number'
        ? (updatedAt as { nanoseconds: number }).nanoseconds
        : 0;
    return `${s}_${n}`;
  }
  if (
    updatedAt &&
    typeof updatedAt === 'object' &&
    typeof (updatedAt as { toMillis?: () => number }).toMillis === 'function'
  ) {
    return `ms_${(updatedAt as { toMillis: () => number }).toMillis()}`;
  }
  return 'unknown';
}
