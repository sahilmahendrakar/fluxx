/** Short label for badges: full path when short, otherwise `…/basename.md`. */
export function compactPlanningDocPathLabel(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (trimmed.length <= 40) return trimmed;
  const segs = trimmed.split('/').filter(Boolean);
  const base = segs.length > 0 ? segs[segs.length - 1] : trimmed;
  return `…/${base}`;
}
