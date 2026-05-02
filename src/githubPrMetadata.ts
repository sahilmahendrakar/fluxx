import type { TaskGithubPr, TaskGithubPrState } from './types';

const GH_PR_STATES = new Set<TaskGithubPrState>(['open', 'closed', 'merged']);

function normaliseGhState(raw: string | undefined): TaskGithubPrState | undefined {
  if (!raw) return undefined;
  const u = raw.toUpperCase();
  if (u === 'OPEN') return 'open';
  if (u === 'CLOSED') return 'closed';
  if (u === 'MERGED') return 'merged';
  const lower = raw.toLowerCase();
  if (GH_PR_STATES.has(lower as TaskGithubPrState)) {
    return lower as TaskGithubPrState;
  }
  return undefined;
}

/**
 * Normalises a Firestore / JSON blob into `TaskGithubPr`, or `undefined` if invalid.
 */
export function parseGithubPrField(val: unknown): TaskGithubPr | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const o = val as Record<string, unknown>;
  if (typeof o.url !== 'string' || o.url.trim() === '') {
    return undefined;
  }
  const url = o.url.trim();
  const out: TaskGithubPr = { url };
  if (typeof o.number === 'number' && Number.isFinite(o.number)) {
    out.number = o.number;
  }
  const state = normaliseGhState(typeof o.state === 'string' ? o.state : undefined);
  if (state) out.state = state;
  for (const k of ['mergedAt', 'headBranch', 'baseBranch', 'createdAt', 'updatedAt'] as const) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') {
      out[k] = v.trim();
    }
  }
  return out;
}

export type GhPrViewJson = {
  url?: string;
  number?: number;
  state?: string;
  mergedAt?: string;
  headRefName?: string;
  baseRefName?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Parses a single JSON object from `gh pr view --json` (one PR record).
 */
export function parseGhPrViewRecord(record: GhPrViewJson | null | undefined): TaskGithubPr | null {
  if (!record || typeof record !== 'object') return null;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) return null;
  const out: TaskGithubPr = { url };
  if (typeof record.number === 'number' && Number.isFinite(record.number)) {
    out.number = record.number;
  }
  const state = normaliseGhState(record.state);
  if (state) out.state = state;
  if (typeof record.mergedAt === 'string' && record.mergedAt.trim() !== '') {
    out.mergedAt = record.mergedAt.trim();
  }
  if (typeof record.headRefName === 'string' && record.headRefName.trim() !== '') {
    out.headBranch = record.headRefName.trim();
  }
  if (typeof record.baseRefName === 'string' && record.baseRefName.trim() !== '') {
    out.baseBranch = record.baseRefName.trim();
  }
  if (typeof record.createdAt === 'string' && record.createdAt.trim() !== '') {
    out.createdAt = record.createdAt.trim();
  }
  if (typeof record.updatedAt === 'string' && record.updatedAt.trim() !== '') {
    out.updatedAt = record.updatedAt.trim();
  }
  return out;
}

function trimStr(s: string | undefined): string {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * True when persisted `githubPr` already matches what we would store after a
 * refresh for UI / merge detection. Ignores `createdAt` / `updatedAt` so GitHub
 * metadata churn does not cause writes.
 */
export function githubPrRefreshViewEqual(
  previous: TaskGithubPr | undefined,
  next: TaskGithubPr,
): boolean {
  if (!previous) return false;
  if (trimStr(previous.url) !== trimStr(next.url)) return false;
  if (previous.state !== next.state) return false;
  if (trimStr(previous.mergedAt) !== trimStr(next.mergedAt)) return false;
  if (previous.number !== next.number) return false;
  if (trimStr(previous.headBranch) !== trimStr(next.headBranch)) return false;
  if (trimStr(previous.baseBranch) !== trimStr(next.baseBranch)) return false;
  return true;
}

export function parseGhPrViewJsonStdout(jsonStr: string): TaskGithubPr | null {
  const trimmed = jsonStr.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parseGhPrViewRecord(parsed as GhPrViewJson);
  }
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object') {
    return parseGhPrViewRecord(parsed[0] as GhPrViewJson);
  }
  return null;
}
