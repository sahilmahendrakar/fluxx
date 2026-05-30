import { describe, expect, it } from 'vitest';
import type { LocalProject, Task } from '../../types';
import { resolveRemoteRepoForTaskSession } from './resolveRemoteRepoForTask';

describe('resolveRemoteRepoForTaskSession', () => {
  const baseLocalProject = (): LocalProject => ({
    id: 'p1',
    kind: 'local',
    name: 'App',
    rootPath: '/tmp/app',
    addedAt: '2026-01-01T00:00:00.000Z',
    planningAgent: 'cursor',
    defaultTaskAgent: 'cursor',
    autoStartSessionOnInProgress: false,
    autoRespondToTrustPrompts: false,
    autoStartWhenUnblocked: false,
    autoCleanupWorkspaceWhenDone: false,
    autoMarkDoneWhenPrMerged: false,
    autoMoveToReviewWhenPrOpen: false,
    persistTerminalsWithTmux: false,
    validationEnabled: false,
    gitIntegrationEnabled: true,
    gitlessSingleSessionPerFolder: true,
    repos: [
      {
        id: 'repo-a',
        name: 'App',
        rootPath: '/tmp/app',
        baseBranch: 'main',
      },
    ],
  });

  const baseTask = (): Task => ({
    id: 't1',
    title: 'Task',
    status: 'backlog',
    agent: 'cursor',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectId: 'p1',
    repoId: 'repo-a',
  });

  it('returns origin URL for local projects', async () => {
    const project = baseLocalProject();
    const result = await resolveRemoteRepoForTaskSession(project, baseTask(), project.repos, null, {
      readOriginUrl: async () => 'git@github.com:acme/app.git',
    });
    expect(result.remoteUrl).toBe('git@github.com:acme/app.git');
    expect(result.repoId).toBe('repo-a');
  });

  it('fails clearly when no remote URL is available', async () => {
    const project = baseLocalProject();
    await expect(
      resolveRemoteRepoForTaskSession(project, baseTask(), project.repos, null, {
        readOriginUrl: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_NON_GIT_UNSUPPORTED' });
  });

  it('uses cloud shared remoteUrl when local clone is unbound', async () => {
    const cloudProject = {
      id: 'cloud-1',
      kind: 'cloud' as const,
      name: 'Cloud',
      ownerId: 'u1',
      memberIds: ['u1'],
      createdAt: '2026-01-01T00:00:00.000Z',
      sharedRepos: [
        {
          id: 'repo-a',
          name: 'App',
          baseBranch: 'main',
          remoteUrl: 'https://github.com/acme/app.git',
        },
      ],
      repoMachineBindings: {},
    };
    const result = await resolveRemoteRepoForTaskSession(
      cloudProject,
      {
        ...baseTask(),
        projectId: 'cloud-1',
      },
      [
        {
          id: 'repo-a',
          rootPath: '',
          baseBranch: 'main',
        },
      ],
      cloudProject,
    );
    expect(result.remoteUrl).toBe('https://github.com/acme/app.git');
  });
});
