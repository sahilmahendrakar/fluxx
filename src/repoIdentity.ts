/**
 * Helpers for the multi-repo data model (feature flag `multi-repo2`).
 *
 * These are intentionally pure / dependency-free so they can be imported
 * from main, renderer, daemon, and tests without dragging in Electron or
 * Node built-ins.
 */

import type {
  CloudRepoLocalBindingStatus,
  LocalProject,
  RepoConfig,
  Task,
} from './types';

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      words[i] =
        (((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rightRotate(words[i - 15], 7) ^ rightRotate(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rightRotate(words[i - 2], 17) ^ rightRotate(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + words[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function normalizeRepoRootPathForIdentity(rootPath: string): string {
  const raw = (rootPath || '.').replace(/\\/g, '/');
  const drive = /^[A-Za-z]:/.test(raw) ? raw.slice(0, 2) : '';
  const rest = drive ? raw.slice(2) : raw;
  const absolute = rest.startsWith('/');
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join('/');
  if (drive) return `${drive}${absolute ? '/' : ''}${joined}` || drive;
  if (absolute) return `/${joined}`;
  return joined || '.';
}

export function repoRootBasename(rootPath: string): string {
  const normalized = normalizeRepoRootPathForIdentity(rootPath);
  if (normalized === '/' || /^[A-Za-z]:\/?$/.test(normalized)) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Deterministic stable id for the **primary** repo of a project that was
 * created before multi-repo2 — derived from the project id + resolved
 * rootPath so any two clients backfilling the same legacy config produce
 * the same id. (Project ids are themselves SHA-256 of the resolved root,
 * so this hash is well-defined even when only the project id is known.)
 */
export function deriveStablePrimaryRepoIdForProject(params: {
  projectId: string;
  rootPath: string;
}): string {
  const resolved = normalizeRepoRootPathForIdentity(params.rootPath);
  return sha256Hex(`primary-repo:${params.projectId}:${resolved}`);
}

/** Stable id for an additional repo, given its rootPath; `salt` distinguishes duplicate rootPaths. */
export function deriveRepoIdForRootPath(params: {
  projectId: string;
  rootPath: string;
  salt?: string;
}): string {
  const resolved = normalizeRepoRootPathForIdentity(params.rootPath);
  const salt = params.salt ?? '';
  return sha256Hex(`repo:${params.projectId}:${resolved}:${salt}`);
}

/**
 * Returns the primary repo for a project — currently defined as the
 * first repo in `repos[]`. With `multi-repo2` off this is also the only
 * repo a project ever exposes at runtime.
 */
export function getPrimaryRepo(repos: ReadonlyArray<RepoConfig>): RepoConfig | undefined {
  return repos[0];
}

/** First repo id in a list (shared cloud repos or local {@link RepoConfig} rows). */
export function resolvePrimaryRepoIdFromList(
  repos: ReadonlyArray<{ id: string }>,
): string | undefined {
  const id = repos[0]?.id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined;
}

/** Convenience for places holding a `LocalProject`. */
export function getPrimaryRepoForProject(
  project: Pick<LocalProject, 'repos'>,
): RepoConfig | undefined {
  return getPrimaryRepo(project.repos);
}

/**
 * Resolves the primary repo's id, returning `undefined` when no repos
 * exist (caller should treat that as a project that has not been fully
 * materialised — most code paths can't reach this state).
 */
export function resolvePrimaryRepoId(
  source: ReadonlyArray<RepoConfig> | Pick<LocalProject, 'repos'>,
): string | undefined {
  const repos: ReadonlyArray<RepoConfig> = Array.isArray(source)
    ? (source as ReadonlyArray<RepoConfig>)
    : (source as Pick<LocalProject, 'repos'>).repos;
  return getPrimaryRepo(repos)?.id;
}

/** Resolved {@link RepoConfig.id} for a task row (missing / blank → primary repo). */
export function effectiveTaskRepoId(
  task: Pick<Task, 'repoId'>,
  primaryRepoId: string,
): string {
  const r = task.repoId?.trim();
  return r && r.length > 0 ? r : primaryRepoId;
}

/** True when `repoId` matches some repo in the project (or `repoId` is undefined → caller meant primary). */
export function repoIdBelongsToProject(
  repos: ReadonlyArray<RepoConfig>,
  repoId: string | undefined,
): boolean {
  if (repoId == null || repoId === '') return repos.length > 0;
  return repos.some((r) => r.id === repoId);
}

/** Look up a repo by id, falling back to the primary repo when `repoId` is missing. */
export function findRepoByIdOrPrimary(
  repos: ReadonlyArray<RepoConfig>,
  repoId: string | undefined,
): RepoConfig | undefined {
  if (repoId != null && repoId !== '') {
    const exact = repos.find((r) => r.id === repoId);
    if (exact) return exact;
  }
  return getPrimaryRepo(repos);
}

/**
 * Like {@link findRepoByIdOrPrimary}, but when `repoId` is non-empty and missing
 * from `repos[]`, returns `undefined` (caller surfaces “unknown id”).
 */
export function resolveRepoForBranchDiscovery(
  repos: ReadonlyArray<RepoConfig>,
  repoId: string | undefined,
): RepoConfig | undefined {
  if (repoId != null && repoId.trim() !== '') {
    const trimmed = repoId.trim();
    return repos.find((r) => r.id === trimmed);
  }
  return getPrimaryRepo(repos);
}

/**
 * Persists repo id after a patch, matching {@link TaskStore.update} semantics for `repoId`.
 */
export function nextPersistedRepoIdAfterPatch(
  previousRepoId: string | undefined,
  patchRepoId: string | undefined,
): string | undefined {
  if (patchRepoId === undefined) {
    return previousRepoId;
  }
  const next = (patchRepoId ?? '').trim();
  return next.length === 0 ? undefined : next;
}

/** True when two persisted `repoId` slots are the same (unset/blank-normalized). */
export function persistedRepoIdsEqual(a: string | undefined, b: string | undefined): boolean {
  const na = (a ?? '').trim();
  const nb = (b ?? '').trim();
  return na === nb;
}

/**
 * Resolves the repo id for a new local task: explicit id must exist on the project;
 * otherwise the primary repo id is used.
 */
export function resolveLocalTaskRepoIdForCreate(
  repos: ReadonlyArray<{ id: string }>,
  requestedRepoId: string | undefined,
): { ok: true; repoId: string } | { ok: false; message: string } {
  const primary = resolvePrimaryRepoIdFromList(repos);
  if (!primary) {
    return { ok: false, message: 'No repository identity configured for this project' };
  }
  if (requestedRepoId == null || String(requestedRepoId).trim() === '') {
    return { ok: true, repoId: primary };
  }
  const rid = String(requestedRepoId).trim();
  if (!repos.some((r) => r.id === rid)) {
    return { ok: false, message: `Unknown repository id: ${rid}` };
  }
  return { ok: true, repoId: rid };
}

/** Non-empty patch values must match a repo on the project; clearing (`''`) is allowed. */
export function validateTaskRepoIdPatchValue(
  repos: ReadonlyArray<{ id: string }>,
  patchRepoId: string | undefined,
): { ok: true } | { ok: false; message: string } {
  if (patchRepoId === undefined) return { ok: true };
  const next = (patchRepoId ?? '').trim();
  if (next.length === 0) return { ok: true };
  if (!repos.some((r) => r.id === next)) {
    return { ok: false, message: `Unknown repository id: ${next}` };
  }
  return { ok: true };
}

/**
 * Display label for a repo card / sidebar header. Prefers the explicit
 * `name`, falls back to `basename(rootPath)`, then to a short id slice
 * so the UI never shows an empty string.
 */
export function repoDisplayLabel(
  repo: Pick<RepoConfig, 'id' | 'name' | 'rootPath'>,
): string {
  const explicit = (repo.name ?? '').trim();
  if (explicit.length > 0) return explicit;
  const base = repoRootBasename(repo.rootPath ?? '');
  if (base && base !== '.') return base;
  return repo.id ? `repo:${repo.id.slice(0, 7)}` : 'repo';
}

/** Tooltip lines for compact repo chips on the board (path and optional cloud clone status). */
export function repoChipTooltipText(
  repo: Pick<RepoConfig, 'name' | 'rootPath'>,
  binding?: CloudRepoLocalBindingStatus,
): string {
  const label = repoDisplayLabel(repo as RepoConfig);
  const resolvedPath = normalizeRepoRootPathForIdentity(repo.rootPath ?? '');
  if (!binding) {
    return `${label}\n${resolvedPath}`;
  }
  if (binding.kind === 'missing_binding') {
    return `${label}\nLocal clone: not bound`;
  }
  const statusLine =
    binding.pathStatus === 'valid'
      ? 'Clone: ready'
      : binding.pathStatus === 'missing'
        ? 'Clone: path missing'
        : 'Clone: not a git repository';
  return `${label}\n${binding.rootPath}\n${statusLine}`;
}
