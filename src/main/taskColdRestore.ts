import type { Session } from '../types';

/** Live task rows first; append cold-resume synthetics not already live (stable order). */
export function mergeTaskSessionsWithColdResume(
  live: Session[],
  cold: Session[],
): Session[] {
  const liveIds = new Set(live.map((s) => s.id));
  const merged = [...live];
  for (const row of cold) {
    if (!liveIds.has(row.id)) {
      merged.push(row);
    }
  }
  return merged;
}
