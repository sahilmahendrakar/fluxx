import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cwdUnderTrustPromptAutorespondRoots, trustPromptAutorespondRootsForProject } from './trustPromptAutorespondRoots';

describe('trustPromptAutorespondRoots', () => {
  it('rootsForProject includes worktrees, planning, and ~/.flux/worktrees', () => {
    const roots = trustPromptAutorespondRootsForProject('/tmp/projdir');
    expect(roots).toContain(path.resolve('/tmp/projdir/worktrees'));
    expect(roots).toContain(path.resolve('/tmp/projdir/planning'));
    expect(roots).toContain(path.resolve(path.join(os.homedir(), '.flux', 'worktrees')));
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
});
