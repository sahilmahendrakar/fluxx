import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fluxxBaseDirPath, legacyFluxBaseDirPath } from './fluxxBaseDir';
import { cwdUnderTrustPromptAutorespondRoots, trustPromptAutorespondRootsForProject, trustPromptAutorespondRootsForRemoteWorktree } from './trustPromptAutorespondRoots';

describe('trustPromptAutorespondRoots', () => {
  it('rootsForProject includes worktrees, planning, and ~/.fluxx/worktrees (plus legacy ~/.flux)', () => {
    const roots = trustPromptAutorespondRootsForProject('/tmp/projdir');
    expect(roots).toContain(path.resolve('/tmp/projdir/worktrees'));
    expect(roots).toContain(path.resolve('/tmp/projdir/planning'));
    expect(roots).toContain(path.resolve(path.join(fluxxBaseDirPath(), 'worktrees')));
    expect(roots).toContain(path.resolve(path.join(legacyFluxBaseDirPath(), 'worktrees')));
  });

  it('cwdUnderTrustPromptAutorespondRoots matches exact and nested paths', () => {
    const roots = [path.resolve('/proj/worktrees')];
    expect(cwdUnderTrustPromptAutorespondRoots('/proj/worktrees', roots)).toBe(true);
    expect(cwdUnderTrustPromptAutorespondRoots(path.join('/proj/worktrees', 'rid', 'tid'), roots)).toBe(
      true,
    );
    expect(cwdUnderTrustPromptAutorespondRoots('/other', roots)).toBe(false);
    expect(cwdUnderTrustPromptAutorespondRoots('', [])).toBe(false);
  });

  it('trustPromptAutorespondRootsForRemoteWorktree includes worktree and parent worktrees dir', () => {
    const wt =
      '/home/ec2-user/.fluxx/workspaces/worktrees/hash/repo/task-id';
    const roots = trustPromptAutorespondRootsForRemoteWorktree(wt);
    expect(roots).toContain(wt);
    expect(roots).toContain('/home/ec2-user/.fluxx/workspaces/worktrees');
  });
});
