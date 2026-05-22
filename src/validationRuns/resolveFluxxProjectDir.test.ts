import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveActiveFluxxProjectDir,
  resolveCanonicalFluxxProjectDir,
} from './resolveFluxxProjectDir';

describe('resolveFluxxProjectDir', () => {
  it('resolveActiveFluxxProjectDir prefers store over worktree', () => {
    expect(resolveActiveFluxxProjectDir('/store', '/worktree')).toBe('/store');
    expect(resolveActiveFluxxProjectDir(null, '/worktree')).toBe('/worktree');
    expect(resolveActiveFluxxProjectDir('', '/worktree')).toBe('/worktree');
    expect(resolveActiveFluxxProjectDir(null, null)).toBeNull();
  });

  it('resolveCanonicalFluxxProjectDir matches nested projects layout', () => {
    const base = path.join(os.homedir(), '.fluxx');
    expect(
      resolveCanonicalFluxxProjectDir(base, {
        kind: 'local',
        id: 'local-id',
        rootPath: '/repos/app',
      }),
    ).toBe(path.join(base, 'projects', 'local-id'));
    expect(
      resolveCanonicalFluxxProjectDir(base, {
        kind: 'cloud',
        id: 'cloud/proj!',
        rootPath: '/binding',
      }),
    ).toBe(path.join(base, 'projects', 'cloud_proj_'));
  });
});
