import fs from 'node:fs/promises';
import path from 'node:path';
import type { OverseerBinding } from '../types';

const BINDINGS_REL = path.join('.fluxx', 'agent-handoffs', 'overseer-bindings.json');
const SCHEMA_VERSION = 1;
const MAX_BINDINGS = 64;

type PersistedFile = {
  version: typeof SCHEMA_VERSION;
  bindings: OverseerBinding[];
};

function bindingKey(repoId: string, sourceBranch: string): string {
  return `${repoId.trim()}\0${sourceBranch.trim()}`;
}

function normalizeBindingInput(input: {
  projectId: string;
  repoId: string;
  sourceBranch: string;
  planningSessionId: string;
}): { ok: true; binding: Omit<OverseerBinding, 'registeredAt'> } | { ok: false; error: string } {
  const projectId = input.projectId.trim();
  const repoId = input.repoId.trim();
  const sourceBranch = input.sourceBranch.trim();
  const planningSessionId = input.planningSessionId.trim();
  if (!projectId) return { ok: false, error: 'projectId is required' };
  if (!repoId) return { ok: false, error: 'repoId is required' };
  if (!sourceBranch) return { ok: false, error: 'sourceBranch is required' };
  if (sourceBranch.length > 256) {
    return { ok: false, error: 'sourceBranch exceeds 256 characters' };
  }
  if (!planningSessionId) {
    return { ok: false, error: 'planningSessionId is required' };
  }
  if (planningSessionId.length > 256) {
    return { ok: false, error: 'planningSessionId exceeds 256 characters' };
  }
  return { ok: true, binding: { projectId, repoId, sourceBranch, planningSessionId } };
}

function normalizePersistedBinding(row: unknown): OverseerBinding | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Partial<OverseerBinding>;
  const norm = normalizeBindingInput({
    projectId: typeof o.projectId === 'string' ? o.projectId : '',
    repoId: typeof o.repoId === 'string' ? o.repoId : '',
    sourceBranch: typeof o.sourceBranch === 'string' ? o.sourceBranch : '',
    planningSessionId: typeof o.planningSessionId === 'string' ? o.planningSessionId : '',
  });
  if (!norm.ok) return null;
  const registeredAt =
    typeof o.registeredAt === 'string' && o.registeredAt.trim()
      ? o.registeredAt.trim()
      : new Date().toISOString();
  return { ...norm.binding, registeredAt };
}

export class OverseerBindingStore {
  private writeChain: Promise<void> = Promise.resolve();
  private cache: OverseerBinding[] = [];
  private loadedForDir: string | null = null;

  constructor(private readonly getFluxxProjectDir: () => string | null) {}

  private filePath(): string | null {
    const dir = this.getFluxxProjectDir()?.trim();
    if (!dir) return null;
    return path.join(dir, BINDINGS_REL);
  }

  private async ensureLoaded(): Promise<void> {
    const dir = this.getFluxxProjectDir()?.trim() ?? null;
    if (!dir) {
      this.cache = [];
      this.loadedForDir = null;
      return;
    }
    if (this.loadedForDir === dir) return;
    this.loadedForDir = dir;
    const fp = path.join(dir, BINDINGS_REL);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as PersistedFile).version !== SCHEMA_VERSION ||
        !Array.isArray((parsed as PersistedFile).bindings)
      ) {
        this.cache = [];
        return;
      }
      this.cache = (parsed as PersistedFile).bindings
        .map(normalizePersistedBinding)
        .filter((b): b is OverseerBinding => b != null)
        .slice(0, MAX_BINDINGS);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        this.cache = [];
        return;
      }
      console.warn('[OverseerBindingStore] failed to read bindings', err);
      this.cache = [];
    }
  }

  private async save(): Promise<void> {
    const fp = this.filePath();
    if (!fp) {
      throw new Error('No Fluxx project directory for overseer bindings');
    }
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const payload: PersistedFile = {
      version: SCHEMA_VERSION,
      bindings: this.cache.slice(0, MAX_BINDINGS),
    };
    await fs.writeFile(fp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async list(): Promise<OverseerBinding[]> {
    await this.ensureLoaded();
    return this.cache.slice();
  }

  async find(repoId: string, sourceBranch: string): Promise<OverseerBinding | null> {
    await this.ensureLoaded();
    const key = bindingKey(repoId, sourceBranch);
    return this.cache.find((b) => bindingKey(b.repoId, b.sourceBranch) === key) ?? null;
  }

  async register(input: {
    projectId: string;
    repoId: string;
    sourceBranch: string;
    planningSessionId: string;
  }): Promise<OverseerBinding> {
    const norm = normalizeBindingInput(input);
    if (!norm.ok) {
      throw new Error(norm.error);
    }
    const registeredAt = new Date().toISOString();
    const next: OverseerBinding = { ...norm.binding, registeredAt };
    const run = async () => {
      await this.ensureLoaded();
      const key = bindingKey(next.repoId, next.sourceBranch);
      const without = this.cache.filter((b) => bindingKey(b.repoId, b.sourceBranch) !== key);
      without.unshift(next);
      this.cache = without.slice(0, MAX_BINDINGS);
      await this.save();
    };
    this.writeChain = this.writeChain.then(run, run);
    await this.writeChain;
    return next;
  }
}
