/**
 * Task labels (feature tags): trim, drop empties, dedupe case-insensitively.
 * The first occurrence’s casing is kept (e.g. "Foo" wins over "foo").
 * For persistence, omit the `labels` field when the result is empty.
 */
export function normalizeTaskLabels(
  input: string[] | undefined | null,
): string[] {
  if (input == null || input.length === 0) {
    return [];
  }
  const byLower = new Map<string, string>();
  for (const raw of input) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (t === '') {
      continue;
    }
    const k = t.toLowerCase();
    if (!byLower.has(k)) {
      byLower.set(k, t);
    }
  }
  return Array.from(byLower.values());
}

/** Unique labels used across tasks, sorted for display (first spelling kept per case-insensitive key). */
export function projectLabelCatalog(
  tasks: ReadonlyArray<{ labels?: string[] }>,
): string[] {
  const byLower = new Map<string, string>();
  for (const t of tasks) {
    for (const raw of t.labels ?? []) {
      if (typeof raw !== 'string') {
        continue;
      }
      const trim = raw.trim();
      if (trim === '') {
        continue;
      }
      const k = trim.toLowerCase();
      if (!byLower.has(k)) {
        byLower.set(k, trim);
      }
    }
  }
  return Array.from(byLower.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}
