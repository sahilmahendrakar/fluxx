import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '../types';
import {
  normalizeValidationRunRelativePath,
  resolvePathUnderValidationRunDir,
  VALIDATION_RUN_ARTIFACT_SUBDIRS,
  validationRunDir,
} from '../validationRuns/path';
import { scaffoldValidationRunFiles } from '../validationPacks/scaffoldRunFiles';
import { isValidationPackId } from '../validationPacks/registry';
import type { ValidationPackId } from '../validationPacks/types';
import type {
  ValidationArtifact,
  ValidationArtifactFileState,
  ValidationArtifactKind,
  ValidationArtifactRegisterInput,
  ValidationArtifactView,
  ValidationRun,
  ValidationRunCreateInput,
  ValidationRunGuardrailsUpdate,
  ValidationRunLaunchUpdate,
  ValidationRunStatus,
  ValidationRunStatusUpdate,
} from '../validationRuns/types';

const FILE_NAME = 'validation-runs.json';
const SCHEMA_VERSION = 1;

const TERMINAL_STATUSES: ValidationRunStatus[] = [
  'passed',
  'failed',
  'needs-human-review',
  'errored',
  'cancelled',
];

const VALID_STATUSES: ValidationRunStatus[] = [
  'queued',
  'running',
  ...TERMINAL_STATUSES,
];

const VALID_KINDS: ValidationArtifactKind[] = [
  'screenshot',
  'video',
  'trace',
  'console-log',
  'text',
  'json',
];

type PersistedRunRow = {
  id: string;
  taskId: string;
  projectId: string;
  repoId?: string;
  packId: ValidationPackId;
  status: ValidationRunStatus;
  validatorAgent: Agent;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  verdictReason?: string;
  validatorSessionId?: string;
  worktreeCwd?: string;
  preValidationGitStatus?: string;
  postValidationGitStatus?: string;
  gitStatusDriftDetected?: boolean;
  artifacts: ValidationArtifact[];
};

type PersistedFileV1 = {
  version: typeof SCHEMA_VERSION;
  runs: PersistedRunRow[];
};

export type ValidationRunStoreDeps = {
  getProjectDir: () => string;
};

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isValidationRunStatus(s: string): s is ValidationRunStatus {
  return (VALID_STATUSES as string[]).includes(s);
}

function isValidationArtifactKind(s: string): s is ValidationArtifactKind {
  return (VALID_KINDS as string[]).includes(s);
}

function isAgent(s: string): s is Agent {
  return s === 'claude-code' || s === 'codex' || s === 'cursor';
}

function parsePersistedRow(raw: unknown): PersistedRunRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.taskId !== 'string' || typeof r.projectId !== 'string') {
    return null;
  }
  if (r.packId !== 'electron-playwright') return null;
  if (typeof r.status !== 'string' || !isValidationRunStatus(r.status)) return null;
  if (typeof r.validatorAgent !== 'string' || !isAgent(r.validatorAgent)) return null;
  if (typeof r.startedAt !== 'string') return null;
  const artifacts: ValidationArtifact[] = [];
  if (Array.isArray(r.artifacts)) {
    for (const a of r.artifacts) {
      if (!a || typeof a !== 'object') continue;
      const row = a as Record<string, unknown>;
      if (
        typeof row.id !== 'string' ||
        typeof row.label !== 'string' ||
        typeof row.path !== 'string' ||
        typeof row.createdAt !== 'string' ||
        typeof row.kind !== 'string' ||
        !isValidationArtifactKind(row.kind)
      ) {
        continue;
      }
      const norm = normalizeValidationRunRelativePath(row.path);
      if (!norm) continue;
      artifacts.push({
        id: row.id,
        kind: row.kind,
        label: row.label.trim(),
        path: norm,
        createdAt: row.createdAt,
      });
    }
  }
  const out: PersistedRunRow = {
    id: r.id,
    taskId: r.taskId,
    projectId: r.projectId,
    packId: 'electron-playwright',
    status: r.status,
    validatorAgent: r.validatorAgent,
    startedAt: r.startedAt,
    artifacts,
  };
  if (typeof r.repoId === 'string' && r.repoId.trim().length > 0) {
    out.repoId = r.repoId.trim();
  }
  if (typeof r.completedAt === 'string') out.completedAt = r.completedAt;
  if (typeof r.summary === 'string') out.summary = r.summary;
  if (typeof r.verdictReason === 'string') out.verdictReason = r.verdictReason;
  if (typeof r.validatorSessionId === 'string' && r.validatorSessionId.trim()) {
    out.validatorSessionId = r.validatorSessionId.trim();
  }
  if (typeof r.worktreeCwd === 'string' && r.worktreeCwd.trim()) {
    out.worktreeCwd = r.worktreeCwd.trim();
  }
  if (typeof r.preValidationGitStatus === 'string') {
    out.preValidationGitStatus = r.preValidationGitStatus;
  }
  if (typeof r.postValidationGitStatus === 'string') {
    out.postValidationGitStatus = r.postValidationGitStatus;
  }
  if (typeof r.gitStatusDriftDetected === 'boolean') {
    out.gitStatusDriftDetected = r.gitStatusDriftDetected;
  }
  return out;
}

export async function probeValidationArtifactFileState(
  absPath: string,
): Promise<ValidationArtifactFileState> {
  try {
    const st = await fs.stat(absPath);
    if (!st.isFile()) return 'missing';
    try {
      await fs.access(absPath, fs.constants.R_OK);
      return 'present';
    } catch {
      return 'unreadable';
    }
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') return 'missing';
    return 'unreadable';
  }
}

/**
 * Persists validation run metadata under `<projectDir>/validation-runs.json` and
 * allocates per-run directories under `<projectDir>/validation-runs/<runId>/`.
 */
export class ValidationRunStore {
  private readonly getProjectDir: () => string;
  private writeChain: Promise<void> = Promise.resolve();
  private cache: PersistedRunRow[] = [];
  private loadedForDir: string | null = null;

  constructor(deps: ValidationRunStoreDeps) {
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
      return;
    }
    const fp = path.join(dir, FILE_NAME);
    const fileExists = await pathExists(fp);
    if (this.loadedForDir === dir) {
      if (this.cache.length > 0 || !fileExists) return;
    }
    if (!fileExists) {
      this.cache = [];
      this.loadedForDir = dir;
      return;
    }
    this.loadedForDir = dir;
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'runs' in parsed &&
        Array.isArray((parsed as PersistedFileV1).runs)
      ) {
        this.cache = (parsed as PersistedFileV1).runs
          .map((r) => parsePersistedRow(r))
          .filter((r): r is PersistedRunRow => r != null);
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
      runs: this.cache,
    };
    const tmpPath = `${fp}.tmp`;
    const payload = `${JSON.stringify(body, null, 2)}\n`;
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(tmpPath, payload, 'utf8');
    if (process.platform === 'win32') {
      try {
        await fs.unlink(fp);
      } catch (err: unknown) {
        if (errnoCode(err) !== 'ENOENT') throw err;
      }
    }
    await fs.rename(tmpPath, fp);
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  whenWriteIdle(): Promise<void> {
    return this.writeChain;
  }

  private requireProjectDir(): string {
    const dir = this.getProjectDir()?.trim();
    if (!dir) throw new Error('No project directory open for validation runs');
    return dir;
  }

  private async enrichArtifacts(
    projectDir: string,
    runId: string,
    artifacts: ValidationArtifact[],
  ): Promise<ValidationArtifactView[]> {
    const runDir = validationRunDir(projectDir, runId);
    const views: ValidationArtifactView[] = [];
    for (const a of artifacts) {
      const abs = resolvePathUnderValidationRunDir(runDir, a.path);
      const fileState = abs
        ? await probeValidationArtifactFileState(abs)
        : 'missing';
      views.push({ ...a, fileState });
    }
    return views;
  }

  private async toValidationRun(row: PersistedRunRow): Promise<ValidationRun> {
    const projectDir = this.requireProjectDir();
    const artifactDir = validationRunDir(projectDir, row.id);
    const gitGuardrails =
      row.preValidationGitStatus !== undefined ||
      row.postValidationGitStatus !== undefined ||
      row.gitStatusDriftDetected !== undefined
        ? {
            ...(row.preValidationGitStatus !== undefined
              ? { preValidationGitStatus: row.preValidationGitStatus }
              : {}),
            ...(row.postValidationGitStatus !== undefined
              ? { postValidationGitStatus: row.postValidationGitStatus }
              : {}),
            ...(row.gitStatusDriftDetected !== undefined
              ? { gitStatusDriftDetected: row.gitStatusDriftDetected }
              : {}),
          }
        : undefined;
    return {
      id: row.id,
      taskId: row.taskId,
      projectId: row.projectId,
      ...(row.repoId ? { repoId: row.repoId } : {}),
      packId: row.packId,
      status: row.status,
      validatorAgent: row.validatorAgent,
      startedAt: row.startedAt,
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.verdictReason ? { verdictReason: row.verdictReason } : {}),
      ...(row.validatorSessionId ? { validatorSessionId: row.validatorSessionId } : {}),
      ...(row.worktreeCwd ? { worktreeCwd: row.worktreeCwd } : {}),
      ...(gitGuardrails ? { gitGuardrails } : {}),
      artifactDir,
      artifacts: await this.enrichArtifacts(projectDir, row.id, row.artifacts),
    };
  }

  async scaffoldRunDirectory(
    projectDir: string,
    runId: string,
    packId: ValidationPackId,
    worktreeCwd?: string,
  ): Promise<string> {
    const dir = validationRunDir(projectDir, runId);
    await fs.mkdir(dir, { recursive: true });
    for (const sub of VALIDATION_RUN_ARTIFACT_SUBDIRS) {
      await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
    await scaffoldValidationRunFiles({
      packId,
      runId,
      runDir: dir,
      projectDir,
      ...(worktreeCwd?.trim() ? { worktreeCwd: worktreeCwd.trim() } : {}),
    });
    return dir;
  }

  async create(input: ValidationRunCreateInput): Promise<ValidationRun> {
    return this.enqueueWrite(async () => {
      const projectDir = this.requireProjectDir();
      await this.ensureLoaded();
      const packId: ValidationPackId = input.packId ?? 'electron-playwright';
      if (!isValidationPackId(packId)) {
        throw new Error(`Unsupported validation pack: ${packId}`);
      }
      if (!isAgent(input.validatorAgent)) {
        throw new Error('Invalid validator agent');
      }
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      const row: PersistedRunRow = {
        id,
        taskId: input.taskId,
        projectId: input.projectId,
        ...(input.repoId?.trim() ? { repoId: input.repoId.trim() } : {}),
        packId,
        status: 'queued',
        validatorAgent: input.validatorAgent,
        startedAt,
        artifacts: [],
      };
      await this.scaffoldRunDirectory(projectDir, id, packId, input.worktreeCwd);
      this.cache.push(row);
      await this.persist();
      return this.toValidationRun(row);
    });
  }

  async updateStatus(patch: ValidationRunStatusUpdate): Promise<ValidationRun> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded();
      if (!isValidationRunStatus(patch.status)) {
        throw new Error(`Invalid validation run status: ${patch.status}`);
      }
      const index = this.cache.findIndex((r) => r.id === patch.runId);
      if (index === -1) {
        throw new Error(`Validation run not found: ${patch.runId}`);
      }
      const current = this.cache[index];
      const completedAt =
        patch.completedAt ??
        (TERMINAL_STATUSES.includes(patch.status) ? new Date().toISOString() : undefined);
      const updated: PersistedRunRow = {
        ...current,
        status: patch.status,
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.verdictReason !== undefined ? { verdictReason: patch.verdictReason } : {}),
        ...(completedAt ? { completedAt } : {}),
      };
      this.cache[index] = updated;
      await this.persist();
      return this.toValidationRun(updated);
    });
  }

  async listForTask(taskId: string): Promise<ValidationRun[]> {
    await this.ensureLoaded();
    const rows = this.cache
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Promise.all(rows.map((r) => this.toValidationRun(r)));
  }

  async get(runId: string): Promise<ValidationRun | null> {
    await this.ensureLoaded();
    const row = this.cache.find((r) => r.id === runId);
    if (!row) return null;
    return this.toValidationRun(row);
  }

  async registerArtifact(input: ValidationArtifactRegisterInput): Promise<ValidationRun> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const norm = normalizeValidationRunRelativePath(input.path);
      if (!norm) {
        throw new Error('Invalid artifact path');
      }
      if (!isValidationArtifactKind(input.kind)) {
        throw new Error(`Invalid artifact kind: ${input.kind}`);
      }
      const label = input.label.trim();
      if (!label) {
        throw new Error('Artifact label is required');
      }
      const index = this.cache.findIndex((r) => r.id === input.runId);
      if (index === -1) {
        throw new Error(`Validation run not found: ${input.runId}`);
      }
      const projectDir = this.requireProjectDir();
      const runDir = validationRunDir(projectDir, input.runId);
      if (!resolvePathUnderValidationRunDir(runDir, norm)) {
        throw new Error('Artifact path escapes validation run directory');
      }
      const artifact: ValidationArtifact = {
        id: randomUUID(),
        kind: input.kind,
        label,
        path: norm,
        createdAt: input.createdAt?.trim() || new Date().toISOString(),
      };
      const current = this.cache[index];
      const updated: PersistedRunRow = {
        ...current,
        artifacts: [...current.artifacts, artifact],
      };
      this.cache[index] = updated;
      await this.persist();
      return this.toValidationRun(updated);
    });
  }

  async markLaunched(input: ValidationRunLaunchUpdate): Promise<ValidationRun> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const index = this.cache.findIndex((r) => r.id === input.runId);
      if (index === -1) {
        throw new Error(`Validation run not found: ${input.runId}`);
      }
      const current = this.cache[index];
      if (current.status !== 'queued') {
        throw new Error(`Validation run is not queued: ${current.status}`);
      }
      const updated: PersistedRunRow = {
        ...current,
        status: 'running',
        validatorSessionId: input.validatorSessionId.trim(),
        worktreeCwd: input.worktreeCwd.trim(),
        preValidationGitStatus: input.preValidationGitStatus,
      };
      this.cache[index] = updated;
      await this.persist();
      return this.toValidationRun(updated);
    });
  }

  async updateGuardrails(input: ValidationRunGuardrailsUpdate): Promise<ValidationRun> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded();
      const index = this.cache.findIndex((r) => r.id === input.runId);
      if (index === -1) {
        throw new Error(`Validation run not found: ${input.runId}`);
      }
      const current = this.cache[index];
      const updated: PersistedRunRow = {
        ...current,
        postValidationGitStatus: input.postValidationGitStatus,
        gitStatusDriftDetected: input.gitStatusDriftDetected,
      };
      this.cache[index] = updated;
      await this.persist();
      return this.toValidationRun(updated);
    });
  }

  /** Test hook: replace in-memory state without touching disk layout. */
  _testImportRuns(runs: PersistedRunRow[]): void {
    this.cache = runs.map((r) => ({ ...r, artifacts: r.artifacts.map((a) => ({ ...a })) }));
    this.loadedForDir = this.getProjectDir()?.trim() ?? null;
  }
}
