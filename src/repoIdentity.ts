/**
 * Helpers for the multi-repo data model (feature flag `multi-repo2`).
 *
 * These are intentionally pure / dependency-free so they can be imported
 * from main, renderer, daemon, and tests without dragging in Electron or
 * fs. Use `node:path` only for portable basename computation; that
 * runs identically in Node and in the renderer's bundled environment.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import type { LocalProject, RepoConfig } from './types';

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
  const resolved = path.resolve(params.rootPath);
  return createHash('sha256')
    .update(`primary-repo:${params.projectId}:${resolved}`)
    .digest('hex');
}

/** Stable id for an additional repo, given its rootPath; `salt` distinguishes duplicate rootPaths. */
export function deriveRepoIdForRootPath(params: {
  projectId: string;
  rootPath: string;
  salt?: string;
}): string {
  const resolved = path.resolve(params.rootPath);
  const salt = params.salt ?? '';
  return createHash('sha256')
    .update(`repo:${params.projectId}:${resolved}:${salt}`)
    .digest('hex');
}

/**
 * Returns the primary repo for a project — currently defined as the
 * first repo in `repos[]`. With `multi-repo2` off this is also the only
 * repo a project ever exposes at runtime.
 */
export function getPrimaryRepo(repos: ReadonlyArray<RepoConfig>): RepoConfig | undefined {
  return repos[0];
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
 * Display label for a repo card / sidebar header. Prefers the explicit
 * `name`, falls back to `basename(rootPath)`, then to a short id slice
 * so the UI never shows an empty string.
 */
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
  repos: ReadonlyArray<RepoConfig>,
  requestedRepoId: string | undefined,
): { ok: true; repoId: string } | { ok: false; message: string } {
  const primary = resolvePrimaryRepoId(repos);
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
  repos: ReadonlyArray<RepoConfig>,
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

export function repoDisplayLabel(
  repo: Pick<RepoConfig, 'id' | 'name' | 'rootPath'>,
): string {
  const explicit = (repo.name ?? '').trim();
  if (explicit.length > 0) return explicit;
  const base = path.basename(path.resolve(repo.rootPath ?? ''));
  if (base && base !== '.' && base !== path.sep) return base;
  return repo.id ? `repo:${repo.id.slice(0, 7)}` : 'repo';
}
