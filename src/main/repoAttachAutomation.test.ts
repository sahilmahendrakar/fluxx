import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FluxAutomationHost } from './fluxAutomationRuns';
import { runRepoAttachAutomation } from './repoAttachAutomation';
import { githubCliRepoService } from './githubCliRepoService';

vi.mock('./githubCliRepoService', () => ({
  githubCliRepoService: {
    checkCloneDestination: vi.fn(),
    cloneRepo: vi.fn(),
    createRepo: vi.fn(),
  },
}));

vi.mock('../repoFolderAcceptance', () => ({
  validateRepoFolderForBinding: vi.fn(async (rootPath: string) => ({
    ok: true as const,
    resolved: rootPath,
  })),
}));

function makeLocalHost(overrides?: Partial<FluxAutomationHost>): FluxAutomationHost {
  const projectDir = '/tmp/proj';
  const repos: import('../types').RepoConfig[] = [];
  return {
    resolveActive: () => ({
      kind: 'local',
      activeKey: { kind: 'local', id: 'p1' },
      project: {
        id: 'p1',
        kind: 'local',
        name: 'Demo',
        rootPath: '/tmp/primary',
        repos,
        gitIntegrationEnabled: true,
      } as import('../types').LocalProject,
      projectDir,
    }),
    projectStore: {
      addRepoAt: vi.fn(async (_dir: string, root: string) => {
        const entry = {
          id: 'repo-1',
          rootPath: root,
          baseBranch: 'main',
          name: 'repo-1',
        };
        repos.push(entry);
        return [entry];
      }),
    },
    bridge: { request: vi.fn() },
    bridgeFailureToInvoke: vi.fn(),
    ...overrides,
  } as unknown as FluxAutomationHost;
}

describe('runRepoAttachAutomation', () => {
  beforeEach(() => {
    vi.mocked(githubCliRepoService.checkCloneDestination).mockReset();
    vi.mocked(githubCliRepoService.cloneRepo).mockReset();
    vi.mocked(githubCliRepoService.createRepo).mockReset();
  });

  it('repo.addLocal requires path', async () => {
    const host = makeLocalHost();
    const result = await runRepoAttachAutomation(host, 'repo.addLocal', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
    }
  });

  it('repo.github.add clones then attaches locally', async () => {
    const cloneDir = path.join('/tmp', 'clones', 'acme-demo');
    vi.mocked(githubCliRepoService.checkCloneDestination).mockResolvedValue({
      ok: true,
      available: true,
    });
    vi.mocked(githubCliRepoService.cloneRepo).mockResolvedValue({
      ok: true,
      destination: cloneDir,
      nameWithOwner: 'acme/demo',
    });

    const host = makeLocalHost();
    const result = await runRepoAttachAutomation(host, 'repo.github.add', {
      repo: 'acme/demo',
      cloneDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        repoId: 'repo-1',
        rootPath: cloneDir,
        github: {
          owner: 'acme',
          name: 'demo',
          nameWithOwner: 'acme/demo',
        },
        githubRepoCreated: false,
        newlyAttached: true,
      });
    }
  });

  it('repo.github.createAndAttach returns retryable failure when clone fails after create', async () => {
    const cloneDir = path.join('/tmp', 'clones', 'acme-new');
    vi.mocked(githubCliRepoService.checkCloneDestination).mockResolvedValue({
      ok: true,
      available: true,
    });
    vi.mocked(githubCliRepoService.createRepo).mockResolvedValue({
      ok: true,
      nameWithOwner: 'acme/new',
      url: 'https://github.com/acme/new',
    });
    vi.mocked(githubCliRepoService.cloneRepo).mockResolvedValue({
      ok: false,
      code: 'GH_REPO_CLONE_FAILED',
      message: 'clone failed',
    });

    const host = makeLocalHost();
    const result = await runRepoAttachAutomation(host, 'repo.github.createAndAttach', {
      name: 'new',
      owner: 'acme',
      visibility: 'private',
      cloneDir,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('GH_REPO_CLONE_FAILED');
      expect(result.retryable).toBe(true);
      expect(result.github).toEqual({
        nameWithOwner: 'acme/new',
        url: 'https://github.com/acme/new',
      });
      expect(result.githubRepoCreated).toBe(true);
    }
  });
});
