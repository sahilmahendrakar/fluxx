import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../types';

const SCHEMA_VERSION = 1;

interface StoreFile {
  schemaVersion: number;
  projects: Project[];
  activeProjectId: string | null;
}

export class ProjectStore {
  private filePath: string;
  private legacyFilePath: string;
  private projects: Project[] = [];
  private activeProjectId: string | null = null;

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
      .map(normalizeProject)
      .filter((proj): proj is Project => proj !== null);
    const active =
      typeof p.activeProjectId === 'string' ? p.activeProjectId : null;
    this.activeProjectId =
      active && this.projects.some((proj) => proj.id === active) ? active : null;
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
    const p = parsed as Partial<Project> & { kind?: unknown };
    if (
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.rootPath !== 'string' ||
      typeof p.addedAt !== 'string'
    ) {
      return;
    }
    const migrated: Project = {
      id: p.id,
      kind: 'local',
      name: p.name,
      rootPath: p.rootPath,
      addedAt: p.addedAt,
    };
    this.projects = [migrated];
    this.activeProjectId = migrated.id;
    await this.save();
    try {
      await fs.unlink(this.legacyFilePath);
    } catch {
      // ignore
    }
  }

  list(): Project[] {
    return this.projects.slice();
  }

  getActive(): Project | null {
    if (!this.activeProjectId) return null;
    return this.projects.find((p) => p.id === this.activeProjectId) ?? null;
  }

  getById(id: string): Project | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  async upsert(project: Project): Promise<Project> {
    const index = this.projects.findIndex((p) => p.id === project.id);
    if (index === -1) {
      this.projects.push(project);
    } else {
      this.projects[index] = { ...this.projects[index], ...project };
    }
    await this.save();
    return project;
  }

  async setActive(id: string | null): Promise<Project | null> {
    if (id && !this.projects.some((p) => p.id === id)) {
      throw new Error(`Project not found: ${id}`);
    }
    this.activeProjectId = id;
    await this.save();
    return this.getActive();
  }

  async remove(id: string): Promise<void> {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length === before) return;
    if (this.activeProjectId === id) this.activeProjectId = null;
    await this.save();
  }

  private async save(): Promise<void> {
    const data: StoreFile = {
      schemaVersion: SCHEMA_VERSION,
      projects: this.projects,
      activeProjectId: this.activeProjectId,
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

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<Project>;
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

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}
