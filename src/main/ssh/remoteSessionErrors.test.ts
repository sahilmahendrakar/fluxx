import { describe, expect, it } from 'vitest';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';

describe('mapRemoteHelperCodeToSessionStart', () => {
  it('maps remote repo access failures', () => {
    expect(mapRemoteHelperCodeToSessionStart('REMOTE_REPO_ACCESS_FAILED')).toBe(
      'REMOTE_REPO_ACCESS_FAILED',
    );
  });

  it('maps repo mismatch to remote repo access failed', () => {
    expect(mapRemoteHelperCodeToSessionStart('REMOTE_REPO_MISMATCH')).toBe(
      'REMOTE_REPO_ACCESS_FAILED',
    );
  });

  it('maps non-git unsupported', () => {
    expect(mapRemoteHelperCodeToSessionStart('REMOTE_NON_GIT_UNSUPPORTED')).toBe(
      'REMOTE_NON_GIT_UNSUPPORTED',
    );
  });

  it('maps worktree branch failures', () => {
    expect(mapRemoteHelperCodeToSessionStart('WORKTREE_SOURCE_BRANCH_MISSING')).toBe(
      'WORKTREE_SOURCE_BRANCH_MISSING',
    );
  });

  it('falls back to internal for unknown codes', () => {
    expect(mapRemoteHelperCodeToSessionStart('SOMETHING_NEW')).toBe('INTERNAL');
  });
});
