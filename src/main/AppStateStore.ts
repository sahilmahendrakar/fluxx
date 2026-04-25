import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveProjectKey, ProjectTabState } from '../types';

export type { ProjectTabState };

export interface AppState {
  lastOpenedProjectDir: string | null;
  /** Persisted so team (cloud) projects restore after restart. */
  activeProjectKey: ActiveProjectKey | null;
  /** Keyed by `${kind}:${id}` — see `projectStateKey`. */
  projectTabs: Record<string, ProjectTabState>;
}

export function projectStateKey(key: ActiveProjectKey): string {
  return `${key.kind}:${key.id}`;
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

export class AppStateStore {
  private filePath: string;
  private state: AppState = {
    lastOpenedProjectDir: null,
    activeProjectKey: null,
    projectTabs: {},
  };

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'app-state.json');
  }

  async init(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') return;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const o = parsed as Partial<AppState>;
    if (typeof o.lastOpenedProjectDir === 'string' || o.lastOpenedProjectDir === null) {
      this.state.lastOpenedProjectDir = o.lastOpenedProjectDir;
    }
    if (o.activeProjectKey === null) {
      this.state.activeProjectKey = null;
    } else if (o.activeProjectKey && typeof o.activeProjectKey === 'object') {
      const k = o.activeProjectKey as Partial<ActiveProjectKey>;
      if (
        (k.kind === 'local' || k.kind === 'cloud') &&
        typeof k.id === 'string' &&
        k.id
      ) {
        this.state.activeProjectKey = { kind: k.kind, id: k.id };
      }
    }
    if (o.projectTabs && typeof o.projectTabs === 'object') {
      const tabs: Record<string, ProjectTabState> = {};
      for (const [key, value] of Object.entries(
        o.projectTabs as Record<string, unknown>,
      )) {
        if (!value || typeof value !== 'object') continue;
        const v = value as Partial<ProjectTabState>;
        const ids = Array.isArray(v.openTaskIds)
          ? v.openTaskIds.filter((x): x is string => typeof x === 'string')
          : [];
        const active =
          typeof v.activeTaskId === 'string' && v.activeTaskId
            ? v.activeTaskId
            : null;
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
        tabs[key] = {
          openTaskIds: ids,
          activeTaskId: active,
          ...(openPlanning ? { openPlanningTabIds: openPlanning } : {}),
          ...(planningSidebarActive !== undefined
            ? { planningSidebarActiveSessionId: planningSidebarActive }
            : {}),
        };
      }
      this.state.projectTabs = tabs;
    }
  }

  get(): AppState {
    return {
      ...this.state,
      projectTabs: { ...this.state.projectTabs },
    };
  }

  getProjectTabs(key: ActiveProjectKey): ProjectTabState {
    const k = projectStateKey(key);
    return (
      this.state.projectTabs[k] ?? { openTaskIds: [], activeTaskId: null }
    );
  }

  async setProjectTabs(
    key: ActiveProjectKey,
    tabs: ProjectTabState,
  ): Promise<void> {
    const next = {
      ...this.state.projectTabs,
      [projectStateKey(key)]: tabs,
    };
    await this.set({ projectTabs: next });
  }

  async set(partial: Partial<AppState>): Promise<void> {
    this.state = { ...this.state, ...partial };
    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    await fs.writeFile(tmpPath, payload, 'utf8');
    if (process.platform === 'win32') {
      try {
        await fs.unlink(this.filePath);
      } catch (e: unknown) {
        if (errnoCode(e) !== 'ENOENT') throw e;
      }
    }
    await fs.rename(tmpPath, this.filePath);
  }
}
