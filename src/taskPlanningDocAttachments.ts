/** Chip state for an attached planning doc path in task detail. */
export type AttachedPlanningDocChipPresence = 'present' | 'missing' | 'pending';

/**
 * Whether an attached path should render as present, missing, or still resolving.
 * While the planning doc list is loading or has not been fetched yet, returns `pending`
 * so callers do not treat an empty list as "file not found".
 */
export function attachedPlanningDocChipPresence(
  relativePath: string,
  listedPaths: ReadonlySet<string>,
  listKnown: boolean,
  listLoading: boolean,
): AttachedPlanningDocChipPresence {
  if (listLoading || !listKnown) return 'pending';
  return listedPaths.has(relativePath) ? 'present' : 'missing';
}

/** Short label for badges: full path when short, otherwise `…/basename.md`. */
export function compactPlanningDocPathLabel(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (trimmed.length <= 40) return trimmed;
  const segs = trimmed.split('/').filter(Boolean);
  const base = segs.length > 0 ? segs[segs.length - 1] : trimmed;
  return `…/${base}`;
}
