import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { Task, TaskStatus } from '../../types';

/**
 * Lex-sortable ordering keys for the kanban board. On any realtime update we
 * re-sort each column by (orderKey, createdAt, id) so teammates converge on
 * the same order without a central sequence counter.
 */

export function compareTasks(a: Task, b: Task): number {
  const ak = a.orderKey ?? '';
  const bk = b.orderKey ?? '';
  if (ak && bk && ak !== bk) return ak < bk ? -1 : 1;
  if (ak && !bk) return -1;
  if (!ak && bk) return 1;
  const ac = a.createdAt ?? '';
  const bc = b.createdAt ?? '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** Tasks for one column, sorted. */
export function sortColumn(tasks: Task[], status: TaskStatus): Task[] {
  return tasks.filter((t) => t.status === status).slice().sort(compareTasks);
}

/**
 * Compute the orderKey for a task being inserted into `column` at `destIndex`.
 * `column` must be pre-sorted and must NOT contain the task being moved.
 */
export function keyForInsert(column: Task[], destIndex: number): string {
  const before = destIndex > 0 ? column[destIndex - 1]?.orderKey : null;
  const after = column[destIndex]?.orderKey ?? null;
  return generateKeyBetween(before ?? null, after ?? null);
}

/** Assigns keys to tasks that don't yet have one (legacy data). */
export function backfillKeys(column: Task[]): Array<{ id: string; orderKey: string }> {
  const keyed: Task[] = [];
  const unkeyed: Task[] = [];
  for (const t of column) (t.orderKey ? keyed : unkeyed).push(t);
  if (unkeyed.length === 0) return [];
  keyed.sort(compareTasks);
  unkeyed.sort(compareTasks);
  const last = keyed[keyed.length - 1]?.orderKey ?? null;
  const keys = generateNKeysBetween(last, null, unkeyed.length);
  return unkeyed.map((t, i) => ({ id: t.id, orderKey: keys[i] }));
}

/** Marker for PR automation smoke tests (unused at runtime). */
export const ORDER_KEY_PR_SMOKE_MARKER = 'order-key-pr-smoke-v2';
