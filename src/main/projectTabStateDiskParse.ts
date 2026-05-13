import type { ProjectTabState } from '../types';

/** Parse one `projectTabs` entry from disk JSON. */
export function parseProjectTabStateDiskValue(value: unknown): ProjectTabState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ProjectTabState>;
  const ids = Array.isArray(v.openTaskIds)
    ? v.openTaskIds.filter((x): x is string => typeof x === 'string')
    : [];
  const active =
    typeof v.activeTaskId === 'string' && v.activeTaskId ? v.activeTaskId : null;
  const openPlanning =
    Array.isArray(v.openPlanningTabIds) && v.openPlanningTabIds.length > 0
      ? v.openPlanningTabIds.filter((x): x is string => typeof x === 'string')
      : undefined;
  const planningSidebarActive =
    typeof v.planningSidebarActiveSessionId === 'string'
      ? v.planningSidebarActiveSessionId
      : v.planningSidebarActiveSessionId === null
        ? null
        : undefined;
  const planningSidebarOpen = v.planningSidebarOpen === true ? true : undefined;
  const taskLayout =
    v.taskLayout === 'list' || v.taskLayout === 'board' ? v.taskLayout : undefined;
  return {
    openTaskIds: ids,
    activeTaskId: active,
    ...(openPlanning ? { openPlanningTabIds: openPlanning } : {}),
    ...(planningSidebarActive !== undefined
      ? { planningSidebarActiveSessionId: planningSidebarActive }
      : {}),
    ...(planningSidebarOpen ? { planningSidebarOpen: true } : {}),
    ...(taskLayout === 'list' ? { taskLayout: 'list' as const } : {}),
  };
}
