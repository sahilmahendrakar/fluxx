const STORAGE_KEY = 'flux.sidebarRepoSectionsCollapsed.v1';

type StoreV1 = {
  v: 1;
  byProject: Record<string, string[]>;
};

function readStore(): StoreV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: 1, byProject: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) {
      return { v: 1, byProject: {} };
    }
    const byProject = (parsed as { byProject?: unknown }).byProject;
    if (!byProject || typeof byProject !== 'object') {
      return { v: 1, byProject: {} };
    }
    return { v: 1, byProject: { ...(byProject as StoreV1['byProject']) } };
  } catch {
    return { v: 1, byProject: {} };
  }
}

function writeStore(store: StoreV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

/** Repo section ids collapsed in the Task Workspaces sidebar for one project. */
export function readCollapsedRepoIdsForProject(projectId: string): Set<string> {
  const row = readStore().byProject[projectId];
  if (!Array.isArray(row)) return new Set();
  return new Set(row.filter((id): id is string => typeof id === 'string' && id.length > 0));
}

export function writeCollapsedRepoIdsForProject(
  projectId: string,
  collapsedRepoIds: ReadonlySet<string>,
): void {
  const store = readStore();
  if (collapsedRepoIds.size === 0) {
    delete store.byProject[projectId];
  } else {
    store.byProject[projectId] = [...collapsedRepoIds];
  }
  writeStore(store);
}
