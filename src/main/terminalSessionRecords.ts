import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  Agent,
  TerminalEndedReason,
  TerminalKind,
  TerminalSessionRecord,
  TerminalSessionsFileV1,
} from '../types';

const FILE_NAME = 'terminal-sessions.json';
const SCHEMA_VERSION = 1 as const;
const MAX_TERMINALS = 500;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteFile(filePath: string, payload: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function isAgent(value: unknown): value is Agent {
  return value === 'claude-code' || value === 'codex' || value === 'cursor';
}

function isTerminalKind(value: unknown): value is TerminalKind {
  return value === 'task' || value === 'planning' || value === 'shell';
}

function isTerminalRuntime(value: unknown): value is TerminalSessionRecord['runtime'] {
  return value === 'node-pty' || value === 'tmux';
}

function normalizeTerminalRecord(r: unknown): TerminalSessionRecord | null {
  if (!r || typeof r !== 'object') return null;
  const row = r as Partial<TerminalSessionRecord>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (!isTerminalKind(row.kind)) return null;
  if (!isTerminalRuntime(row.runtime)) return null;
  if (typeof row.projectId !== 'string' || !row.projectId.trim()) return null;
  if (typeof row.cwd !== 'string' || !row.cwd.trim()) return null;
  if (typeof row.command !== 'string') return null;
  if (!Array.isArray(row.args) || row.args.some((a) => typeof a !== 'string')) return null;
  if (typeof row.cols !== 'number' || typeof row.rows !== 'number') return null;
  if (typeof row.startedAt !== 'string' || !row.startedAt.trim()) return null;

  const out: TerminalSessionRecord = {
    id: row.id,
    kind: row.kind,
    runtime: row.runtime,
    projectId: row.projectId,
    cwd: row.cwd,
    command: row.command,
    args: [...row.args],
    cols: row.cols,
    rows: row.rows,
    startedAt: row.startedAt,
    ...(typeof row.repoId === 'string' && row.repoId.length > 0 ? { repoId: row.repoId } : {}),
    ...(typeof row.tmuxSessionName === 'string' && row.tmuxSessionName.length > 0
      ? { tmuxSessionName: row.tmuxSessionName }
      : {}),
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.endedReason ? { endedReason: row.endedReason } : {}),
  };

  if (row.kind === 'task' && row.task && typeof row.task === 'object') {
    const t = row.task as TerminalSessionRecord['task'];
    if (
      t &&
      typeof t.taskId === 'string' &&
      isAgent(t.agent) &&
      typeof t.worktreePath === 'string' &&
      typeof t.fluxxWorkBranch === 'string'
    ) {
      out.task = {
        taskId: t.taskId,
        agent: t.agent,
        worktreePath: t.worktreePath,
        fluxxWorkBranch: t.fluxxWorkBranch,
        ...(t.sourceBranchShort ? { sourceBranchShort: t.sourceBranchShort } : {}),
        ...(t.agentConversationId ? { agentConversationId: t.agentConversationId } : {}),
      };
    } else {
      return null;
    }
  }

  if (row.kind === 'planning' && row.planning && typeof row.planning === 'object') {
    const p = row.planning as TerminalSessionRecord['planning'];
    if (p && isAgent(p.agent) && typeof p.planningDir === 'string') {
      out.planning = {
        agent: p.agent,
        planningDir: p.planningDir,
        ...(p.agentModel ? { agentModel: p.agentModel } : {}),
        ...(typeof p.agentYolo === 'boolean' ? { agentYolo: p.agentYolo } : {}),
        ...(p.agentConversationId ? { agentConversationId: p.agentConversationId } : {}),
      };
    } else {
      return null;
    }
  }

  if (row.kind === 'shell' && row.shell && typeof row.shell === 'object') {
    const s = row.shell as TerminalSessionRecord['shell'];
    if (s && typeof s.parentSessionId === 'string' && typeof s.worktreePath === 'string') {
      out.shell = {
        parentSessionId: s.parentSessionId,
        worktreePath: s.worktreePath,
      };
    } else {
      return null;
    }
  }

  return out;
}

export type TerminalSessionRecordStoreDeps = {
  getProjectDir: () => string;
};

/**
 * Unified durable terminal inventory at `<projectDir>/terminal-sessions.json`.
 * Phase 1 records direct `node-pty` terminals; tmux runtime rows are reserved for later.
 * See `docs/tmux-terminal-persistence-plan.md`.
 */
export class TerminalSessionRecordStore {
  private readonly getProjectDir: () => string;
  private writeChain: Promise<void> = Promise.resolve();
  private cache: TerminalSessionRecord[] = [];
  private loadedForDir: string | null = null;

  constructor(deps: TerminalSessionRecordStoreDeps) {
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
        (parsed as TerminalSessionsFileV1).version === SCHEMA_VERSION &&
        Array.isArray((parsed as TerminalSessionsFileV1).terminals)
      ) {
        this.cache = (parsed as TerminalSessionsFileV1).terminals
          .map((r) => normalizeTerminalRecord(r))
          .filter((r): r is TerminalSessionRecord => r != null);
      } else {
        console.warn('[TerminalSessionRecordStore] malformed terminal-sessions.json; resetting.');
        this.cache = [];
        await this.persist();
      }
    } catch (err: unknown) {
      console.warn('[TerminalSessionRecordStore] failed to load terminal-sessions.json', err);
      this.cache = [];
      try {
        const fp = this.filePath();
        if (fp && (await pathExists(fp))) {
          const backup = `${fp}.corrupt-${Date.now()}`;
          await fs.rename(fp, backup);
        }
      } catch {
        /* ignore backup failure */
      }
    }
  }

  private async persist(): Promise<void> {
    const fp = this.filePath();
    if (!fp) return;
    const body: TerminalSessionsFileV1 = {
      version: SCHEMA_VERSION,
      terminals: this.cache.slice(-MAX_TERMINALS),
    };
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await atomicWriteFile(fp, `${JSON.stringify(body, null, 2)}\n`);
  }

  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async listRecords(): Promise<TerminalSessionRecord[]> {
    await this.ensureLoaded();
    return this.cache.map((r) => ({ ...r }));
  }

  async listOpenRecords(projectId?: string): Promise<TerminalSessionRecord[]> {
    await this.ensureLoaded();
    return this.cache
      .filter((r) => !r.endedAt)
      .filter((r) => (projectId ? r.projectId === projectId : true))
      .map((r) => ({ ...r }));
  }

  async recordTerminalStart(row: TerminalSessionRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      this.cache.push({ ...row });
      await this.persist();
    });
  }

  async mergeTaskConversationId(terminalId: string, agentConversationId: string): Promise<void> {
    const id = agentConversationId.trim();
    if (!id) return;
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.id !== terminalId || r.kind !== 'task' || !r.task) return r;
        if (r.task.agentConversationId === id) return r;
        changed = true;
        return { ...r, task: { ...r.task, agentConversationId: id } };
      });
      if (changed) await this.persist();
    });
  }

  async mergePlanningConversationId(
    terminalId: string,
    agentConversationId: string,
  ): Promise<void> {
    const id = agentConversationId.trim();
    if (!id) return;
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.id !== terminalId || r.kind !== 'planning' || !r.planning) return r;
        if (r.planning.agentConversationId === id) return r;
        changed = true;
        return { ...r, planning: { ...r.planning, agentConversationId: id } };
      });
      if (changed) await this.persist();
    });
  }

  async markTerminalEnded(
    terminalId: string,
    opts: { endedAt?: string; reason: TerminalEndedReason },
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const endedAt = opts.endedAt ?? new Date().toISOString();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.id !== terminalId) return r;
        if (opts.reason === 'workspace-deleted') {
          changed = true;
          return { ...r, endedAt, endedReason: 'workspace-deleted' };
        }
        if (r.endedAt && r.endedReason === 'app-quit') return r;
        if (r.endedAt) return r;
        changed = true;
        return { ...r, endedAt, endedReason: opts.reason };
      });
      if (changed) await this.persist();
    });
  }

  async markReplacedTaskSessions(taskId: string, keepTerminalId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.kind !== 'task' || !r.task || r.task.taskId !== taskId) return r;
        if (r.id === keepTerminalId) return r;
        if (r.endedAt) return r;
        changed = true;
        return {
          ...r,
          endedAt: new Date().toISOString(),
          endedReason: 'replaced-by-new-session',
        };
      });
      if (changed) await this.persist();
    });
  }

  async markReplacedPlanningSessions(projectId: string, keepTerminalId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.kind !== 'planning' || r.projectId !== projectId) return r;
        if (r.id === keepTerminalId) return r;
        if (r.endedAt) return r;
        changed = true;
        return {
          ...r,
          endedAt: new Date().toISOString(),
          endedReason: 'replaced-by-new-session',
        };
      });
      if (changed) await this.persist();
    });
  }

  async markColdResumeReplaced(terminalId: string): Promise<void> {
    await this.markTerminalEnded(terminalId, { reason: 'replaced-by-new-session' });
  }

  async markWorkspaceDeleted(terminalId: string): Promise<void> {
    await this.markTerminalEnded(terminalId, { reason: 'workspace-deleted' });
  }

  /** Test hook: replace in-memory state. */
  _testImportRecords(records: TerminalSessionRecord[]): void {
    this.cache = records.map((r) => ({ ...r }));
    this.loadedForDir = this.getProjectDir()?.trim() ?? null;
  }
}
