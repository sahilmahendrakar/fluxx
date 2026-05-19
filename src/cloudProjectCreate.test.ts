import { describe, expect, it } from 'vitest';
import { buildCloudSharedReposAtCreate } from './cloudProjectCreate';
import { deriveStablePrimaryRepoIdForProject } from './repoIdentity';

describe('buildCloudSharedReposAtCreate', () => {
  it('assigns stable ids and primary for multiple repos', () => {
    const projectId = 'cloud-abc';
    const { repos, primaryRepoId } = buildCloudSharedReposAtCreate(
      projectId,
      [
        { rootPath: '/tmp/app', name: 'App' },
        { rootPath: '/tmp/lib', name: 'Lib', baseBranch: 'develop' },
      ],
      '/tmp/lib',
    );
    expect(repos).toHaveLength(2);
    expect(primaryRepoId).toBe(
      deriveStablePrimaryRepoIdForProject({ projectId, rootPath: '/tmp/lib' }),
    );
    expect(repos.find((r) => r.id === primaryRepoId)?.name).toBe('Lib');
    expect(repos.map((r) => r.baseBranch)).toEqual(['main', 'develop']);
  });
});
