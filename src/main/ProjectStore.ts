import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalProject } from '../types';

const SCHEMA_VERSION = 2;

export type ActiveProjectKind = 'local' | 'cloud';

export interface ActiveProjectKey {
  kind: ActiveProjectKind;
  id: string;
}

interface StoreFile {
  schemaVersion: number;
  projects: LocalProject[];
  activeProjectKey: ActiveProjectKey | null;
  /** legacy v1 field; read for migration, never written */
  activeProjectId?: string | null;
}

/**
 * Persists the local project list and a pointer to the active project. The
 * active pointer is {kind, id} because cloud projects live in Firestore and
 * are not stored here — only their id is remembered across launches.
 */
export class ProjectStore {
  private filePath: string;
  private legacyFilePath: string;
  private projects: LocalProject[] = [];
  private activeProjectKey: ActiveProjectKey | null = null;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'projects.json');
    this.legacyFilePath = path.join(app.getPath('userData'), 'project.json');
  }

  async init(): Promise<void> {
    if (await this.loadPrimary()) return;
    await this.migrateLegacy();
  }

  private async loadPrimary(): Promise<boolean> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') return false;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.warn('[ProjectStore] projects.json malformed; starting empty.');
      return true;
    }
    if (!parsed || typeof parsed !== 'object') return true;
    const p = parsed as Partial<StoreFile>;
    if (!Array.isArray(p.projects)) return true;

    this.projects = p.projects
      .map(normalizeLocalProject)
      .filter((proj): proj is LocalProject => proj !== null);

    const key = normalizeActiveKey(p.activeProjectKey);
    if (key) {
      this.activeProjectKey = key;
    } else if (typeof p.activeProjectId === 'string' && p.activeProjectId) {
      // v1 → v2: the legacy id always referred to a local project.
      this.activeProjectKey = { kind: 'local', id: p.activeProjectId };
    }

    // Drop stale local pointer if the project was removed out-of-band.
    const activeKey = this.activeProjectKey;
    if (
      activeKey?.kind === 'local' &&
      !this.projects.some((proj) => proj.id === activeKey.id)
    ) {
      this.activeProjectKey = null;
    }

    // If we migrated from v1, persist the new schema shape.
    if (p.schemaVersion !== SCHEMA_VERSION) await this.save();
    return true;
  }

  private async migrateLegacy(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.legacyFilePath, 'utf8');
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
    const p = parsed as Partial<LocalProject>;
    if (
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.rootPath !== 'string' ||
      typeof p.addedAt !== 'string'
    ) {
      return;
    }
    const migrated: LocalProject = {
      id: p.id,
      kind: 'local',
      name: p.name,
      rootPath: p.rootPath,
      addedAt: p.addedAt,
    };
    this.projects = [migrated];
    this.activeProjectKey = { kind: 'local', id: migrated.id };
    await this.save();
    try {
      await fs.unlink(this.legacyFilePath);
    } catch {
      // ignore
    }
  }

  listLocal(): LocalProject[] {
    return this.projects.slice();
  }

  getActiveKey(): ActiveProjectKey | null {
    return this.activeProjectKey ? { ...this.activeProjectKey } : null;
  }

  getActiveLocal(): LocalProject | null {
    const key = this.activeProjectKey;
    if (key?.kind !== 'local') return null;
    return this.projects.find((p) => p.id === key.id) ?? null;
  }

  getLocalById(id: string): LocalProject | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  async upsertLocal(project: LocalProject): Promise<LocalProject> {
    const index = this.projects.findIndex((p) => p.id === project.id);
    if (index === -1) {
      this.projects.push(project);
    } else {
      this.projects[index] = { ...this.projects[index], ...project };
    }
    await this.save();
    return project;
  }

  async setActiveKey(key: ActiveProjectKey | null): Promise<ActiveProjectKey | null> {
    if (key?.kind === 'local' && !this.projects.some((p) => p.id === key.id)) {
      throw new Error(`Local project not found: ${key.id}`);
    }
    this.activeProjectKey = key;
    await this.save();
    return this.getActiveKey();
  }

  async removeLocal(id: string): Promise<void> {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length === before) return;
    if (this.activeProjectKey?.kind === 'local' && this.activeProjectKey.id === id) {
      this.activeProjectKey = null;
    }
    await this.save();
  }

  private async save(): Promise<void> {
    const data: StoreFile = {
      schemaVersion: SCHEMA_VERSION,
      projects: this.projects,
      activeProjectKey: this.activeProjectKey,
    };
    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(data, null, 2)}\n`;
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

function normalizeLocalProject(value: unknown): LocalProject | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<LocalProject>;
  if (
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.rootPath !== 'string' ||
    typeof p.addedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: p.id,
    kind: 'local',
    name: p.name,
    rootPath: p.rootPath,
    addedAt: p.addedAt,
  };
}

function normalizeActiveKey(value: unknown): ActiveProjectKey | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ActiveProjectKey>;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (v.kind !== 'local' && v.kind !== 'cloud') return null;
  return { kind: v.kind, id: v.id };
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}
