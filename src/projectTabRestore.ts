import type {
  ActiveProjectKey,
  PlanningSession,
  ProjectTabState,
  RestorableSessionIds,
  Session,
} from './types';
import { isPlanningSessionResumable } from './components/planningResumeUi';

const STATIC_TAB_IDS = new Set(['board', 'plan', 'docs']);
const PLAN_TAB_PREFIX = 'plan:';

/** Matches `projectStateKey` in `src/main/AppStateStore.ts` (renderer-safe). */
export function activeProjectKeyString(key: ActiveProjectKey): string {
  return `${key.kind}:${key.id}`;
}

export type RestorableSessionIdSets = {
  taskSessionIds: ReadonlySet<string>;
  planningSessionIds: ReadonlySet<string>;
};

export function restorableSessionIdSets(ids: RestorableSessionIds): RestorableSessionIdSets {
  return {
    taskSessionIds: new Set(ids.taskSessionIds),
    planningSessionIds: new Set(ids.planningSessionIds),
  };
}

/** Union IPC restorable ids with live/cold rows already returned by list handlers. */
export function mergeRestorableSessionIdSets(
  fromIpc: RestorableSessionIds,
  projectSessions: readonly Session[],
  planningSessions: readonly PlanningSession[],
  projectId: string,
): RestorableSessionIdSets {
  const taskSessionIds = new Set(fromIpc.taskSessionIds);
  for (const s of projectSessions) {
    if (s.projectId === projectId) taskSessionIds.add(s.id);
  }
  const planningSessionIds = new Set(fromIpc.planningSessionIds);
  for (const s of planningSessions) {
    if (s.projectId === projectId) planningSessionIds.add(s.id);
  }
  return { taskSessionIds, planningSessionIds };
}

/**
 * Turn persisted per-project tab state into renderer-ready values.
 * `openTaskIds` on disk are **daemon session ids** for workspace tabs (not Flux task ids).
 * Tabs are kept when the session is live or cold-resumable (interrupted after hard quit).
 */
export function normalizeRestoredProjectTabState(
  persisted: ProjectTabState,
  restorable: RestorableSessionIdSets,
): {
  openTaskIds: string[];
  openPlanningTabIds: string[];
  planningSidebarActiveSessionId: string | null;
  planningSidebarOpen: boolean;
  minimizedTaskWorkspaceIds: string[];
  activeTabId: string;
  openSettingsRoute: boolean;
} {
  const restoredOpen = persisted.openTaskIds.filter((id) =>
    restorable.taskSessionIds.has(id),
  );
  const rawMinimized = persisted.minimizedTaskWorkspaceIds ?? [];
  const minimizedTaskWorkspaceIds = rawMinimized.filter((id) =>
    restorable.taskSessionIds.has(id),
  );
  const openPlanning = (persisted.openPlanningTabIds ?? []).filter((id) =>
    restorable.planningSessionIds.has(id),
  );

  const sidebarActive = persisted.planningSidebarActiveSessionId ?? null;
  const planningSidebarActiveSessionId =
    sidebarActive && restorable.planningSessionIds.has(sidebarActive) ? sidebarActive : null;

  let activeTabId = 'board';
  let openSettingsRoute = false;

  if (persisted.activeTaskId === 'settings') {
    openSettingsRoute = true;
  } else if (persisted.activeTaskId) {
    if (STATIC_TAB_IDS.has(persisted.activeTaskId)) {
      activeTabId = persisted.activeTaskId;
    } else if (persisted.activeTaskId.startsWith(PLAN_TAB_PREFIX)) {
      const planSid = persisted.activeTaskId.slice(PLAN_TAB_PREFIX.length);
      if (restorable.planningSessionIds.has(planSid)) {
        activeTabId = persisted.activeTaskId;
      }
    } else if (restorable.taskSessionIds.has(persisted.activeTaskId)) {
      activeTabId = persisted.activeTaskId;
    }
  }

  return {
    openTaskIds: restoredOpen,
    openPlanningTabIds: openPlanning,
    planningSidebarActiveSessionId,
    planningSidebarOpen: persisted.planningSidebarOpen === true,
    minimizedTaskWorkspaceIds,
    activeTabId,
    openSettingsRoute,
  };
}

/**
 * Resolves planning sidebar active session after tab normalization.
 * Handles persisted active ids that hydrate in planning.list after restorable IPC,
 * and single interrupted rows when only `planningSidebarOpen` was persisted.
 */
export function resolvePlanningSidebarActiveId(
  persisted: ProjectTabState,
  planningSessions: readonly PlanningSession[],
  normalized: Pick<
    ReturnType<typeof normalizeRestoredProjectTabState>,
    'planningSidebarActiveSessionId' | 'planningSidebarOpen'
  >,
): string | null {
  if (normalized.planningSidebarActiveSessionId) {
    return normalized.planningSidebarActiveSessionId;
  }
  if (!normalized.planningSidebarOpen) return null;

  const interrupted = planningSessions.filter((s) => s.status === 'interrupted');
  const resumable = planningSessions.filter(isPlanningSessionResumable);

  const persistedId = persisted.planningSidebarActiveSessionId ?? null;
  if (persistedId) {
    const match = planningSessions.find((s) => s.id === persistedId);
    if (match && isPlanningSessionResumable(match)) return persistedId;
    const coldMatch = interrupted.find((s) => s.id === persistedId);
    if (coldMatch) return persistedId;
  }

  if (interrupted.length === 1) return interrupted[0].id;
  if (resumable.length === 1) return resumable[0].id;
  return null;
}

/** Hide orphan cold task rows from the workspace sidebar (open tabs + minimized only). */
export function filterSessionsForWorkspaceSidebar(
  sessions: readonly Session[],
  projectId: string,
  openTabIds: ReadonlySet<string>,
  minimizedWorkspaceIds: ReadonlySet<string>,
): Session[] {
  return sessions.filter((s) => {
    if (s.projectId !== projectId) return false;
    if (s.status === 'running') return true;
    return openTabIds.has(s.id) || minimizedWorkspaceIds.has(s.id);
  });
}
