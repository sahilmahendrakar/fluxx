import { pickLatestValidationRun } from './display';
import type { ValidationRun } from './types';

const selectedRunByTask = new Map<string, string>();
const subscribersByTask = new Map<string, Set<() => void>>();

export function getStoredValidationRunSelection(taskId: string): string | undefined {
  return selectedRunByTask.get(taskId);
}

export function setStoredValidationRunSelection(taskId: string, runId: string | null): void {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) return;
  if (runId?.trim()) {
    selectedRunByTask.set(trimmedTaskId, runId.trim());
  } else {
    selectedRunByTask.delete(trimmedTaskId);
  }
  subscribersByTask.get(trimmedTaskId)?.forEach((cb) => cb());
}

export function subscribeValidationRunSelection(taskId: string, listener: () => void): () => void {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return () => {
      /* no-op: invalid task id */
    };
  }
  let set = subscribersByTask.get(trimmedTaskId);
  if (!set) {
    set = new Set();
    subscribersByTask.set(trimmedTaskId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) subscribersByTask.delete(trimmedTaskId);
  };
}

export function clearStoredValidationRunSelection(taskId: string): void {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) return;
  selectedRunByTask.delete(trimmedTaskId);
  subscribersByTask.get(trimmedTaskId)?.forEach((cb) => cb());
}

export type ResolveValidationRunSelectionInput = {
  runs: ValidationRun[];
  storedRunId: string | undefined;
  previousRunIds: ReadonlySet<string>;
};

export type ResolveValidationRunSelectionResult = {
  selectedRunId: string | null;
  selectedRun: ValidationRun | null;
};

/**
 * Picks which validation run to show in the UI.
 * Defaults to latest; keeps an explicit user pick; auto-selects when a new run appears.
 */
export function resolveValidationRunSelection(
  input: ResolveValidationRunSelectionInput,
): ResolveValidationRunSelectionResult {
  const latestRun = pickLatestValidationRun(input.runs);
  const runIds = new Set(input.runs.map((run) => run.id));

  if (latestRun && !input.previousRunIds.has(latestRun.id)) {
    return { selectedRunId: latestRun.id, selectedRun: latestRun };
  }

  const storedRunId = input.storedRunId?.trim();
  if (storedRunId && runIds.has(storedRunId)) {
    const selectedRun = input.runs.find((run) => run.id === storedRunId) ?? latestRun;
    return { selectedRunId: selectedRun?.id ?? null, selectedRun };
  }

  return {
    selectedRunId: latestRun?.id ?? null,
    selectedRun: latestRun,
  };
}
