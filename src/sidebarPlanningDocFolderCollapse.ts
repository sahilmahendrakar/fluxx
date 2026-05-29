const STORAGE_KEY = 'flux.sidebarPlanningDocFoldersCollapsed.v1';

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

/** Whether this project has stored folder collapse preferences. */
export function hasPlanningDocFolderCollapseStateForProject(projectId: string): boolean {
  return Object.prototype.hasOwnProperty.call(readStore().byProject, projectId);
}

/** Folder paths collapsed in the Docs sidebar for one project. */
export function readCollapsedPlanningDocFolderPathsForProject(projectId: string): Set<string> {
  const row = readStore().byProject[projectId];
  if (!Array.isArray(row)) return new Set();
  return new Set(row.filter((path): path is string => typeof path === 'string' && path.length > 0));
}

export function writeCollapsedPlanningDocFolderPathsForProject(
  projectId: string,
  collapsedFolderPaths: ReadonlySet<string>,
): void {
  const store = readStore();
  store.byProject[projectId] = [...collapsedFolderPaths];
  writeStore(store);
}

/** First visit: expand top-level folders, collapse nested folders. */
export function defaultCollapsedPlanningDocFolderPaths(
  allFolderPaths: ReadonlyArray<string>,
): Set<string> {
  return new Set(allFolderPaths.filter((path) => path.includes('/')));
}
