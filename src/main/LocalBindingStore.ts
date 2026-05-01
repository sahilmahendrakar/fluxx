import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, CloudProjectLocalBinding } from '../types';
import { resolvedPrefsFromBinding } from '../cloudBindingPrefs';

/**
 * Cloud projects live in Firestore and have no intrinsic local path — each
 * teammate clones the repo wherever they like. This store maps
 * `cloudProjectId → { rootPath, lastOpenedAt, optional per-user prefs }` per machine, so we can
 * reconnect the same working copy on reopen without re-prompting.
 *
 * Stored at `userData/localBindings.json`. Not synced.
 */

const SCHEMA_VERSION = 1;

export type LocalBinding = CloudProjectLocalBinding;

interface StoreFile {
  schemaVersion: number;
  bindings: Record<string, LocalBinding>;
}

function isAgent(value: unknown): value is Agent {
  return (
    value === 'claude-code' || value === 'codex' || value === 'cursor'
  );
}

function parseBindingEntry(_id: string, value: unknown): LocalBinding | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.rootPath !== 'string' || typeof v.lastOpenedAt !== 'string') {
    return null;
  }
  const binding: LocalBinding = {
    rootPath: v.rootPath,
    lastOpenedAt: v.lastOpenedAt,
  };
  if (isAgent(v.planningAgent)) binding.planningAgent = v.planningAgent;
  if (isAgent(v.defaultTaskAgent)) binding.defaultTaskAgent = v.defaultTaskAgent;
  if (typeof v.autoStartSessionOnInProgress === 'boolean') {
    binding.autoStartSessionOnInProgress = v.autoStartSessionOnInProgress;
  }
  if (typeof v.autoStartWhenUnblocked === 'boolean') {
    binding.autoStartWhenUnblocked = v.autoStartWhenUnblocked;
  }
  return binding;
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
      const binding = parseBindingEntry(id, value);
      if (binding) {
        this.bindings[id] = binding;
      }
    }
  }

  get(projectId: string): LocalBinding | null {
    return this.bindings[projectId] ?? null;
  }

  getPrefs(projectId: string) {
    return resolvedPrefsFromBinding(this.bindings[projectId]);
  }

  /**
   * Merge preference fields into an existing binding. No-op if there is no binding for `projectId`.
   */
  async setPrefs(
    projectId: string,
    prefs: Partial<{
      planningAgent: Agent;
      defaultTaskAgent: Agent;
      autoStartSessionOnInProgress: boolean;
      autoStartWhenUnblocked: boolean;
    }>,
  ): Promise<void> {
    const existing = this.bindings[projectId];
    if (!existing) return;
    if (prefs.planningAgent !== undefined) {
      existing.planningAgent = prefs.planningAgent;
    }
    if (prefs.defaultTaskAgent !== undefined) {
      existing.defaultTaskAgent = prefs.defaultTaskAgent;
    }
    if (prefs.autoStartSessionOnInProgress !== undefined) {
      existing.autoStartSessionOnInProgress = prefs.autoStartSessionOnInProgress;
    }
    if (prefs.autoStartWhenUnblocked !== undefined) {
      existing.autoStartWhenUnblocked = prefs.autoStartWhenUnblocked;
    }
    await this.save();
  }

  async set(projectId: string, rootPath: string): Promise<LocalBinding> {
    const prev = this.bindings[projectId];
    const binding: LocalBinding = {
      rootPath,
      lastOpenedAt: new Date().toISOString(),
    };
    if (prev) {
      if (prev.planningAgent !== undefined) binding.planningAgent = prev.planningAgent;
      if (prev.defaultTaskAgent !== undefined) binding.defaultTaskAgent = prev.defaultTaskAgent;
      if (prev.autoStartSessionOnInProgress !== undefined) {
        binding.autoStartSessionOnInProgress = prev.autoStartSessionOnInProgress;
      }
      if (prev.autoStartWhenUnblocked !== undefined) {
        binding.autoStartWhenUnblocked = prev.autoStartWhenUnblocked;
      }
    }
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
