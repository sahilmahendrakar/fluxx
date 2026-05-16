import { normalizePlanningDocRelativePath } from './planningDocs/path';

/**
 * Normalizes, validates, and de-duplicates planning markdown paths for task attachments.
 * Order follows first valid occurrence in `input`.
 */
export function normalizeAttachedPlanningDocPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const n = normalizePlanningDocRelativePath(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Short label for badges: full path when short, otherwise `…/basename.md`. */
export function compactPlanningDocPathLabel(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (trimmed.length <= 40) return trimmed;
  const segs = trimmed.split('/').filter(Boolean);
  const base = segs.length > 0 ? segs[segs.length - 1] : trimmed;
  return `…/${base}`;
}
