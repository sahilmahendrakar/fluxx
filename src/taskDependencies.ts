import type { Task } from './types';

export function normalizeBlockedByIds(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

/** Tasks that block `task` and are not yet `done` (missing blocker ids are ignored). */
export function getBlockingTasks(task: Task, allTasks: Task[]): Task[] {
  const map = new Map(allTasks.map((t) => [t.id, t]));
  const out: Task[] = [];
  for (const id of task.blockedByTaskIds ?? []) {
    const b = map.get(id);
    if (b && b.status !== 'done') out.push(b);
  }
  return out;
}

export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  return getBlockingTasks(task, allTasks).length > 0;
}

/** When project “auto-start when unblocked” is enabled, clear per-task overrides on blocked work. */
export function taskIdsToClearAutoStartOnUnblockWhenAutomationEnables(allTasks: Task[]): string[] {
  return allTasks
    .filter(
      (t) =>
        t.status !== 'done' &&
        t.autoStartOnUnblock !== undefined &&
        isTaskBlocked(t, allTasks),
    )
    .map((t) => t.id);
}

/** Tasks that list `taskId` as a blocker (dependents), for “Blocks N” indicators. */
export function getBlockedTasks(taskId: string, allTasks: Task[]): Task[] {
  return allTasks.filter((t) => (t.blockedByTaskIds ?? []).includes(taskId));
}

function mergedBlockedByMap(taskId: string, proposed: string[], allTasks: Task[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of allTasks) {
    map.set(t.id, [...(t.blockedByTaskIds ?? [])]);
  }
  map.set(taskId, [...proposed]);
  return map;
}

function canReachThroughBlockers(from: string, target: string, map: Map<string, string[]>): boolean {
  const stack = new Set<string>();
  const visit = (node: string): boolean => {
    if (node === target) return true;
    if (stack.has(node)) return false;
    stack.add(node);
    for (const next of map.get(node) ?? []) {
      if (visit(next)) return true;
    }
    stack.delete(node);
    return false;
  };
  return visit(from);
}

/** True if setting `taskId`’s blockers to `proposedBlockedByIds` would introduce a cycle. */
export function wouldCreateDependencyCycle(
  taskId: string,
  proposedBlockedByIds: string[],
  allTasks: Task[],
): boolean {
  const proposed = normalizeBlockedByIds(proposedBlockedByIds);
  if (proposed.includes(taskId)) return true;
  const map = mergedBlockedByMap(taskId, proposed, allTasks);
  for (const b of proposed) {
    if (canReachThroughBlockers(b, taskId, map)) return true;
  }
  return false;
}

export type ValidateDepsResult =
  | { ok: true; normalized: string[] }
  | { ok: false; message: string };

/**
 * Validates a proposed `blockedByTaskIds` list for `taskId`.
 * @param allowUnknownIds — tolerate stale ids (persisted data); strict mode rejects unknown ids.
 */
export function validateBlockedByTaskIds(
  taskId: string,
  proposed: string[] | undefined,
  allTasks: Task[],
  allowUnknownIds: boolean,
): ValidateDepsResult {
  const normalized = normalizeBlockedByIds(proposed);
  if (normalized.includes(taskId)) {
    return { ok: false, message: 'A task cannot depend on itself.' };
  }
  const known = new Set(allTasks.map((t) => t.id));
  if (!allowUnknownIds) {
    const unknown = normalized.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `Unknown task id(s) in dependencies: ${unknown.join(', ')}`,
      };
    }
  }
  const forCycle = allTasks;
  if (wouldCreateDependencyCycle(taskId, normalized, forCycle)) {
    return { ok: false, message: 'This dependency would create a cycle.' };
  }
  return { ok: true, normalized };
}

export type TaskBlockedInfo = {
  blockerIds: string[];
  blockers: { id: string; title: string }[];
};

export function getTaskBlockedStartInfo(task: Task, allTasks: Task[]): TaskBlockedInfo {
  const blocking = getBlockingTasks(task, allTasks);
  return {
    blockerIds: blocking.map((b) => b.id),
    blockers: blocking.map((b) => ({ id: b.id, title: b.title || '(Untitled)' })),
  };
}
