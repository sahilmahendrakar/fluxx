/**
 * Task **source** branch (see `Task.sourceBranch`) vs the generated Flux work
 * branch on `Session.branch` (`flux/task-<id>`). Helpers normalize user/MCP
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
 * Best-effort validation for a single git branch segment (short name).
 * Matches common `git check-ref-format --branch` constraints closely enough for UI gating.
 */
export function gitBranchShortNameLooksValid(raw: string): boolean {
  const s = normalizeGitBranchShortName(raw);
  if (!s) return false;
  if (s === '.' || s === '..') return false;
  if (s.startsWith('/')) return false;
  if (s.includes('..')) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
    const ch = s.charAt(i);
    if (' ~^:?*[]\\'.includes(ch)) return false;
  }
  if (s.includes('@{')) return false;
  if (s.endsWith('.') || s.endsWith('/')) return false;
  if (s.endsWith('.lock')) return false;
  if (s === '@') return false;
  if (s.startsWith('.')) return false;
  return true;
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
