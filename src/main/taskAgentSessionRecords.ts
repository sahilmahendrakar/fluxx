import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Session, TaskAgentSessionEndedReason, TaskAgentSessionRecord } from '../types';
import { mapEndedReasonToRemoteLifecycle } from './ssh/remoteSessionLifecycle';

const FILE_NAME = 'task-agent-sessions.json';
const SCHEMA_VERSION = 1;
const MAX_RECORDS = 500;

const COLD_RESUMABLE_END_REASONS: TaskAgentSessionEndedReason[] = [
  'app-quit',
  'tmux-missing',
  'device-unreachable',
  'helper-mismatch',
  'agent-exit-ok',
  'agent-exit-error',
];

type PersistedFileV1 = {
  version: typeof SCHEMA_VERSION;
  records: TaskAgentSessionRecord[];
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

type LegacySessionRecordRow = TaskAgentSessionRecord & {
  fluxSessionId?: string;
  fluxWorkBranch?: string;
};

function normalizeLegacyFluxxSessionRecord(r: unknown): TaskAgentSessionRecord | null {
  if (!r || typeof r !== 'object') return null;
  const row = r as LegacySessionRecordRow;
  const fluxxSessionId =
    typeof row.fluxxSessionId === 'string'
      ? row.fluxxSessionId
      : typeof row.fluxSessionId === 'string'
        ? row.fluxSessionId
        : null;
  if (!fluxxSessionId || typeof row.taskId !== 'string') return null;
  const fluxxWorkBranch =
    typeof row.fluxxWorkBranch === 'string'
      ? row.fluxxWorkBranch
      : typeof row.fluxWorkBranch === 'string'
        ? row.fluxWorkBranch
        : '';
  if (!fluxxWorkBranch.trim()) return null;
  const { fluxSessionId: _s, fluxWorkBranch: _w, ...rest } = row;
  return { ...rest, fluxxSessionId, fluxxWorkBranch };
}

export type TaskAgentSessionRecordStoreDeps = {
  getProjectDir: () => string;
};

/**
 * Persists task agent session metadata under `<projectDir>/task-agent-sessions.json`
 * for cold resume (conversation ids, worktree paths, quit detection).
 */
export class TaskAgentSessionRecordStore {
  private readonly getProjectDir: () => string;
  private writeChain: Promise<void> = Promise.resolve();
  private cache: TaskAgentSessionRecord[] = [];
  private loadedForDir: string | null = null;

  constructor(deps: TaskAgentSessionRecordStoreDeps) {
    this.getProjectDir = deps.getProjectDir;
  }

  private filePath(): string | null {
    const dir = this.getProjectDir()?.trim();
    if (!dir) return null;
    return path.join(dir, FILE_NAME);
  }

  private async ensureLoaded(): Promise<void> {
    const dir = this.getProjectDir()?.trim() ?? null;
    if (!dir) {
      return;
    }
    const fp = path.join(dir, FILE_NAME);
    const fileExists = await pathExists(fp);
    if (this.loadedForDir === dir) {
      if (this.cache.length > 0 || !fileExists) return;
    }
    if (!fileExists) {
      this.cache = [];
      return;
    }
    this.loadedForDir = dir;
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'records' in parsed &&
        Array.isArray((parsed as PersistedFileV1).records)
      ) {
        const rawRecords = (parsed as PersistedFileV1).records;
        const migrated = rawRecords.some(
          (r) =>
            r &&
            typeof r === 'object' &&
            ('fluxSessionId' in r || 'fluxWorkBranch' in r),
        );
        this.cache = rawRecords
          .map((r) => normalizeLegacyFluxxSessionRecord(r))
          .filter((r): r is TaskAgentSessionRecord => r != null);
        if (migrated) {
          await this.persist();
        }
      } else {
        this.cache = [];
      }
    } catch {
      this.cache = [];
      this.loadedForDir = null;
    }
  }

  private async persist(): Promise<void> {
    const fp = this.filePath();
    if (!fp) return;
    const body: PersistedFileV1 = {
      version: SCHEMA_VERSION,
      records: this.cache.slice(-MAX_RECORDS),
    };
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  }

  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /** Wait until queued disk writes for this store have finished. */
  whenWriteIdle(): Promise<void> {
    return this.writeChain;
  }

  async recordSessionStart(row: TaskAgentSessionRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      this.cache.push({ ...row });
      await this.persist();
    });
  }

  async mergeConversationId(fluxxSessionId: string, agentConversationId: string): Promise<void> {
    const id = agentConversationId.trim();
    if (!id) return;
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.fluxxSessionId !== fluxxSessionId) return r;
        if (r.agentConversationId === id) return r;
        changed = true;
        return { ...r, agentConversationId: id };
      });
      if (changed) await this.persist();
    });
  }

  async markSessionEnded(
    session: Pick<Session, 'id' | 'status' | 'stoppedAt' | 'startedAt'>,
    opts: { reason: TaskAgentSessionEndedReason },
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const endedAt = session.stoppedAt ?? new Date().toISOString();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.fluxxSessionId !== session.id) return r;
        if (opts.reason === 'user-archived') {
          if (
            r.endedReason === 'user-archived' ||
            r.endedReason === 'replaced-by-new-session' ||
            r.endedReason === 'workspace-deleted'
          ) {
            return r;
          }
          changed = true;
          return {
            ...r,
            endedAt,
            endedReason: 'user-archived',
          };
        }
        if (opts.reason === 'workspace-deleted') {
          changed = true;
          return {
            ...r,
            endedAt,
            endedReason: 'workspace-deleted',
          };
        }
        if (r.endedAt && r.endedReason === 'app-quit') return r;
        if (r.endedAt) return r;
        changed = true;
        return {
          ...r,
          endedAt,
          endedReason: opts.reason,
        };
      });
      if (changed) await this.persist();
    });
  }

  async markReplacedSessions(
    taskId: string,
    keepFluxxSessionId: string,
    liveFluxxSessionIds: ReadonlySet<string>,
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.taskId !== taskId) return r;
        if (r.fluxxSessionId === keepFluxxSessionId) return r;
        if (r.endedAt) return r;
        if (!liveFluxxSessionIds.has(r.fluxxSessionId)) return r;
        changed = true;
        return {
          ...r,
          endedAt: new Date().toISOString(),
          endedReason: 'replaced-by-new-session' as const,
        };
      });
      if (changed) await this.persist();
    });
  }

  async markWorkspaceDeletedForFluxxSession(fluxxSessionId: string): Promise<void> {
    await this.markSessionEnded(
      {
        id: fluxxSessionId,
        status: 'stopped',
        startedAt: '',
        stoppedAt: new Date().toISOString(),
      },
      { reason: 'workspace-deleted' },
    );
  }

  /**
   * Latest persisted conversation id for `--resume <id>` when resuming this task.
   */
  async hasFluxxSessionId(fluxxSessionId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.cache.some((r) => r.fluxxSessionId === fluxxSessionId);
  }

  async getResumeConversationId(taskId: string, agent: Agent): Promise<string | undefined> {
    if (agent === 'codex') return undefined;
    await this.ensureLoaded();
    const rows = this.cache
      .filter((r) => r.taskId === taskId && r.agent === agent)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const id = rows[0]?.agentConversationId?.trim();
    return id || undefined;
  }

  private isColdResumableRecord(r: TaskAgentSessionRecord): boolean {
    if (
      r.endedReason === 'user-archived' ||
      r.endedReason === 'replaced-by-new-session' ||
      r.endedReason === 'workspace-deleted'
    ) {
      return false;
    }
    // Force quit / crash: row never got markSessionEnded — still offer cold restore.
    if (!r.endedAt) return true;
    return COLD_RESUMABLE_END_REASONS.includes(r.endedReason as TaskAgentSessionEndedReason);
  }

  private recordToInterruptedView(r: TaskAgentSessionRecord): Session {
    const stoppedAt = r.endedAt ?? r.startedAt;
    const lifecycle = mapEndedReasonToRemoteLifecycle(r.endedReason);
    return {
      id: r.fluxxSessionId,
      taskId: r.taskId,
      projectId: r.projectId,
      ...(r.repoId != null && r.repoId.length > 0 ? { repoId: r.repoId } : {}),
      worktreePath: r.worktreePath,
      branch: r.fluxxWorkBranch,
      status: 'interrupted',
      startedAt: r.startedAt,
      stoppedAt,
      ...(r.agentConversationId ? { agentConversationId: r.agentConversationId } : {}),
      ...(r.deviceId ? { deviceId: r.deviceId } : {}),
      ...(r.deviceKind ? { deviceKind: r.deviceKind } : {}),
      ...(r.deviceLabel ? { deviceLabel: r.deviceLabel } : {}),
      ...(r.deviceKind === 'ssh' ? { remotePath: r.worktreePath } : {}),
      ...(lifecycle ? { remoteLifecycleStatus: lifecycle } : {}),
    };
  }

  private async worktreePresentForRecord(
    r: TaskAgentSessionRecord,
    worktreeStillPresent: (absPath: string) => Promise<boolean>,
  ): Promise<boolean> {
    const wt = r.worktreePath?.trim();
    if (!wt) return false;
    if (r.deviceKind === 'ssh') return true;
    return worktreeStillPresent(wt);
  }

  async getColdResumeSessionById(
    projectId: string,
    fluxxSessionId: string,
    worktreeStillPresent: (absPath: string) => Promise<boolean>,
  ): Promise<Session | null> {
    await this.ensureLoaded();
    const r = this.cache.find(
      (row) => row.projectId === projectId && row.fluxxSessionId === fluxxSessionId,
    );
    if (!r || !this.isColdResumableRecord(r)) return null;
    if (!(await this.worktreePresentForRecord(r, worktreeStillPresent))) return null;
    return this.recordToInterruptedView(r);
  }

  /**
   * Synthetic session for UI when no live PTY exists but the last session ended in a
   * resumable way and the worktree folder is still present.
   */
  async getColdResumeSessionView(
    taskId: string,
    projectId: string,
    worktreeStillPresent: (absPath: string) => Promise<boolean>,
  ): Promise<Session | null> {
    await this.ensureLoaded();
    const candidates = this.cache
      .filter((r) => r.taskId === taskId && r.projectId === projectId)
      .filter((r) => this.isColdResumableRecord(r))
      .sort((a, b) => {
        const ea = a.endedAt ?? a.startedAt;
        const eb = b.endedAt ?? b.startedAt;
        return eb.localeCompare(ea);
      });

    for (const r of candidates) {
      if (!(await this.worktreePresentForRecord(r, worktreeStillPresent))) continue;
      return this.recordToInterruptedView(r);
    }
    return null;
  }

  /** All cold-resumable synthetic rows for a project (newest first). */
  async listColdResumeTaskSessions(
    projectId: string,
    worktreeStillPresent: (absPath: string) => Promise<boolean>,
    opts?: { excludeFluxxSessionIds?: Set<string> },
  ): Promise<Session[]> {
    await this.ensureLoaded();
    const exclude = opts?.excludeFluxxSessionIds ?? new Set<string>();
    const rows: Session[] = [];
    const seen = new Set<string>();

    const candidates = this.cache
      .filter((r) => r.projectId === projectId)
      .filter((r) => !exclude.has(r.fluxxSessionId))
      .filter((r) => this.isColdResumableRecord(r))
      .sort((a, b) => {
        const ea = a.endedAt ?? a.startedAt;
        const eb = b.endedAt ?? b.startedAt;
        return eb.localeCompare(ea);
      });

    const newestPerTask = new Map<string, TaskAgentSessionRecord>();
    for (const r of candidates) {
      if (!newestPerTask.has(r.taskId)) newestPerTask.set(r.taskId, r);
    }

    for (const r of newestPerTask.values()) {
      if (seen.has(r.fluxxSessionId)) continue;
      if (!(await this.worktreePresentForRecord(r, worktreeStillPresent))) continue;
      seen.add(r.fluxxSessionId);
      rows.push(this.recordToInterruptedView(r));
    }

    return rows;
  }

  /** Test hook: replace in-memory state. */
  _testImportRecords(records: TaskAgentSessionRecord[]): void {
    this.cache = records.map((r) => ({ ...r }));
    this.loadedForDir = this.getProjectDir()?.trim() ?? null;
  }
}
