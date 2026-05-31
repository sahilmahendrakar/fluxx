import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoConfig, Session } from '../types';
import type { WorktreeService } from './WorktreeService';

const removeLocalSyncedMock = vi.hoisted(() => vi.fn(async () => [] as string[]));

vi.mock('./ssh/remoteSshSyncMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ssh/remoteSshSyncMetadata')>();
  return {
    ...actual,
    removeLocalSyncedWorktreeForTask: removeLocalSyncedMock,
  };
});

import {
  deleteSessionWorkspaceAndStop,
  teardownEphemeralResourcesForTask,
} from './taskEphemeralTeardown';

function sshSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    taskId: 'task-1',
    projectId: 'proj-1',
    repoId: 'repo-a',
    worktreePath: '/home/user/.fluxx/worktrees/repo-a/task-1',
    remotePath: '/home/user/.fluxx/worktrees/repo-a/task-1',
    branch: 'jane/feature',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    deviceKind: 'ssh',
    deviceId: 'ssh-device-1',
    ...overrides,
  };
}

describe('taskEphemeralTeardown', () => {
  beforeEach(() => {
    removeLocalSyncedMock.mockClear();
  });

  it('deleteSessionWorkspaceAndStop cleans remote and local synced worktree for SSH', async () => {
    const session = sshSession();
    const terminalBackend = {
      listSessions: vi.fn(async () => [session]),
      closeShellsForSession: vi.fn(async () => undefined),
      stopSession: vi.fn(async () => undefined),
    };
    const removeTaskWorktree = vi.fn(async () => null);
    const worktreeService = {
      getProjectDir: () => '/local/project',
      remove: vi.fn(),
    } satisfies Pick<WorktreeService, 'getProjectDir' | 'remove'>;
    const repos: RepoConfig[] = [{ id: 'repo-a', rootPath: '/git', baseBranch: 'main' }];
    const deviceStore = {
      getDevice: vi.fn(() => ({
        id: 'ssh-device-1',
        kind: 'ssh' as const,
        enabled: true,
        displayName: 'Dev',
      })),
    };
    const bindingStore = {
      getRemoteRepoBinding: vi.fn(() => undefined),
    };
    const projectStore = {
      get: vi.fn(() => null),
    };

    await deleteSessionWorkspaceAndStop(
      terminalBackend as never,
      worktreeService as WorktreeService,
      session.id,
      async () => '/git',
      {
        deviceStore: deviceStore as never,
        gitRemoteWorkspace: { removeTaskWorktree } as never,
        bindingStore: bindingStore as never,
        projectStore: projectStore as never,
      },
      repos,
    );

    expect(removeTaskWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ssh' }),
      expect.objectContaining({
        projectId: 'proj-1',
        repoId: 'repo-a',
        taskId: 'task-1',
      }),
    );
    expect(removeLocalSyncedMock).toHaveBeenCalledWith(worktreeService, repos, {
      projectDir: '/local/project',
      taskId: 'task-1',
      repoId: 'repo-a',
      fluxxWorkBranch: 'jane/feature',
    });
    expect(worktreeService.remove).not.toHaveBeenCalled();
  });

  it('deleteSessionWorkspaceAndStop does not remove worktree for direct workspace', async () => {
    const session = {
      id: 'sess-direct',
      taskId: 'task-1',
      projectId: 'proj-1',
      repoId: 'repo-a',
      worktreePath: '/Users/me/real-project',
      branch: '',
      workspaceKind: 'direct' as const,
      status: 'running' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const terminalBackend = {
      listSessions: vi.fn(async () => [session]),
      closeShellsForSession: vi.fn(async () => undefined),
      stopSession: vi.fn(async () => undefined),
    };
    const worktreeService = {
      getProjectDir: () => '/local/project',
      remove: vi.fn(),
    } satisfies Pick<WorktreeService, 'getProjectDir' | 'remove'>;

    await deleteSessionWorkspaceAndStop(
      terminalBackend as never,
      worktreeService as WorktreeService,
      session.id,
      async () => '/git',
    );

    expect(worktreeService.remove).not.toHaveBeenCalled();
  });

  it('teardownEphemeralResourcesForTask removes local synced copy when no sessions remain', async () => {
    const terminalBackend = {
      listSessions: vi.fn(async () => []),
    };
    const worktreeService = {
      getProjectDir: () => '/local/project',
      remove: vi.fn(),
    } satisfies Pick<WorktreeService, 'getProjectDir' | 'remove'>;
    const repos: RepoConfig[] = [{ id: 'repo-a', rootPath: '/git', baseBranch: 'main' }];

    const errors = await teardownEphemeralResourcesForTask(
      terminalBackend as never,
      worktreeService as WorktreeService,
      'task-orphan',
      repos,
      'repo-a',
      'jane/feature',
    );

    expect(errors).toEqual([]);
    expect(removeLocalSyncedMock).toHaveBeenCalledWith(worktreeService, repos, {
      projectDir: '/local/project',
      taskId: 'task-orphan',
      repoId: 'repo-a',
      fluxxWorkBranch: 'jane/feature',
    });
  });
});
