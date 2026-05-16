import type { Task, TaskRequestPullRequestFromAgentPayload } from './types';
import { normalizeGitBranchShortName, validateStoredTaskSourceBranchName } from './taskBranches';

export type ParsedTaskRequestPullRequestFromAgentPayload =
  | { ok: true; payload: TaskRequestPullRequestFromAgentPayload }
  | { ok: false; message: string };

/**
 * Validates/normalizes IPC input for `tasks:requestPullRequestFromAgent`.
 * Rejects clearly invalid `sourceBranch` strings so a hostile renderer cannot inject ref-syntax garbage.
 */
export function parseTaskRequestPullRequestFromAgentPayload(
  raw: unknown,
): ParsedTaskRequestPullRequestFromAgentPayload {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'Invalid payload' };
  }
  const o = raw as Record<string, unknown>;
  const taskId = typeof o.taskId === 'string' ? o.taskId.trim() : '';
  if (!taskId) {
    return { ok: false, message: 'taskId is required' };
  }

  const payload: TaskRequestPullRequestFromAgentPayload = { taskId };

  if (typeof o.title === 'string') {
    const t = o.title.trim();
    if (t) payload.title = t;
  }

  if (typeof o.sourceBranch === 'string' && o.sourceBranch.trim().length > 0) {
    const n = normalizeGitBranchShortName(o.sourceBranch);
    if (!n) {
      return { ok: false, message: 'sourceBranch in payload is empty after normalization.' };
    }
    const v = validateStoredTaskSourceBranchName(n);
    if (!v.ok) {
      return { ok: false, message: v.message };
    }
    payload.sourceBranch = n;
  }

  if (typeof o.repoId === 'string') {
    const r = o.repoId.trim();
    if (r) payload.repoId = r;
  }

  if (typeof o.createSourceBranchIfMissing === 'boolean') {
    payload.createSourceBranchIfMissing = o.createSourceBranchIfMissing;
  }

  return { ok: true, payload };
}

export type MergedTaskAgentPullRequestTaskFields = Pick<
  Task,
  'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId'
>;

/**
 * Local {@link TaskStore} rows win when present; optional IPC fields fill gaps for cloud tasks
 * that main does not mirror locally.
 */
export function mergeTaskRowWithPullRequestAgentPayload(
  taskRow: Task | undefined,
  payload: TaskRequestPullRequestFromAgentPayload,
): MergedTaskAgentPullRequestTaskFields {
  const out: MergedTaskAgentPullRequestTaskFields = {};

  const rowRepo = taskRow?.repoId?.trim();
  const payRepo = payload.repoId?.trim();
  if (rowRepo) {
    out.repoId = rowRepo;
  } else if (payRepo) {
    out.repoId = payRepo;
  }

  const rowSrc = taskRow?.sourceBranch?.trim();
  if (rowSrc) {
    out.sourceBranch = normalizeGitBranchShortName(rowSrc);
  } else if (payload.sourceBranch) {
    out.sourceBranch = payload.sourceBranch;
  }

  if (taskRow !== undefined && taskRow.createSourceBranchIfMissing !== undefined) {
    out.createSourceBranchIfMissing = taskRow.createSourceBranchIfMissing;
  } else if (payload.createSourceBranchIfMissing !== undefined) {
    out.createSourceBranchIfMissing = payload.createSourceBranchIfMissing;
  }

  return out;
}
