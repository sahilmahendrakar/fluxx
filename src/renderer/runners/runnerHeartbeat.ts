import type { Session } from '../../types';

/**
 * Cloud runner heartbeats are for Desktop sessions that teammates may observe.
 * Direct SSH sessions are owned by one machine's SSH connection and must not
 * appear as outbound cloud runners.
 */
export function sessionEligibleForRunnerHeartbeat(
  session: Session,
  projectId: string,
): boolean {
  if (session.projectId !== projectId) return false;
  if (session.status !== 'running') return false;
  if (session.deviceKind === 'ssh') return false;
  return true;
}

export function activeTaskIdsForRunnerHeartbeat(
  sessions: Session[],
  projectId: string,
): Set<string> {
  const out = new Set<string>();
  for (const session of sessions) {
    if (!sessionEligibleForRunnerHeartbeat(session, projectId)) continue;
    out.add(session.taskId);
  }
  return out;
}
