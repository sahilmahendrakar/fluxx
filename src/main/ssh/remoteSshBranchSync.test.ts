import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ExecutionDeviceConfig, Project, Session, Task } from '../../types';
import { WorktreeCreateError } from '../worktreeCreateError';
import type { WorktreeService } from '../WorktreeService';
import type { RemoteHelperClient } from './RemoteHelperClient';
import { syncRemoteSshTaskToLocal } from './remoteSshBranchSync';

vi.mock('./localGitWorktreeChecks', () => ({
  ensureLocalBranchFromOrigin: vi.fn(async () => ({ ok: true })),
  fastForwardWorktreeToOrigin: vi.fn(async () => ({ ok: true, headCommit: 'abc1234deadbeef' })),
  fetchOriginBranch: vi.fn(async () => undefined),
  isGitWorktreeDirty: vi.fn(async () => ({
    dirty: false,
    hasStaged: false,
    hasUnstaged: false,
    hasUntracked: false,
  })),
  pathExistsAsDirectory: vi.fn(async () => false),
  readBranchTrackingState: vi.fn(async () => ({
    localSha: null,
    originSha: 'abc1234deadbeef',
    ahead: 0,
    behind: 0,
    diverged: false,
  })),
}));

vi.mock('./remoteSshSyncMetadata', () => ({
  persistRemoteSshSyncMetadata: vi.fn(async () => undefined),
}));

vi.mock('../repoGit', () => ({
  collectRepoBranchDiscovery: vi.fn(async () => ({
    defaultBranchShort: 'main',
    localBranches: ['main'],
    remoteBranches: ['main'],
  })),
}));

import {
  ensureLocalBranchFromOrigin,
  fastForwardWorktreeToOrigin,
  fetchOriginBranch,
  isGitWorktreeDirty,
  pathExistsAsDirectory,
  readBranchTrackingState,
} from './localGitWorktreeChecks';

const sshDevice: ExecutionDeviceConfig = {
  id: 'dev-ssh',
  kind: 'ssh',
  displayName: 'Devbox',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'devbox' },
};

const project: Project = {
  id: 'proj-1',
  kind: 'local',
  name: 'Demo',
  rootPath: '/tmp/repo',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const task: Task = {
  id: 'task-1',
  projectId: 'proj-1',
  title: 'Remote task',
  status: 'in-progress',
  agent: 'cursor',
  repoId: 'repo-a',
  fluxxWorkBranch: 'dev/remote-task',
  sourceBranch: 'main',
};

const session: Session = {
  id: 'sess-1',
  taskId: 'task-1',
  projectId: 'proj-1',
  repoId: 'repo-a',
  worktreePath: '/home/user/.fluxx/workspaces/worktrees/proj-1/repo-a/task-1',
  remotePath: '/home/user/.fluxx/workspaces/worktrees/proj-1/repo-a/task-1',
  branch: 'dev/remote-task',
  status: 'running',
  startedAt: '2026-05-24T00:00:00.000Z',
  deviceId: 'dev-ssh',
  deviceKind: 'ssh',
  deviceLabel: 'Devbox',
};

function baseDeps(overrides: {
  helper?: Partial<RemoteHelperClient>;
  worktreeService?: Partial<WorktreeService>;
  resolveRepo?: () => Promise<{ id: string; rootPath: string; baseBranch: string }>;
  getDevice?: (id: string) => ExecutionDeviceConfig | null;
}) {
  const helper = {
    ensureInstalled: vi.fn(async () => ({ ok: true as const, version: '0.2.4' })),
    runJsonCommand: vi.fn(async (_device, command) => {
      if (command === 'git-sync-status') {
        return {
          ok: true as const,
          version: '0.2.4',
          data: {
            worktreePath: session.remotePath!,
            currentBranch: 'dev/remote-task',
            fluxxWorkBranch: 'dev/remote-task',
            headCommit: 'abc1234deadbeef',
            isDirty: false,
            dirtyDetails: {
              isDirty: false,
              hasStaged: false,
              hasUnstaged: false,
              hasUntracked: false,
            },
            aheadOfOrigin: 0,
            behindOrigin: 0,
            originConfigured: true,
            remoteHasUnsyncedChanges: false,
            dirtySnapshotHooks: {
              baseCommit: 'abc1234deadbeef',
              binaryDiffCommand: 'git diff --binary',
              untrackedArchiveSupported: true,
              conflictSafeApplyPlanned: true,
            },
          },
        };
      }
      if (command === 'push-work-branch') {
        return {
          ok: true as const,
          version: '0.2.4',
          data: {
            branch: 'dev/remote-task',
            pushed: true,
            headCommit: 'abc1234deadbeef',
          },
        };
      }
      throw new Error(`unexpected ${command}`);
    }),
    ...overrides.helper,
  } as unknown as RemoteHelperClient;

  const worktreeService = {
    setProjectDir: vi.fn(),
    setRootPath: vi.fn(),
    create: vi.fn(async () => ({
      worktreePath: path.join('/tmp/proj/worktrees/repo-a/dev/remote-task'),
      branch: 'dev/remote-task',
    })),
    ...overrides.worktreeService,
  } as unknown as WorktreeService;

  return {
    deviceStore: {
      getDevice: vi.fn((id: string) =>
        overrides.getDevice ? overrides.getDevice(id) : id === 'dev-ssh' ? sshDevice : null,
      ),
    },
    helper,
    worktreeService,
    resolveRepoConfigForTaskSession: vi.fn(
      overrides.resolveRepo ??
        (async () => ({
          id: 'repo-a',
          rootPath: '/tmp/repo',
          baseBranch: 'main',
          name: 'App',
        })),
    ),
    activeProjectDir: () => '/tmp/proj',
  };
}

describe('syncRemoteSshTaskToLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExistsAsDirectory).mockResolvedValue(false);
    vi.mocked(isGitWorktreeDirty).mockResolvedValue({
      dirty: false,
      hasStaged: false,
      hasUnstaged: false,
      hasUntracked: false,
    });
    vi.mocked(readBranchTrackingState).mockResolvedValue({
      localSha: null,
      originSha: 'abc1234deadbeef',
      ahead: 0,
      behind: 0,
      diverged: false,
    });
  });

  it('completes a clean branch sync', async () => {
    const deps = baseDeps({});
    const result = await syncRemoteSshTaskToLocal(deps, { session, task, project });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.phase).toBe('complete');
    expect(result.branch).toBe('dev/remote-task');
    expect(fetchOriginBranch).toHaveBeenCalledWith('/tmp/repo', 'dev/remote-task');
    expect(ensureLocalBranchFromOrigin).toHaveBeenCalled();
    expect(fastForwardWorktreeToOrigin).toHaveBeenCalled();
  });

  it('blocks when local repo binding is missing', async () => {
    const deps = baseDeps({
      resolveRepo: async () => {
        throw new WorktreeCreateError(
          'WORKTREE_REPO_NOT_BOUND',
          'This machine has no local clone bound for repository "App".',
        );
      },
    });
    const result = await syncRemoteSshTaskToLocal(deps, { session, task, project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('local-fetch');
    expect(result.error).toBe('LOCAL_REPO_NOT_BOUND');
  });

  it('blocks when local worktree is dirty', async () => {
    vi.mocked(pathExistsAsDirectory).mockResolvedValue(true);
    vi.mocked(isGitWorktreeDirty).mockResolvedValue({
      dirty: true,
      hasStaged: false,
      hasUnstaged: true,
      hasUntracked: false,
    });
    const result = await syncRemoteSshTaskToLocal(baseDeps({}), { session, task, project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('conflict-check');
    expect(result.error).toBe('LOCAL_DIRTY_CONFLICT');
  });

  it('surfaces remote push failures', async () => {
    const deps = baseDeps({
      helper: {
        runJsonCommand: vi.fn(async (_d, command) => {
          if (command === 'git-sync-status') {
            return {
              ok: true,
              version: '0.2.4',
              data: {
                worktreePath: session.remotePath!,
                currentBranch: 'dev/remote-task',
                fluxxWorkBranch: 'dev/remote-task',
                headCommit: 'abc',
                isDirty: false,
                dirtyDetails: {
                  isDirty: false,
                  hasStaged: false,
                  hasUnstaged: false,
                  hasUntracked: false,
                },
                aheadOfOrigin: 1,
                behindOrigin: 0,
                originConfigured: true,
                remoteHasUnsyncedChanges: true,
                dirtySnapshotHooks: {
                  baseCommit: 'abc',
                  binaryDiffCommand: 'git diff --binary',
                  untrackedArchiveSupported: true,
                  conflictSafeApplyPlanned: true,
                },
              },
            };
          }
          return {
            ok: false,
            code: 'REMOTE_PUSH_FAILED',
            message: 'git push origin dev/remote-task failed',
          };
        }),
      },
    });
    const result = await syncRemoteSshTaskToLocal(deps, { session, task, project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('remote-push');
    expect(result.error).toBe('REMOTE_PUSH_FAILED');
  });

  it('surfaces local fetch failures when origin branch is missing', async () => {
    vi.mocked(ensureLocalBranchFromOrigin).mockResolvedValue({
      ok: false,
      message: 'origin/dev/remote-task is not available after fetch.',
    });
    const result = await syncRemoteSshTaskToLocal(baseDeps({}), { session, task, project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('local-worktree');
    expect(result.error).toBe('LOCAL_FETCH_FAILED');
  });

  it('blocks when local branch has diverged', async () => {
    vi.mocked(pathExistsAsDirectory).mockResolvedValue(true);
    vi.mocked(readBranchTrackingState).mockResolvedValue({
      localSha: 'local111',
      originSha: 'origin222',
      ahead: 2,
      behind: 1,
      diverged: true,
    });
    const result = await syncRemoteSshTaskToLocal(baseDeps({}), { session, task, project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('conflict-check');
    expect(result.error).toBe('LOCAL_BRANCH_DIVERGED');
  });
});
