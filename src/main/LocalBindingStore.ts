import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Cloud projects live in Firestore and have no intrinsic local path — each
 * teammate clones the repo wherever they like. This store maps
 * `cloudProjectId → { rootPath, lastOpenedAt }` per machine, so we can
 * reconnect the same working copy on reopen without re-prompting.
 *
 * Stored at `userData/localBindings.json`. Not synced.
 */

const SCHEMA_VERSION = 1;

export interface LocalBinding {
  rootPath: string;
  lastOpenedAt: string;
}

interface StoreFile {
  schemaVersion: number;
  bindings: Record<string, LocalBinding>;
}

export class LocalBindingStore {
  private filePath: string;
  private bindings: Record<string, LocalBinding> = {};
  private initialized = false;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'localBindings.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
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
      console.warn('[LocalBindingStore] localBindings.json malformed; resetting.');
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const p = parsed as Partial<StoreFile>;
    if (!p.bindings || typeof p.bindings !== 'object') return;
    for (const [id, value] of Object.entries(p.bindings)) {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as LocalBinding).rootPath === 'string' &&
        typeof (value as LocalBinding).lastOpenedAt === 'string'
      ) {
        this.bindings[id] = {
          rootPath: (value as LocalBinding).rootPath,
          lastOpenedAt: (value as LocalBinding).lastOpenedAt,
        };
      }
    }
  }

  get(projectId: string): LocalBinding | null {
    return this.bindings[projectId] ?? null;
  }

  async set(projectId: string, rootPath: string): Promise<LocalBinding> {
    const binding: LocalBinding = {
      rootPath,
      lastOpenedAt: new Date().toISOString(),
    };
    this.bindings[projectId] = binding;
    await this.save();
    return binding;
  }

  async touch(projectId: string): Promise<void> {
    const existing = this.bindings[projectId];
    if (!existing) return;
    existing.lastOpenedAt = new Date().toISOString();
    await this.save();
  }

  async remove(projectId: string): Promise<void> {
    if (!(projectId in this.bindings)) return;
    delete this.bindings[projectId];
    await this.save();
  }

  private async save(): Promise<void> {
    const data: StoreFile = {
      schemaVersion: SCHEMA_VERSION,
      bindings: this.bindings,
    };
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}
