import { describe, expect, it, vi } from 'vitest';
import type { ExecutionDeviceConfig } from '../../types';
import { GitRemoteWorkspaceProvider } from './GitRemoteWorkspaceProvider';
import type { RemoteHelperClient } from './RemoteHelperClient';

const sshDevice: ExecutionDeviceConfig = {
  id: 'dev-1',
  kind: 'ssh',
  displayName: 'Devbox',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tmux: { enabled: true },
  workspaceRoot: '~/.fluxx/workspaces',
  ssh: { host: 'devbox' },
};

function mockHelper(): RemoteHelperClient {
  return {
    ensureInstalled: vi.fn(async () => ({ ok: true as const, version: '0.2.4' })),
    runJsonCommand: vi.fn(async (device, command) => {
      if (command === 'probe-agent') {
        return { ok: true as const, version: '0.2.4', data: { found: true } };
      }
      if (command === 'repo-ensure') {
        return {
          ok: true as const,
          version: '0.2.4',
          data: { repoPath: '/home/user/.fluxx/workspaces/repos/p1/repo-a', action: 'cloned' },
        };
      }
      if (command === 'worktree-create') {
        return {
          ok: true as const,
          version: '0.2.4',
          data: {
            worktreePath: '/home/user/.fluxx/workspaces/worktrees/p1/repo-a/task-1',
            branch: 'dev/task-one',
          },
        };
      }
      if (command === 'start-terminal') {
        return {
          ok: true as const,
          version: '0.2.4',
          data: {
            terminalId: 'term-1',
            tmuxSessionName: 'fluxx-task-p1-abc',
            startedAt: '2026-05-23T12:00:00.000Z',
          },
        };
      }
      if (command === 'list-terminals') {
        return { ok: true as const, version: '0.2.4', data: { terminals: [] } };
      }
      throw new Error(`unexpected command ${command}`);
    }),
  } as unknown as RemoteHelperClient;
}

describe('GitRemoteWorkspaceProvider', () => {
  it('clones repo, creates worktree, starts tmux, and returns session metadata', async () => {
    const helper = mockHelper();
    const provider = new GitRemoteWorkspaceProvider(helper);

    const result = await provider.createTaskWorkspaceAndStart({
      device: sshDevice,
      projectId: 'p1',
      task: {
        id: 'task-1',
        title: 'Task one',
        agent: 'cursor',
      },
      repo: {
        repoId: 'repo-a',
        label: 'App',
        remoteUrl: 'git@github.com:acme/app.git',
        baseBranch: 'main',
      },
      sourceBranchShort: 'main',
      createSourceBranchIfMissing: false,
      command: 'agent',
      args: ['--model', 'auto', 'hello'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.deviceKind).toBe('ssh');
    expect(result.session.deviceId).toBe('dev-1');
    expect(result.session.remotePath).toContain('worktrees/p1/repo-a/task-1');
    expect(result.session.status).toBe('running');
    expect(result.tmuxSessionName).toMatch(/^fluxx-task-/);
    expect(helper.runJsonCommand).toHaveBeenNthCalledWith(
      2,
      sshDevice,
      'repo-ensure',
      expect.objectContaining({
        remoteUrl: 'git@github.com:acme/app.git',
        projectId: 'p1',
        repoId: 'repo-a',
      }),
    );
  });

  it('passes bound repoPath to repo-ensure when provided', async () => {
    const helper = mockHelper();
    const provider = new GitRemoteWorkspaceProvider(helper);

    const result = await provider.createTaskWorkspaceAndStart({
      device: sshDevice,
      projectId: 'p1',
      task: { id: 'task-1', title: 'Task', agent: 'cursor' },
      repo: {
        repoId: 'repo-a',
        label: 'App',
        remoteUrl: 'git@github.com:acme/app.git',
        baseBranch: 'main',
      },
      boundRepoPath: '/home/user/existing-clone',
      sourceBranchShort: 'main',
      createSourceBranchIfMissing: false,
      command: 'agent',
      args: [],
    });

    expect(result.ok).toBe(true);
    expect(helper.runJsonCommand).toHaveBeenNthCalledWith(
      2,
      sshDevice,
      'repo-ensure',
      expect.objectContaining({
        repoPath: '/home/user/existing-clone',
      }),
    );
  });

  it('maps remote repo auth failures', async () => {
    const helper = mockHelper();
    vi.mocked(helper.runJsonCommand).mockImplementation(async (_device, command) => {
      if (command === 'probe-agent') {
        return { ok: true, version: '0.2.4', data: { found: true } };
      }
      if (command === 'repo-ensure') {
        return {
          ok: false,
          code: 'REMOTE_REPO_ACCESS_FAILED',
          message: 'git clone failed: Permission denied (publickey).',
        };
      }
      throw new Error('unexpected');
    });
    const provider = new GitRemoteWorkspaceProvider(helper);
    const result = await provider.createTaskWorkspaceAndStart({
      device: sshDevice,
      projectId: 'p1',
      task: { id: 'task-1', title: 'Task', agent: 'cursor' },
      repo: {
        repoId: 'repo-a',
        label: 'App',
        remoteUrl: 'git@github.com:acme/app.git',
        baseBranch: 'main',
      },
      sourceBranchShort: 'main',
      createSourceBranchIfMissing: false,
      command: 'agent',
      args: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('REMOTE_REPO_ACCESS_FAILED');
    expect(result.message).toContain('Permission denied');
  });

  it('lists remote manifest rows via helper RPC', async () => {
    const helper = mockHelper();
    const provider = new GitRemoteWorkspaceProvider(helper);
    const listed = await provider.listRemoteTerminals(sshDevice);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.terminals).toEqual([]);
    expect(helper.runJsonCommand).toHaveBeenCalledWith(
      sshDevice,
      'list-terminals',
      { deviceId: 'dev-1' },
    );
  });
});
