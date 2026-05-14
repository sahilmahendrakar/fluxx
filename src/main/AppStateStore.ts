import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveProjectKey, ProjectTabState } from '../types';
import { parseProjectTabStateDiskValue } from './projectTabStateDiskParse';

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

  constructor(opts?: { filePath?: string }) {
    this.filePath = opts?.filePath ?? path.join(app.getPath('userData'), 'app-state.json');
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
        const parsed = parseProjectTabStateDiskValue(value);
        if (parsed) tabs[key] = parsed;
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

  /**
   * Removes persisted tab strip state for a project. When `clearActiveNavigation` is true
   * (removed project was active), also clears `activeProjectKey` and `lastOpenedProjectDir`.
   */
  async clearProjectFluxState(
    key: ActiveProjectKey,
    options: { clearActiveNavigation: boolean },
  ): Promise<void> {
    const sk = projectStateKey(key);
    const nextTabs = { ...this.state.projectTabs };
    delete nextTabs[sk];
    const partial: Partial<AppState> = { projectTabs: nextTabs };
    if (options.clearActiveNavigation) {
      partial.activeProjectKey = null;
      partial.lastOpenedProjectDir = null;
    }
    await this.set(partial);
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
