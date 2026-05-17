/**
 * Task **source** branch (see `Task.sourceBranch`) vs the generated Flux work
 * branch on `Session.branch` (`fluxx/task-<id>`). Helpers normalize user/MCP
 * input and classify presence against local + remote short-name sets.
 */

import type { GitBranchPresence, RepoBranchDiscovery, Task } from './types';

export type { GitBranchPresence } from './types';

/**
 * Decide persisted `sourceBranch` + `createSourceBranchIfMissing` for a newly
 * created task, given a discovery snapshot from git (main process) and optional
 * caller overrides (UI / MCP).
 */
export function planTaskSourceBranchFieldsForCreate(
  discovery: RepoBranchDiscovery,
  input?: { sourceBranch?: string; createSourceBranchIfMissing?: boolean },
): { sourceBranch: string; createSourceBranchIfMissing: boolean } {
  const defaultShort = normalizeGitBranchShortName(discovery.defaultBranchShort) || 'main';
  const raw =
    input?.sourceBranch != null && input.sourceBranch.trim().length > 0
      ? input.sourceBranch
      : discovery.defaultBranchShort;
  const { normalizedShort, presence } = classifyGitBranchPresence(
    raw,
    discovery.localBranches,
    discovery.remoteBranches,
  );
  const branchToStore =
    normalizedShort.length > 0 ? normalizedShort : defaultShort;
  const createMissing =
    input?.createSourceBranchIfMissing !== undefined
      ? input.createSourceBranchIfMissing
      : presence === 'missing';
  return {
    sourceBranch: branchToStore,
    createSourceBranchIfMissing: createMissing,
  };
}

const ORIGIN_PREFIX = 'origin/';

/**
 * Normalizes branch input to a short branch name: trims whitespace, strips
 * optional `refs/heads/`, maps `origin/foo` → `foo`, rejects empty.
 */
export function normalizeGitBranchShortName(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('refs/heads/')) {
    s = s.slice('refs/heads/'.length).trim();
  }
  if (s.startsWith('refs/remotes/')) {
    s = s.slice('refs/remotes/'.length).trim();
  }
  if (s.startsWith(ORIGIN_PREFIX)) {
    s = s.slice(ORIGIN_PREFIX.length).trim();
  }
  return s;
}

function branchSet(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const k = normalizeGitBranchShortName(n);
    if (k.length > 0) out.add(k);
  }
  return out;
}

export function classifyGitBranchPresence(
  rawRequested: string,
  localBranches: readonly string[],
  remoteBranches: readonly string[],
): { normalizedShort: string; presence: GitBranchPresence } {
  const normalizedShort = normalizeGitBranchShortName(rawRequested);
  if (!normalizedShort) {
    return { normalizedShort: '', presence: 'missing' };
  }
  const L = branchSet(localBranches);
  const R = branchSet(remoteBranches);
  const loc = L.has(normalizedShort);
  const rem = R.has(normalizedShort);
  let presence: GitBranchPresence;
  if (loc && rem) presence = 'both';
  else if (loc) presence = 'local';
  else if (rem) presence = 'remote';
  else presence = 'missing';
  return { normalizedShort, presence };
}

/**
 * Effective stored source branch for a task. Missing/blank `task.sourceBranch`
 * → `projectDefaultBranchShort` (from `RepoConfig.baseBranch` / detected default).
 */
export function effectiveTaskSourceBranchShort(
  task: Pick<Task, 'sourceBranch'>,
  projectDefaultBranchShort: string,
): string {
  const fromTask = (task.sourceBranch ?? '').trim();
  if (!fromTask) {
    return normalizeGitBranchShortName(projectDefaultBranchShort);
  }
  return normalizeGitBranchShortName(fromTask);
}

/** When starting a session: honor explicit flag; if absent and branch is missing, default permissive `true`. */
export function resolveCreateSourceBranchIfMissingForStart(
  task: Pick<Task, 'createSourceBranchIfMissing'>,
  presence: GitBranchPresence,
): boolean {
  if (presence !== 'missing') {
    return false;
  }
  if (task.createSourceBranchIfMissing === false) {
    return false;
  }
  if (task.createSourceBranchIfMissing === true) {
    return true;
  }
  return true;
}

/** `true` only when the task row explicitly requests create-on-start for a missing branch. */
export function persistedCreateSourceBranchIfMissing(
  task: Pick<Task, 'createSourceBranchIfMissing'>,
): boolean {
  return task.createSourceBranchIfMissing === true;
}

export function persistedSourceBranchShort(
  task: Pick<Task, 'sourceBranch'>,
): string | undefined {
  const t = (task.sourceBranch ?? '').trim();
  return t.length > 0 ? normalizeGitBranchShortName(t) : undefined;
}

/**
 * Whether applying `patch` would change stored source-branch metadata compared
 * to `previous` (after the same normalization rules as {@link TaskStore}).
 */
export function nextPersistedSourceBranchShortAfterPatch(
  previous: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
  patch: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
): string | undefined {
  let nextSrc = persistedSourceBranchShort(previous);
  if (patch.sourceBranch !== undefined) {
    const b = patch.sourceBranch.trim();
    nextSrc = b.length === 0 ? undefined : normalizeGitBranchShortName(b);
  }
  return nextSrc;
}

export function nextPersistedCreateSourceBranchIfMissingAfterPatch(
  previous: Pick<Task, 'createSourceBranchIfMissing'>,
  patch: { createSourceBranchIfMissing?: boolean },
): boolean {
  if (patch.createSourceBranchIfMissing !== undefined) {
    return patch.createSourceBranchIfMissing;
  }
  return persistedCreateSourceBranchIfMissing(previous);
}

export function taskSourceBranchMetadataWouldChange(
  previous: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
  patch: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
): boolean {
  if (patch.sourceBranch === undefined && patch.createSourceBranchIfMissing === undefined) {
    return false;
  }
  const nextSrc = nextPersistedSourceBranchShortAfterPatch(previous, patch);
  const nextCreate = nextPersistedCreateSourceBranchIfMissingAfterPatch(previous, patch);
  const prevSrc = persistedSourceBranchShort(previous);
  const prevCreate = persistedCreateSourceBranchIfMissing(previous);
  return prevSrc !== nextSrc || prevCreate !== nextCreate;
}

function hasAsciiControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Validates a normalized short branch name before persisting (create/update).
 * Mirrors common `git check-ref-format` constraints for a branch-like ref.
 */
export function validateStoredTaskSourceBranchName(
  normalizedShort: string,
): { ok: true } | { ok: false; message: string } {
  const s = normalizedShort.trim();
  if (!s) {
    return { ok: false, message: 'Source branch name is empty after normalization.' };
  }
  if (hasAsciiControlChar(s)) {
    return {
      ok: false,
      message: 'Invalid source branch name: contains ASCII control characters.',
    };
  }
  const disallowed = /[ ~^:?*[\]\\]/;
  if (disallowed.test(s)) {
    return {
      ok: false,
      message:
        'Invalid source branch name: contains disallowed characters (space, ~ ^ : ? * [ \\ ).',
    };
  }
  if (s.includes('..') || s.includes('@{')) {
    return {
      ok: false,
      message: 'Invalid source branch name: cannot contain ".." or "@{".',
    };
  }
  if (s.endsWith('.lock')) {
    return { ok: false, message: 'Invalid source branch name: cannot end with .lock.' };
  }
  if (s.startsWith('/') || s.endsWith('/')) {
    return { ok: false, message: 'Invalid source branch name: cannot start or end with /.' };
  }
  const segments = s.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      return { ok: false, message: 'Invalid source branch name: empty or "." path segment.' };
    }
    if (seg.startsWith('.') || seg.endsWith('.')) {
      return {
        ok: false,
        message: 'Invalid source branch name: path segments cannot start or end with ".".',
      };
    }
    if (seg.endsWith('.lock')) {
      return { ok: false, message: 'Invalid source branch name: segment cannot end with .lock.' };
    }
    if (seg.startsWith('@')) {
      return { ok: false, message: 'Invalid source branch name: segment cannot start with "@".' };
    }
  }
  return { ok: true };
}

/** True when the board should surface a compact branch hint on the card. */
export function taskCardShouldShowSourceBranchChip(
  task: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
  projectDefaultBranchShort: string,
): boolean {
  if (task.createSourceBranchIfMissing === true) {
    return true;
  }
  const def = normalizeGitBranchShortName(projectDefaultBranchShort);
  const raw = (task.sourceBranch ?? '').trim();
  if (!raw) {
    return false;
  }
  return normalizeGitBranchShortName(raw) !== def;
}

/**
 * Best-effort validation for raw branch input in the UI (delegates to
 * {@link validateStoredTaskSourceBranchName} on the normalized short name).
 */
export function gitBranchShortNameLooksValid(raw: string): boolean {
  const s = normalizeGitBranchShortName(raw);
  if (!s) return false;
  return validateStoredTaskSourceBranchName(s).ok;
}

/** Sorted unique short branch names for pickers (includes configured default). */
export function mergeDiscoveryBranchSuggestions(discovery: RepoBranchDiscovery): string[] {
  const set = new Set<string>();
  const add = (raw: string) => {
    const n = normalizeGitBranchShortName(raw);
    if (n.length > 0) set.add(n);
  };
  for (const b of discovery.localBranches) add(b);
  for (const b of discovery.remoteBranches) add(b);
  add(discovery.defaultBranchShort);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export type PlannedTaskSourceBranch = {
  sourceBranch: string;
  createSourceBranchIfMissing: boolean;
};

/**
 * New-task modal → `TaskProvider.create` / IPC: planned branch fields, or raw name only when
 * discovery failed in the UI (main / cloud provider still re-plans from git when possible).
 */
export function buildCreateTaskBranchPayload(
  branchInputRaw: string,
  discovery: RepoBranchDiscovery | null,
): { sourceBranch?: string; createSourceBranchIfMissing?: boolean } | undefined {
  const branchTrim = branchInputRaw.trim();
  if (discovery) {
    const planned = planTaskSourceBranchFieldsForCreate(
      discovery,
      branchTrim === '' ? {} : { sourceBranch: branchInputRaw },
    );
    return {
      sourceBranch: planned.sourceBranch,
      createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
    };
  }
  if (branchTrim !== '') {
    return { sourceBranch: branchTrim };
  }
  return undefined;
}

/**
 * Detail-panel save: strip redundant stored fields when the task matches the default branch
 * that already exists (same effective behavior as legacy rows with no `sourceBranch`).
 */
export function buildTaskSourceBranchPersistPatch(
  planned: PlannedTaskSourceBranch,
  discovery: RepoBranchDiscovery,
): { sourceBranch: string; createSourceBranchIfMissing: boolean } {
  const def = normalizeGitBranchShortName(discovery.defaultBranchShort);
  const sb = normalizeGitBranchShortName(planned.sourceBranch);
  if (sb === def && planned.createSourceBranchIfMissing === false) {
    return { sourceBranch: '', createSourceBranchIfMissing: false };
  }
  return {
    sourceBranch: planned.sourceBranch,
    createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
  };
}

/** True when persisting `planned` would not change stored metadata vs `task`. */
export function taskSourceBranchPersistIsNoOp(
  task: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>,
  planned: PlannedTaskSourceBranch,
  discovery: RepoBranchDiscovery,
): boolean {
  const patch = buildTaskSourceBranchPersistPatch(planned, discovery);
  const clearing =
    patch.sourceBranch.trim() === '' && patch.createSourceBranchIfMissing === false;

  if (clearing) {
    const noStoredBranch = !(task.sourceBranch ?? '').trim();
    const noCreateFlag = task.createSourceBranchIfMissing !== true;
    return noStoredBranch && noCreateFlag;
  }

  const prevSb = (task.sourceBranch ?? '').trim();
  const normalizedPrev = prevSb
    ? normalizeGitBranchShortName(prevSb)
    : normalizeGitBranchShortName(discovery.defaultBranchShort);
  const sameSb =
    normalizedPrev === normalizeGitBranchShortName(patch.sourceBranch.trim());
  const prevCreate = task.createSourceBranchIfMissing === true;
  const sameCreate = patch.createSourceBranchIfMissing === prevCreate;
  return sameSb && sameCreate;
}
