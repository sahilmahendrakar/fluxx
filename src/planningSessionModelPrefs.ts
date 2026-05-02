/**
 * Per-project planning model defaults (renderer-only).
 * Agent choice persists via `project.setPlanningAgent`; models live here so we avoid
 * extending LocalBindingStore / config.json until product adds a first-class field.
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
