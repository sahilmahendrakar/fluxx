import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PlanningAgentSessionEndedReason,
  PlanningAgentSessionRecord,
  PlanningSession,
} from '../types';

const FILE_NAME = 'planning-agent-sessions.json';
const SCHEMA_VERSION = 1;
const MAX_RECORDS = 500;

const COLD_RESUMABLE_END_REASONS: PlanningAgentSessionEndedReason[] = [
  'app-quit',
  'agent-exit-ok',
  'agent-exit-error',
];

type PersistedFileV1 = {
  version: typeof SCHEMA_VERSION;
  records: PlanningAgentSessionRecord[];
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeRecord(r: unknown): PlanningAgentSessionRecord | null {
  if (!r || typeof r !== 'object') return null;
  const row = r as Partial<PlanningAgentSessionRecord>;
  if (typeof row.fluxxSessionId !== 'string' || !row.fluxxSessionId.trim()) return null;
  if (typeof row.projectId !== 'string' || !row.projectId.trim()) return null;
  if (typeof row.planningDir !== 'string' || !row.planningDir.trim()) return null;
  if (typeof row.startedAt !== 'string' || !row.startedAt.trim()) return null;
  if (row.agent !== 'claude-code' && row.agent !== 'cursor' && row.agent !== 'codex') return null;
  return {
    fluxxSessionId: row.fluxxSessionId,
    projectId: row.projectId,
    agent: row.agent,
    planningDir: row.planningDir,
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.endedReason ? { endedReason: row.endedReason } : {}),
    ...(row.agentConversationId ? { agentConversationId: row.agentConversationId } : {}),
    ...(row.agentModel ? { agentModel: row.agentModel } : {}),
    ...(typeof row.agentYolo === 'boolean' ? { agentYolo: row.agentYolo } : {}),
  };
}

export type PlanningAgentSessionRecordStoreDeps = {
  getProjectDir: () => string;
};

/**
 * Persists planning agent session metadata under `<projectDir>/planning-agent-sessions.json`
 * for cold resume (conversation ids, quit detection).
 */
export class PlanningAgentSessionRecordStore {
  private readonly getProjectDir: () => string;
  private writeChain: Promise<void> = Promise.resolve();
  private cache: PlanningAgentSessionRecord[] = [];
  private loadedForDir: string | null = null;

  constructor(deps: PlanningAgentSessionRecordStoreDeps) {
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
        this.cache = (parsed as PersistedFileV1).records
          .map((r) => normalizeRecord(r))
          .filter((r): r is PlanningAgentSessionRecord => r != null);
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

  async recordSessionStart(row: PlanningAgentSessionRecord): Promise<void> {
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
    session: Pick<PlanningSession, 'id' | 'status' | 'stoppedAt' | 'startedAt'>,
    opts: { reason: PlanningAgentSessionEndedReason },
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const endedAt = session.stoppedAt ?? new Date().toISOString();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.fluxxSessionId !== session.id) return r;
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

  async markReplacedSessions(projectId: string, keepFluxxSessionId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureLoaded();
      let changed = false;
      this.cache = this.cache.map((r) => {
        if (r.projectId !== projectId) return r;
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

  /**
   * Synthetic planning session for UI when no live PTY exists but the last session ended in a
   * resumable way and the planning directory is still present.
   */
  async getColdResumePlanningSessionView(
    projectId: string,
    planningDirStillPresent: (absPath: string) => Promise<boolean>,
    opts?: { excludeFluxxSessionIds?: Set<string> },
  ): Promise<PlanningSession | null> {
    await this.ensureLoaded();
    const exclude = opts?.excludeFluxxSessionIds ?? new Set<string>();
    const candidates = this.cache
      .filter((r) => r.projectId === projectId)
      .filter((r) => !exclude.has(r.fluxxSessionId))
      .filter((r) =>
        COLD_RESUMABLE_END_REASONS.includes(
          r.endedReason as PlanningAgentSessionEndedReason,
        ),
      )
      .sort((a, b) => {
        const ea = a.endedAt ?? a.startedAt;
        const eb = b.endedAt ?? b.startedAt;
        return eb.localeCompare(ea);
      });

    for (const r of candidates) {
      const dir = r.planningDir?.trim();
      if (!dir) continue;
      if (!(await planningDirStillPresent(dir))) continue;
      const stoppedAt = r.endedAt ?? r.startedAt;
      return {
        id: r.fluxxSessionId,
        projectId: r.projectId,
        agent: r.agent,
        planningDir: r.planningDir,
        status: 'interrupted',
        startedAt: r.startedAt,
        stoppedAt,
        ...(r.agentConversationId ? { agentConversationId: r.agentConversationId } : {}),
      };
    }
    return null;
  }

  /** All cold-resumable synthetic rows for a project (newest first). */
  async listColdResumePlanningSessions(
    projectId: string,
    planningDirStillPresent: (absPath: string) => Promise<boolean>,
    opts?: { excludeFluxxSessionIds?: Set<string> },
  ): Promise<PlanningSession[]> {
    await this.ensureLoaded();
    const exclude = opts?.excludeFluxxSessionIds ?? new Set<string>();
    const rows: PlanningSession[] = [];
    const seen = new Set<string>();

    const candidates = this.cache
      .filter((r) => r.projectId === projectId)
      .filter((r) => !exclude.has(r.fluxxSessionId))
      .filter((r) =>
        COLD_RESUMABLE_END_REASONS.includes(
          r.endedReason as PlanningAgentSessionEndedReason,
        ),
      )
      .sort((a, b) => {
        const ea = a.endedAt ?? a.startedAt;
        const eb = b.endedAt ?? b.startedAt;
        return eb.localeCompare(ea);
      });

    for (const r of candidates) {
      if (seen.has(r.fluxxSessionId)) continue;
      const dir = r.planningDir?.trim();
      if (!dir) continue;
      if (!(await planningDirStillPresent(dir))) continue;
      seen.add(r.fluxxSessionId);
      const stoppedAt = r.endedAt ?? r.startedAt;
      rows.push({
        id: r.fluxxSessionId,
        projectId: r.projectId,
        agent: r.agent,
        planningDir: r.planningDir,
        status: 'interrupted',
        startedAt: r.startedAt,
        stoppedAt,
        ...(r.agentConversationId ? { agentConversationId: r.agentConversationId } : {}),
      });
    }
    return rows;
  }

  /** Test hook: replace in-memory state. */
  _testImportRecords(records: PlanningAgentSessionRecord[]): void {
    this.cache = records.map((r) => ({ ...r }));
    this.loadedForDir = this.getProjectDir()?.trim() ?? null;
  }
}
