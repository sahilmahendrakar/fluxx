import { DEFAULT_CURSOR_AGENT_MODEL } from './types';

/**
 * Legacy per-project planning model defaults (renderer localStorage).
 * New installs use `project.patchAgentSpawnDefaults` / config.json and cloud bindings.
 */

const STORAGE_KEY = 'flux.planningSessionModels.v1';

type StoreV1 = {
  v: 1;
  byProject: Record<
    string,
    { 'claude-code'?: string; cursor?: string }
  >;
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

/** Claude: `''` = CLI default (no `--model`). Cursor: default `auto`. */
export function readPlanningModelsForProject(projectId: string): {
  'claude-code': string;
  cursor: string;
} {
  const row = readStore().byProject[projectId];
  return {
    'claude-code':
      typeof row?.['claude-code'] === 'string' ? row['claude-code'] : '',
    cursor: typeof row?.cursor === 'string' ? row.cursor : 'auto',
  };
}

export function writePlanningModelForProject(
  projectId: string,
  kind: 'claude-code' | 'cursor',
  modelId: string,
): void {
  const store = readStore();
  const prev = store.byProject[projectId] ?? {};
  store.byProject[projectId] = { ...prev, [kind]: modelId };
  writeStore(store);
}

function clearPlanningModelsFromLocalStore(projectId: string): void {
  const store = readStore();
  if (!store.byProject[projectId]) return;
  delete store.byProject[projectId];
  writeStore(store);
}

/**
 * One-time import from legacy localStorage when the project has no planning models in main yet.
 * @returns whether the caller should refresh the active project from main.
 */
export async function migrateLegacyPlanningModelsIfNeeded(
  projectId: string,
  mainHasPlanningModels: boolean,
): Promise<boolean> {
  if (mainHasPlanningModels) return false;
  const legacy = readPlanningModelsForProject(projectId);
  const nonDefault =
    legacy['claude-code'].trim() !== '' ||
    (legacy.cursor.trim() !== '' && legacy.cursor !== DEFAULT_CURSOR_AGENT_MODEL);
  if (!nonDefault) return false;
  const api = window.electronAPI?.project;
  if (!api?.patchAgentSpawnDefaults) return false;
  const res = await api.patchAgentSpawnDefaults({
    planningModels: {
      ...(legacy['claude-code'].trim() ? { 'claude-code': legacy['claude-code'] } : {}),
      ...(legacy.cursor.trim() ? { cursor: legacy.cursor } : {}),
    },
  });
  if (res && 'error' in res) return false;
  clearPlanningModelsFromLocalStore(projectId);
  return true;
}
