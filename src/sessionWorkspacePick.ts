import type { Session } from './types';

/**
 * Picks the daemon session to open as the main-window task workspace tab.
 * Multiple rows for the same task are rare; prefer running, then idle/error, then stopped,
 * then newest `startedAt` within the same priority band.
 */
export function selectSessionForTaskWorkspace(
  sessions: readonly Session[],
  taskId: string,
): Session | undefined {
  const list = sessions.filter((s) => s.taskId === taskId);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];

  const priority = (s: Session) => {
    if (s.status === 'running') return 3;
    if (s.status === 'idle') return 2;
    if (s.status === 'error') return 1;
    return 0;
  };

  return [...list].sort((a, b) => {
    const d = priority(b) - priority(a);
    if (d !== 0) return d;
    return b.startedAt.localeCompare(a.startedAt);
  })[0];
}
