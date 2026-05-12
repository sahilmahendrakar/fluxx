/**
 * Case-insensitive substring match for board filter picker rows.
 * Empty / whitespace-only query matches every label (caller handles “show all”).
 */
export function boardFilterPickerLabelMatches(query: string, label: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return true;
  }
  return label.toLowerCase().includes(q);
}

export function filterByBoardFilterPickerQuery<T>(
  query: string,
  items: readonly T[],
  getLabel: (item: T) => string,
): T[] {
  const q = query.trim();
  if (q.length === 0) {
    return [...items];
  }
  return items.filter((item) => boardFilterPickerLabelMatches(q, getLabel(item)));
}
