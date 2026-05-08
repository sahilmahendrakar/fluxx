import { describe, expect, it } from 'vitest';
import {
  deriveRepoIdForRootPath,
  deriveStablePrimaryRepoIdForProject,
  findRepoByIdOrPrimary,
  getPrimaryRepo,
  getPrimaryRepoForProject,
  repoDisplayLabel,
  repoIdBelongsToProject,
  resolvePrimaryRepoId,
} from './repoIdentity';
import type { LocalProject, RepoConfig } from './types';

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    id: overrides.id ?? 'r-primary',
    name: overrides.name,
    rootPath: overrides.rootPath ?? '/abs/repo',
    baseBranch: overrides.baseBranch ?? 'main',
    setupScript: overrides.setupScript,
    env: overrides.env,
  };
}

describe('repoIdentity (multi-repo2)', () => {
  it('derives a deterministic primary repo id from project + rootPath', () => {
    const a = deriveStablePrimaryRepoIdForProject({
      projectId: 'p1',
      rootPath: '/abs/repo',
    });
    const b = deriveStablePrimaryRepoIdForProject({
      projectId: 'p1',
      rootPath: '/abs/repo',
    });
    const c = deriveStablePrimaryRepoIdForProject({
      projectId: 'p1',
      rootPath: '/abs/repo/.',
    });
    expect(a).toBe(b);
    // path.resolve normalizes, so trailing `/.` collapses
    expect(a).toBe(c);
    expect(a).not.toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId: 'p2',
        rootPath: '/abs/repo',
      }),
    );
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives different ids for the primary repo and a sibling repo at a different root', () => {
    const primary = deriveStablePrimaryRepoIdForProject({
      projectId: 'p1',
      rootPath: '/abs/a',
    });
    const sibling = deriveRepoIdForRootPath({
      projectId: 'p1',
      rootPath: '/abs/b',
    });
    expect(primary).not.toBe(sibling);
  });

  it('getPrimaryRepo returns the first repo (or undefined)', () => {
    expect(getPrimaryRepo([])).toBeUndefined();
    const r = makeRepo({ id: 'r1' });
    expect(getPrimaryRepo([r])?.id).toBe('r1');
    const second = makeRepo({ id: 'r2', rootPath: '/abs/r2' });
    expect(getPrimaryRepo([r, second])?.id).toBe('r1');
  });

  it('resolvePrimaryRepoId accepts arrays and project-shaped inputs', () => {
    const repos = [makeRepo({ id: 'r1' })];
    expect(resolvePrimaryRepoId(repos)).toBe('r1');
    const project: Pick<LocalProject, 'repos'> = { repos };
    expect(resolvePrimaryRepoId(project)).toBe('r1');
    expect(resolvePrimaryRepoId([])).toBeUndefined();
  });

  it('getPrimaryRepoForProject returns repos[0]', () => {
    const project: Pick<LocalProject, 'repos'> = {
      repos: [makeRepo({ id: 'r1' }), makeRepo({ id: 'r2', rootPath: '/abs/r2' })],
    };
    expect(getPrimaryRepoForProject(project)?.id).toBe('r1');
  });

  it('repoIdBelongsToProject treats undefined as primary intent', () => {
    const repos = [makeRepo({ id: 'r1' }), makeRepo({ id: 'r2', rootPath: '/abs/r2' })];
    expect(repoIdBelongsToProject(repos, undefined)).toBe(true);
    expect(repoIdBelongsToProject(repos, '')).toBe(true);
    expect(repoIdBelongsToProject(repos, 'r2')).toBe(true);
    expect(repoIdBelongsToProject(repos, 'rx')).toBe(false);
    expect(repoIdBelongsToProject([], undefined)).toBe(false);
  });

  it('findRepoByIdOrPrimary falls back to primary on miss / empty id', () => {
    const repos = [
      makeRepo({ id: 'r1' }),
      makeRepo({ id: 'r2', rootPath: '/abs/r2' }),
    ];
    expect(findRepoByIdOrPrimary(repos, 'r2')?.id).toBe('r2');
    expect(findRepoByIdOrPrimary(repos, undefined)?.id).toBe('r1');
    expect(findRepoByIdOrPrimary(repos, 'missing')?.id).toBe('r1');
  });

  it('repoDisplayLabel prefers name, falls back to basename, then to short id', () => {
    expect(
      repoDisplayLabel({ id: 'abcdef0123', name: 'Web', rootPath: '/abs/repo' }),
    ).toBe('Web');
    expect(repoDisplayLabel({ id: 'abcdef0123', rootPath: '/abs/my-repo' })).toBe(
      'my-repo',
    );
    expect(repoDisplayLabel({ id: 'abcdef0123', rootPath: '/' })).toMatch(
      /^repo:abcdef0/,
    );
  });
});
