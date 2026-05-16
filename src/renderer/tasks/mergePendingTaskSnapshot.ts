import type { Task } from '../../types';
import { sanitizeTaskAttachedPlanningDocsInput } from '../../taskAttachedPlanningDocs';
import type { TaskPatch } from './TaskProvider';

/** Apply debounced patches onto a server task for optimistic UI (`null` clears optional fields). */
export function mergeServerTaskWithPendingPatch(task: Task, patch: TaskPatch | undefined): Task {
  if (!patch) return task;
  const {
    assigneeId,
    workspaceCleanedAt,
    githubPr,
    sourceBranch,
    createSourceBranchIfMissing,
    autoStartOnUnblock,
    repoId,
    attachedPlanningDocs: patchAttachedPlanningDocs,
    ...rest
  } = patch;
  let next: Task = { ...task, ...rest };
  if (assigneeId !== undefined) {
    if (assigneeId === null || assigneeId === '') {
      next = { ...next };
      delete next.assigneeId;
    } else {
      next = { ...next, assigneeId };
    }
  }
  if (workspaceCleanedAt !== undefined) {
    if (workspaceCleanedAt === null) {
      next = { ...next };
      delete next.workspaceCleanedAt;
    } else {
      next = { ...next, workspaceCleanedAt };
    }
  }
  if (githubPr !== undefined) {
    if (githubPr === null) {
      next = { ...next };
      delete next.githubPr;
    } else {
      next = { ...next, githubPr };
    }
  }
  if (sourceBranch !== undefined) {
    if (typeof sourceBranch === 'string' && sourceBranch.trim() === '') {
      next = { ...next };
      delete next.sourceBranch;
    } else {
      next = { ...next, sourceBranch };
    }
  }
  if (createSourceBranchIfMissing !== undefined) {
    if (createSourceBranchIfMissing) {
      next = { ...next, createSourceBranchIfMissing: true };
    } else {
      next = { ...next };
      delete next.createSourceBranchIfMissing;
    }
  }
  if (autoStartOnUnblock !== undefined) {
    if (autoStartOnUnblock === null) {
      next = { ...next };
      delete next.autoStartOnUnblock;
    } else {
      next = { ...next, autoStartOnUnblock };
    }
  }
  if (repoId !== undefined) {
    if (typeof repoId === 'string' && repoId.trim() === '') {
      next = { ...next };
      delete next.repoId;
    } else {
      next = { ...next, repoId };
    }
  }
  if (patchAttachedPlanningDocs !== undefined) {
    if (patchAttachedPlanningDocs === null) {
      next = { ...next };
      delete next.attachedPlanningDocs;
    } else {
      const s = sanitizeTaskAttachedPlanningDocsInput(patchAttachedPlanningDocs);
      if (s.length > 0) {
        next = { ...next, attachedPlanningDocs: s };
      } else {
        next = { ...next };
        delete next.attachedPlanningDocs;
      }
    }
  }
  return next;
}

/** Server rows can omit optional fields; keep local values unless the server set them. */
export function mergeTaskRowPreserveMissing(local: Task, server: Task): Task {
  return { ...local, ...server };
}

export function mergeServerTaskWithPendingPatchOntoLocal(
  local: Task,
  server: Task,
  patch: TaskPatch | undefined,
): Task {
  return mergeServerTaskWithPendingPatch(mergeTaskRowPreserveMissing(local, server), patch);
}

export type PendingTaskPatchEntry = { patch: TaskPatch };

/** Merge provider snapshot rows with in-flight debounced edits (same semantics as flushUpdate). */
export function applyProviderSnapshotWithPending(
  serverTasks: Task[],
  localTasks: Task[],
  pending: Map<string, PendingTaskPatchEntry>,
): Task[] {
  const localById = new Map(localTasks.map((t) => [t.id, t]));
  return serverTasks.map((server) => {
    const local = localById.get(server.id) ?? server;
    const patch = pending.get(server.id)?.patch;
    return mergeServerTaskWithPendingPatchOntoLocal(local, server, patch);
  });
}
