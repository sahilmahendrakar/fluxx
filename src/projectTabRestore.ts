import type { ActiveProjectKey, ProjectTabState } from './types';

const STATIC_TAB_IDS = new Set(['board', 'plan', 'docs']);
const PLAN_TAB_PREFIX = 'plan:';

/** Matches `projectStateKey` in `src/main/AppStateStore.ts` (renderer-safe). */
export function activeProjectKeyString(key: ActiveProjectKey): string {
  return `${key.kind}:${key.id}`;
}

/**
 * Turn persisted per-project tab state into renderer-ready values.
 * `openTaskIds` on disk are **daemon session ids** for workspace tabs (not Flux task ids).
 */
export function normalizeRestoredProjectTabState(
  persisted: ProjectTabState,
  aliveSessionIds: ReadonlySet<string>,
): {
  openTaskIds: string[];
  openPlanningTabIds: string[];
  planningSidebarActiveSessionId: string | null;
  planningSidebarOpen: boolean;
  activeTabId: string;
  openSettingsRoute: boolean;
} {
  const restoredOpen = persisted.openTaskIds.filter((id) => aliveSessionIds.has(id));
  const openPlanning = persisted.openPlanningTabIds ?? [];

  let activeTabId = 'board';
  let openSettingsRoute = false;

  if (persisted.activeTaskId === 'settings') {
    openSettingsRoute = true;
  } else if (
    persisted.activeTaskId &&
    (STATIC_TAB_IDS.has(persisted.activeTaskId) ||
      persisted.activeTaskId.startsWith(PLAN_TAB_PREFIX) ||
      aliveSessionIds.has(persisted.activeTaskId))
  ) {
    activeTabId = persisted.activeTaskId;
  }

  return {
    openTaskIds: restoredOpen,
    openPlanningTabIds: [...openPlanning],
    planningSidebarActiveSessionId: persisted.planningSidebarActiveSessionId ?? null,
    planningSidebarOpen: persisted.planningSidebarOpen === true,
    activeTabId,
    openSettingsRoute,
  };
}
