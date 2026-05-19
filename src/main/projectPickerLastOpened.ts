import type { ActiveProjectKey, LocalProject } from '../types';
import { projectStateKey, type AppStateStore } from './AppStateStore';
import type { LocalBindingStore } from './LocalBindingStore';

function maxIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return a >= b ? a : b;
}

/** Keys are `local:<id>` / `cloud:<id>` (see {@link projectStateKey}). */
export function buildPickerLastOpenedAtMap(input: {
  appStateStore: AppStateStore;
  bindingStore: LocalBindingStore;
  localProjects: LocalProject[];
}): Record<string, string> {
  const out: Record<string, string> = { ...input.appStateStore.get().projectLastOpenedAt };

  for (const local of input.localProjects) {
    const key = projectStateKey({ kind: 'local', id: local.id });
    out[key] = maxIso(out[key], local.addedAt);
  }

  for (const [cloudId, openedAt] of Object.entries(
    input.bindingStore.getLastOpenedAtByProjectId(),
  )) {
    const key = projectStateKey({ kind: 'cloud', id: cloudId });
    out[key] = maxIso(out[key], openedAt);
  }

  return out;
}

export async function touchPickerProjectLastOpened(
  appStateStore: AppStateStore,
  key: ActiveProjectKey,
): Promise<void> {
  const sk = projectStateKey(key);
  const now = new Date().toISOString();
  const prev = appStateStore.get().projectLastOpenedAt;
  await appStateStore.set({
    projectLastOpenedAt: { ...prev, [sk]: now },
  });
}
