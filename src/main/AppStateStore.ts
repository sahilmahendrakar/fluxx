import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveProjectKey } from '../types';

export interface AppState {
  lastOpenedProjectDir: string | null;
  /** Persisted so team (cloud) projects restore after restart. */
  activeProjectKey: ActiveProjectKey | null;
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
  }

  get(): AppState {
    return { ...this.state };
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
