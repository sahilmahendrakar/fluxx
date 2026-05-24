import { describe, expect, it } from 'vitest';
import {
  remoteSshSyncFailureDetail,
  remoteSshSyncPhaseHeading,
  remoteSshSyncSuccessDetail,
} from './remoteSshSyncUi';

describe('remoteSshSyncUi', () => {
  it('labels sync phases for errors', () => {
    expect(remoteSshSyncPhaseHeading('remote-push')).toBe('Remote push failed');
    expect(remoteSshSyncPhaseHeading('conflict-check')).toBe('Local conflict');
  });

  it('formats failure detail with recovery guidance', () => {
    const detail = remoteSshSyncFailureDetail({
      ok: false,
      phase: 'conflict-check',
      error: 'LOCAL_DIRTY_CONFLICT',
      message: 'Your local task worktree has uncommitted changes.',
      recovery: 'Stash local edits first.',
    });
    expect(detail).toContain('Local conflict');
    expect(detail).toContain('Stash local edits first.');
  });

  it('formats success detail', () => {
    const detail = remoteSshSyncSuccessDetail({
      ok: true,
      phase: 'complete',
      localWorktreePath: '/tmp/worktree',
      branch: 'dev/task',
      headCommit: 'abc1234567890',
      metadata: {
        lastSyncedAt: '2026-05-24T00:00:00.000Z',
        lastSyncedCommit: 'abc1234567890',
        deviceId: 'dev-1',
        remoteBranch: 'dev/task',
        remoteHasUnsyncedChanges: false,
        localWorktreePath: '/tmp/worktree',
      },
    });
    expect(detail).toContain('dev/task');
    expect(detail).toContain('abc1234');
  });
});
