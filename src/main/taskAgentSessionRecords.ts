import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, Session, TaskAgentSessionEndedReason, TaskAgentSessionRecord } from '../types';

const FILE_NAME = 'task-agent-sessions.json';
const SCHEMA_VERSION = 1;
const MAX_RECORDS = 500;

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
      this.cache = [];
      this.loadedForDir = null;
      return;
    }
    if (this.loadedForDir === dir) return;
    this.loadedForDir = dir;
    const fp = path.join(dir, FILE_NAME);
    try {
      if (!(await pathExists(fp))) {
        this.cache = [];
        return;
      }
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

  async markReplacedSessions(taskId: string, keepFluxxSessionId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.taskId !== taskId) return r;
        if (r.fluxxSessionId === keepFluxxSessionId) return r;
        if (r.endedAt) return r;
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
  async getResumeConversationId(taskId: string, agent: Agent): Promise<string | undefined> {
    if (agent === 'codex') return undefined;
    await this.ensureLoaded();
    const rows = this.cache
      .filter((r) => r.taskId === taskId && r.agent === agent)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const id = rows[0]?.agentConversationId?.trim();
    return id || undefined;
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
      .filter((r) =>
        ['app-quit', 'agent-exit-ok', 'agent-exit-error'].includes(r.endedReason ?? ''),
      )
      .sort((a, b) => {
        const ea = a.endedAt ?? a.startedAt;
        const eb = b.endedAt ?? b.startedAt;
        return eb.localeCompare(ea);
      });

    for (const r of candidates) {
      const wt = r.worktreePath?.trim();
      if (!wt) continue;
      if (!(await worktreeStillPresent(wt))) continue;
      const stoppedAt = r.endedAt ?? r.startedAt;
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
      };
    }
    return null;
  }

  /** Test hook: replace in-memory state. */
  _testImportRecords(records: TaskAgentSessionRecord[]): void {
    this.cache = records.map((r) => ({ ...r }));
    this.loadedForDir = this.getProjectDir()?.trim() ?? null;
  }
}
