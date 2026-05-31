import { describe, expect, it } from 'vitest';
import type { CloudProjectLocalBinding, CloudSharedRepo } from './types';
import { repoConfigsFromCloudSharedAndBinding } from './cloudRepoDiskSync';

describe('repoConfigsFromCloudSharedAndBinding', () => {
  const pid = 'cloud-proj';

  it('orders primary repo first when two shared repos are bound', () => {
    const shared: CloudSharedRepo[] = [
      { id: 'r-b', name: 'B', baseBranch: 'develop' },
      { id: 'r-a', name: 'A', baseBranch: 'main' },
    ];
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: '2020-01-01T00:00:00.000Z',
      primaryRepoId: 'r-a',
      repoBindings: {
        'r-a': { rootPath: '/w/a', lastOpenedAt: '2020-01-01T00:00:00.000Z' },
        'r-b': { rootPath: '/w/b', lastOpenedAt: '2020-01-01T00:00:00.000Z' },
      },
    };
    const out = repoConfigsFromCloudSharedAndBinding(pid, shared, binding);
    expect(out).not.toBeNull();
    expect(out!.repos[0].id).toBe('r-a');
    expect(out!.repos.map((r) => r.id)).toEqual(['r-a', 'r-b']);
  });

  it('returns null when no repo has a machine path', () => {
    const shared: CloudSharedRepo[] = [{ id: 'r-x', name: 'X', baseBranch: 'main' }];
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: '2020-01-01T00:00:00.000Z',
      repoBindings: {},
    };
    expect(repoConfigsFromCloudSharedAndBinding(pid, shared, binding)).toBeNull();
  });

  it('merges env file metadata from localBindings without secret bodies', () => {
    const shared: CloudSharedRepo[] = [{ id: 'r-a', name: 'A', baseBranch: 'main' }];
    const binding: CloudProjectLocalBinding = {
      lastOpenedAt: '2020-01-01T00:00:00.000Z',
      repoBindings: {
        'r-a': {
          rootPath: '/w/a',
          lastOpenedAt: '2020-01-01T00:00:00.000Z',
          envFiles: {
            lastDetectedAt: '2026-05-30T00:00:00.000Z',
            sources: [
              { fileName: '.env', enablement: 'enabled' },
              { fileName: '.env.local', enablement: 'enabled' },
            ],
          },
        },
      },
    };
    const out = repoConfigsFromCloudSharedAndBinding(pid, shared, binding);
    expect(out!.repos[0].envFiles).toEqual({
      lastDetectedAt: '2026-05-30T00:00:00.000Z',
      sources: [
        { fileName: '.env', enablement: 'enabled' },
        { fileName: '.env.local', enablement: 'enabled' },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/SECRET=|API_KEY=/);
  });
});
