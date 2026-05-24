import type { RemoteSshSyncPhase, RemoteSshSyncResult } from '../types';

export function remoteSshSyncPhaseHeading(phase: RemoteSshSyncPhase): string {
  switch (phase) {
    case 'remote-status':
      return 'Remote status failed';
    case 'remote-push':
      return 'Remote push failed';
    case 'local-fetch':
      return 'Local fetch failed';
    case 'local-worktree':
      return 'Local worktree failed';
    case 'conflict-check':
      return 'Local conflict';
    case 'complete':
      return 'Sync complete';
    default:
      return 'Sync failed';
  }
}

export function remoteSshSyncFailureDetail(result: Extract<RemoteSshSyncResult, { ok: false }>): string {
  const phase = remoteSshSyncPhaseHeading(result.phase);
  const recovery = result.recovery?.trim();
  if (recovery) {
    return `${phase}: ${result.message} ${recovery}`;
  }
  return `${phase}: ${result.message}`;
}

export function remoteSshSyncSuccessDetail(
  result: Extract<RemoteSshSyncResult, { ok: true }>,
): string {
  return `Synced branch ${result.branch} to ${result.localWorktreePath} (${result.headCommit.slice(0, 7)}).`;
}
