import type { Agent, Task, TaskStatus } from './types';
import { normalizeTaskLabels } from './taskLabels';

/** `'all'` shows every column; otherwise only tasks in that status. */
export type BoardStatusFilter = 'all' | TaskStatus;

export const UNLABELED_VALUE = '__unlabeled__' as const;

export type BoardLabelFilter = typeof UNLABELED_VALUE | string | null;

export type BoardFilterState = {
  search: string;
  includeDescription: boolean;
  agent: Agent | 'all';
  status: BoardStatusFilter;
  label: BoardLabelFilter;
  hideDone: boolean;
};

export const DEFAULT_BOARD_FILTER: BoardFilterState = {
  search: '',
  includeDescription: true,
  agent: 'all',
  status: 'all',
  label: null,
  hideDone: false,
};

function textMatches(query: string, value: string | undefined): boolean {
  if (value == null || value === '') {
    return false;
  }
  return value.toLowerCase().includes(query);
}

/**
 * Subset of tasks shown on the board; does not mutate the task list.
 * Label filter uses the same case rules as `normalizeTaskLabels` for matching.
 */
export function applyBoardFilters(
  tasks: readonly Task[],
  filters: BoardFilterState,
): Task[] {
  const q = filters.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (filters.hideDone && t.status === 'done') {
      return false;
    }
    if (filters.agent !== 'all' && t.agent !== filters.agent) {
      return false;
    }
    if (filters.status !== 'all' && t.status !== filters.status) {
      return false;
    }
    if (filters.label != null) {
      const normalized = normalizeTaskLabels(t.labels);
      if (filters.label === UNLABELED_VALUE) {
        if (normalized.length > 0) return false;
      } else {
        const want = filters.label.toLowerCase();
        if (!normalized.some((l) => l.toLowerCase() === want)) {
          return false;
        }
      }
    }
    if (q) {
      const inTitle = textMatches(q, t.title);
      const inDesc =
        filters.includeDescription && textMatches(q, t.description);
      if (!inTitle && !inDesc) {
        return false;
      }
    }
    return true;
  });
}

export function boardFiltersAreActive(
  f: BoardFilterState,
  defaults: BoardFilterState = DEFAULT_BOARD_FILTER,
): boolean {
  return (
    f.search.trim() !== defaults.search.trim() ||
    f.includeDescription !== defaults.includeDescription ||
    f.agent !== defaults.agent ||
    f.status !== defaults.status ||
    f.label !== defaults.label ||
    f.hideDone !== defaults.hideDone
  );
}
