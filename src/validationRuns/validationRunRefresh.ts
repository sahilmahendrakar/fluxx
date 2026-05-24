type RefreshListener = () => void;

const refreshListenersByTask = new Map<string, Set<RefreshListener>>();

export function requestTaskValidationRunsRefresh(taskId: string): void {
  const trimmed = taskId.trim();
  if (!trimmed) return;
  refreshListenersByTask.get(trimmed)?.forEach((listener) => listener());
}

export function subscribeTaskValidationRunsRefresh(
  taskId: string,
  listener: RefreshListener,
): () => void {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return () => {
      /* no-op: invalid task id */
    };
  }
  let set = refreshListenersByTask.get(trimmed);
  if (!set) {
    set = new Set();
    refreshListenersByTask.set(trimmed, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) refreshListenersByTask.delete(trimmed);
  };
}
