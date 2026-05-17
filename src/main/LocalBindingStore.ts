import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, AgentSessionModelDefaults, CloudProjectLocalBinding } from '../types';
import {
  migrateLegacyCloudBinding,
  parseRepoBindingsRecord,
  stripLegacyRootPathForPersistence,
} from '../cloudLocalBindingMigration';
import { resolvedPrefsFromBinding } from '../cloudBindingPrefs';
import { deriveStablePrimaryRepoIdForProject } from '../repoIdentity';

/**
 * Cloud projects live in Firestore and have no intrinsic local path — each
 * teammate clones the repo wherever they like. This store maps
 * `cloudProjectId → { repoBindings by repo id, lastOpenedAt, optional per-user prefs }` per machine, so we can
 * reconnect the same working copy on reopen without re-prompting.
 *
 * Stored at `userData/localBindings.json`. Not synced.
 */

const SCHEMA_VERSION = 2;

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

function parseAgentSessionModelDefaultsField(raw: unknown): AgentSessionModelDefaults | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: AgentSessionModelDefaults = {};
  if (typeof o['claude-code'] === 'string') {
    out['claude-code'] = o['claude-code'];
  }
  if (typeof o.cursor === 'string') {
    out.cursor = o.cursor;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseBindingEntry(_id: string, value: unknown): LocalBinding | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const repoBindings = parseRepoBindingsRecord(v.repoBindings);
  if (typeof v.lastOpenedAt === 'string' && (!repoBindings || Object.keys(repoBindings).length === 0)) {
    if (typeof v.rootPath === 'string' && v.rootPath.length > 0) {
      const binding: LocalBinding = {
        rootPath: v.rootPath,
        lastOpenedAt: v.lastOpenedAt,
      };
      fillBindingPrefs(v, binding);
      return binding;
    }
    const shellOnly: LocalBinding = { lastOpenedAt: v.lastOpenedAt };
    fillBindingPrefs(v, shellOnly);
    return shellOnly;
  }
  if (repoBindings && Object.keys(repoBindings).length > 0) {
    let lastOpenedAt: string | undefined =
      typeof v.lastOpenedAt === 'string' ? v.lastOpenedAt : undefined;
    if (lastOpenedAt === undefined) {
      const times = Object.values(repoBindings).map((x) => x.lastOpenedAt);
      times.sort();
      lastOpenedAt = times[times.length - 1];
    }
    if (typeof lastOpenedAt !== 'string') return null;
    const binding: LocalBinding = {
      lastOpenedAt,
      repoBindings,
    };
    if (typeof v.primaryRepoId === 'string' && v.primaryRepoId.trim()) {
      binding.primaryRepoId = v.primaryRepoId.trim();
    }
    if (typeof v.rootPath === 'string') binding.rootPath = v.rootPath;
    fillBindingPrefs(v, binding);
    return binding;
  }
  if (typeof v.rootPath !== 'string' || typeof v.lastOpenedAt !== 'string') {
    return null;
  }
  const binding: LocalBinding = {
    rootPath: v.rootPath,
    lastOpenedAt: v.lastOpenedAt,
  };
  fillBindingPrefs(v, binding);
  return binding;
}

function fillBindingPrefs(v: Record<string, unknown>, binding: LocalBinding): void {
  if (isAgent(v.planningAgent)) binding.planningAgent = v.planningAgent;
  if (isAgent(v.defaultTaskAgent)) binding.defaultTaskAgent = v.defaultTaskAgent;
  const pm = parseAgentSessionModelDefaultsField(v.planningModels);
  if (pm) binding.planningModels = pm;
  if (v.planningAgentYolo === true) binding.planningAgentYolo = true;
  const tm = parseAgentSessionModelDefaultsField(v.taskDefaultModels);
  if (tm) binding.taskDefaultModels = tm;
  if (v.defaultTaskAgentYolo === true) binding.defaultTaskAgentYolo = true;
  if (typeof v.autoStartSessionOnInProgress === 'boolean') {
    binding.autoStartSessionOnInProgress = v.autoStartSessionOnInProgress;
  }
  if (typeof v.autoRespondToTrustPrompts === 'boolean') {
    binding.autoRespondToTrustPrompts = v.autoRespondToTrustPrompts;
  }
  if (typeof v.autoStartWhenUnblocked === 'boolean') {
    binding.autoStartWhenUnblocked = v.autoStartWhenUnblocked;
  }
  if (typeof v.autoCleanupWorkspaceWhenDone === 'boolean') {
    binding.autoCleanupWorkspaceWhenDone = v.autoCleanupWorkspaceWhenDone;
  }
  if (typeof v.autoMarkDoneWhenPrMerged === 'boolean') {
    binding.autoMarkDoneWhenPrMerged = v.autoMarkDoneWhenPrMerged;
  }
  if (typeof v.autoMoveToReviewWhenPrOpen === 'boolean') {
    binding.autoMoveToReviewWhenPrOpen = v.autoMoveToReviewWhenPrOpen;
  }
  if (typeof v.autoDeleteTaskWhenDone === 'boolean') {
    binding.autoDeleteTaskWhenDone = v.autoDeleteTaskWhenDone;
  }
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
    let persistMigration = false;
    for (const [id, value] of Object.entries(p.bindings)) {
      const binding = parseBindingEntry(id, value);
      if (!binding) continue;
      const snapshot = JSON.stringify(binding);
      const migrated = stripLegacyRootPathForPersistence(migrateLegacyCloudBinding(id, binding));
      this.bindings[id] = migrated;
      if (JSON.stringify(migrated) !== snapshot) persistMigration = true;
    }
    if (persistMigration) await this.save();
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
      planningModels: Partial<AgentSessionModelDefaults>;
      planningAgentYolo: boolean;
      taskDefaultModels: Partial<AgentSessionModelDefaults>;
      defaultTaskAgentYolo: boolean;
      autoStartSessionOnInProgress: boolean;
      autoRespondToTrustPrompts: boolean;
      autoStartWhenUnblocked: boolean;
      autoCleanupWorkspaceWhenDone: boolean;
      autoMarkDoneWhenPrMerged: boolean;
      autoMoveToReviewWhenPrOpen: boolean;
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
    if (prefs.planningModels !== undefined) {
      existing.planningModels = { ...(existing.planningModels ?? {}), ...prefs.planningModels };
    }
    if (prefs.planningAgentYolo !== undefined) {
      if (prefs.planningAgentYolo) {
        existing.planningAgentYolo = true;
      } else {
        delete existing.planningAgentYolo;
      }
    }
    if (prefs.taskDefaultModels !== undefined) {
      existing.taskDefaultModels = {
        ...(existing.taskDefaultModels ?? {}),
        ...prefs.taskDefaultModels,
      };
    }
    if (prefs.defaultTaskAgentYolo !== undefined) {
      if (prefs.defaultTaskAgentYolo) {
        existing.defaultTaskAgentYolo = true;
      } else {
        delete existing.defaultTaskAgentYolo;
      }
    }
    if (prefs.autoStartSessionOnInProgress !== undefined) {
      existing.autoStartSessionOnInProgress = prefs.autoStartSessionOnInProgress;
    }
    if (prefs.autoRespondToTrustPrompts !== undefined) {
      existing.autoRespondToTrustPrompts = prefs.autoRespondToTrustPrompts;
    }
    if (prefs.autoStartWhenUnblocked !== undefined) {
      existing.autoStartWhenUnblocked = prefs.autoStartWhenUnblocked;
    }
    if (prefs.autoCleanupWorkspaceWhenDone !== undefined) {
      existing.autoCleanupWorkspaceWhenDone = prefs.autoCleanupWorkspaceWhenDone;
      delete existing.autoDeleteTaskWhenDone;
    }
    if (prefs.autoMarkDoneWhenPrMerged !== undefined) {
      existing.autoMarkDoneWhenPrMerged = prefs.autoMarkDoneWhenPrMerged;
    }
    if (prefs.autoMoveToReviewWhenPrOpen !== undefined) {
      existing.autoMoveToReviewWhenPrOpen = prefs.autoMoveToReviewWhenPrOpen;
    }
    await this.save();
  }

  /**
   * Set or update the on-disk clone for one shared repo id. Other repo
   * bindings and preferences are preserved (multi-repo2 cloud).
   */
  async setRepoMachineBinding(
    projectId: string,
    repoId: string,
    rootPath: string,
  ): Promise<LocalBinding> {
    const rid = repoId.trim();
    if (!rid) throw new Error('repoId is required');
    const resolvedRoot = path.resolve(rootPath);
    const now = new Date().toISOString();
    const prev = this.bindings[projectId];
    const prevM = prev ? migrateLegacyCloudBinding(projectId, { ...prev }) : null;
    const repoBindings = { ...(prevM?.repoBindings ?? {}) };
    repoBindings[rid] = { rootPath: resolvedRoot, lastOpenedAt: now };
    let primaryRepoId = prevM?.primaryRepoId;
    if (!primaryRepoId && Object.keys(repoBindings).length === 1) {
      primaryRepoId = rid;
    }
    const binding: LocalBinding = {
      lastOpenedAt: now,
      repoBindings,
      ...(primaryRepoId ? { primaryRepoId } : {}),
    };
    if (prevM) {
      if (prevM.planningAgent !== undefined) binding.planningAgent = prevM.planningAgent;
      if (prevM.defaultTaskAgent !== undefined) binding.defaultTaskAgent = prevM.defaultTaskAgent;
      if (prevM.planningModels !== undefined) binding.planningModels = { ...prevM.planningModels };
      if (prevM.planningAgentYolo === true) binding.planningAgentYolo = true;
      if (prevM.taskDefaultModels !== undefined) {
        binding.taskDefaultModels = { ...prevM.taskDefaultModels };
      }
      if (prevM.defaultTaskAgentYolo === true) binding.defaultTaskAgentYolo = true;
      if (prevM.autoStartSessionOnInProgress !== undefined) {
        binding.autoStartSessionOnInProgress = prevM.autoStartSessionOnInProgress;
      }
      if (prevM.autoRespondToTrustPrompts !== undefined) {
        binding.autoRespondToTrustPrompts = prevM.autoRespondToTrustPrompts;
      }
      if (prevM.autoStartWhenUnblocked !== undefined) {
        binding.autoStartWhenUnblocked = prevM.autoStartWhenUnblocked;
      }
      if (prevM.autoCleanupWorkspaceWhenDone !== undefined) {
        binding.autoCleanupWorkspaceWhenDone = prevM.autoCleanupWorkspaceWhenDone;
      } else if (prevM.autoDeleteTaskWhenDone !== undefined) {
        binding.autoDeleteTaskWhenDone = prevM.autoDeleteTaskWhenDone;
      }
      if (prevM.autoMarkDoneWhenPrMerged !== undefined) {
        binding.autoMarkDoneWhenPrMerged = prevM.autoMarkDoneWhenPrMerged;
      }
      if (prevM.autoMoveToReviewWhenPrOpen !== undefined) {
        binding.autoMoveToReviewWhenPrOpen = prevM.autoMoveToReviewWhenPrOpen;
      }
    }
    const normalized = stripLegacyRootPathForPersistence(binding);
    this.bindings[projectId] = normalized;
    await this.save();
    return normalized;
  }

  async set(projectId: string, rootPath: string): Promise<LocalBinding> {
    const prev = this.bindings[projectId];
    const resolvedIncoming = path.resolve(rootPath);
    if (prev) {
      const migrated = migrateLegacyCloudBinding(projectId, { ...prev });
      const rb = migrated.repoBindings;
      if (rb && Object.keys(rb).length > 0) {
        let pid = migrated.primaryRepoId;
        const keys = Object.keys(rb).sort();
        if (!pid && keys.length === 1) pid = keys[0];
        if (!pid) {
          pid =
            keys.find((k) => path.resolve(rb[k].rootPath) === resolvedIncoming) ?? keys[0];
        }
        if (pid && rb[pid]) {
          return this.setRepoMachineBinding(projectId, pid, rootPath);
        }
      }
    }
    const now = new Date().toISOString();
    const primaryId = deriveStablePrimaryRepoIdForProject({
      projectId,
      rootPath: resolvedIncoming,
    });
    const binding: LocalBinding = {
      lastOpenedAt: now,
      repoBindings: {
        [primaryId]: { rootPath: resolvedIncoming, lastOpenedAt: now },
      },
      primaryRepoId: primaryId,
    };
    if (prev) {
      if (prev.planningAgent !== undefined) binding.planningAgent = prev.planningAgent;
      if (prev.defaultTaskAgent !== undefined) binding.defaultTaskAgent = prev.defaultTaskAgent;
      if (prev.planningModels !== undefined) binding.planningModels = { ...prev.planningModels };
      if (prev.planningAgentYolo === true) binding.planningAgentYolo = true;
      if (prev.taskDefaultModels !== undefined) {
        binding.taskDefaultModels = { ...prev.taskDefaultModels };
      }
      if (prev.defaultTaskAgentYolo === true) binding.defaultTaskAgentYolo = true;
      if (prev.autoStartSessionOnInProgress !== undefined) {
        binding.autoStartSessionOnInProgress = prev.autoStartSessionOnInProgress;
      }
      if (prev.autoRespondToTrustPrompts !== undefined) {
        binding.autoRespondToTrustPrompts = prev.autoRespondToTrustPrompts;
      }
      if (prev.autoStartWhenUnblocked !== undefined) {
        binding.autoStartWhenUnblocked = prev.autoStartWhenUnblocked;
      }
      if (prev.autoCleanupWorkspaceWhenDone !== undefined) {
        binding.autoCleanupWorkspaceWhenDone = prev.autoCleanupWorkspaceWhenDone;
      } else if (prev.autoDeleteTaskWhenDone !== undefined) {
        binding.autoDeleteTaskWhenDone = prev.autoDeleteTaskWhenDone;
      }
      if (prev.autoMarkDoneWhenPrMerged !== undefined) {
        binding.autoMarkDoneWhenPrMerged = prev.autoMarkDoneWhenPrMerged;
      }
      if (prev.autoMoveToReviewWhenPrOpen !== undefined) {
        binding.autoMoveToReviewWhenPrOpen = prev.autoMoveToReviewWhenPrOpen;
      }
    }
    const normalized = stripLegacyRootPathForPersistence(binding);
    this.bindings[projectId] = normalized;
    await this.save();
    return normalized;
  }

  /**
   * Records that a cloud project was opened without binding a git clone (shell-only).
   * Preserves existing repo bindings and preferences.
   */
  async touchShell(projectId: string): Promise<void> {
    const now = new Date().toISOString();
    const prev = this.bindings[projectId];
    if (prev) {
      const migrated = migrateLegacyCloudBinding(projectId, { ...prev });
      const next: LocalBinding = { ...migrated, lastOpenedAt: now };
      this.bindings[projectId] = stripLegacyRootPathForPersistence(next);
    } else {
      this.bindings[projectId] = { lastOpenedAt: now };
    }
    await this.save();
  }

  async setPrimaryRepoId(projectId: string, primaryRepoId: string): Promise<void> {
    const pid = primaryRepoId.trim();
    if (!pid) return;
    const existing = this.bindings[projectId];
    if (!existing) return;
    const migrated = migrateLegacyCloudBinding(projectId, { ...existing });
    if (migrated.primaryRepoId === pid) return;
    this.bindings[projectId] = stripLegacyRootPathForPersistence({
      ...migrated,
      primaryRepoId: pid,
    });
    await this.save();
  }

  async touch(projectId: string): Promise<void> {
    const existing = this.bindings[projectId];
    if (!existing) return;
    const now = new Date().toISOString();
    let next = migrateLegacyCloudBinding(projectId, existing);
    next = { ...next, lastOpenedAt: now };
    const rb = next.repoBindings;
    if (rb && Object.keys(rb).length > 0) {
      let pid = next.primaryRepoId;
      if (!pid && Object.keys(rb).length === 1) pid = Object.keys(rb)[0];
      if (pid && rb[pid]) {
        next.repoBindings = { ...rb, [pid]: { ...rb[pid], lastOpenedAt: now } };
      }
    }
    const normalized = stripLegacyRootPathForPersistence(next);
    this.bindings[projectId] = normalized;
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
