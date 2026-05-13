import type { Agent, Task, TaskStatus } from './types';
import { effectiveTaskRepoId } from './repoIdentity';
import { normalizeTaskLabels } from './taskLabels';

/** `'all'` shows every column; otherwise only tasks in that status. */
export type BoardStatusFilter = 'all' | TaskStatus;

export const UNLABELED_VALUE = '__unlabeled__' as const;

export type BoardLabelFilter = typeof UNLABELED_VALUE | string | null;

export const UNASSIGNED_ASSIGNEE_VALUE = '__unassigned__' as const;

export type BoardAssigneeFilter = typeof UNASSIGNED_ASSIGNEE_VALUE | string | null;

export type BoardFilterState = {
  search: string;
  includeDescription: boolean;
  agent: Agent | 'all';
  status: BoardStatusFilter;
  label: BoardLabelFilter;
  assignee: BoardAssigneeFilter;
  hideDone: boolean;
  /** When set, only tasks whose effective repo id matches (multi-repo board). */
  repoId: string | null;
};

export const DEFAULT_BOARD_FILTER: BoardFilterState = {
  search: '',
  includeDescription: true,
  agent: 'all',
  status: 'all',
  label: null,
  assignee: null,
  hideDone: false,
  repoId: null,
};

function textMatches(query: string, value: string | undefined): boolean {
  if (value == null || value === '') {
    return false;
  }
  return value.toLowerCase().includes(query);
}

export type ApplyBoardFiltersRepoContext = {
  primaryRepoId: string;
};

/**
 * Subset of tasks shown on the board; does not mutate the task list.
 * Label filter uses the same case rules as `normalizeTaskLabels` for matching.
 */
export function applyBoardFilters(
  tasks: readonly Task[],
  filters: BoardFilterState,
  repoContext?: ApplyBoardFiltersRepoContext,
): Task[] {
  const q = filters.search.trim().toLowerCase();
  const wantRepoId = filters.repoId?.trim() ?? null;
  return tasks.filter((t) => {
    if (filters.hideDone && t.status === 'done') {
      return false;
    }
    if (wantRepoId != null && wantRepoId !== '') {
      const primary = repoContext?.primaryRepoId?.trim();
      if (primary != null && primary !== '') {
        if (effectiveTaskRepoId(t, primary) !== wantRepoId) {
          return false;
        }
      } else if ((t.repoId ?? '').trim() !== wantRepoId) {
        return false;
      }
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
    if (filters.assignee != null) {
      const taskAssignee = t.assigneeId;
      if (filters.assignee === UNASSIGNED_ASSIGNEE_VALUE) {
        if (taskAssignee != null && taskAssignee !== '') return false;
      } else if (taskAssignee !== filters.assignee) {
        return false;
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
    f.assignee !== defaults.assignee ||
    f.hideDone !== defaults.hideDone ||
    f.repoId !== defaults.repoId
  );
}
