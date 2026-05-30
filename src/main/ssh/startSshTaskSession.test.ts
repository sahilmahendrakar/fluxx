import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionDeviceConfig,
  LocalProject,
  Session,
  Task,
} from '../../types';

vi.mock('../mcpConfig', () => ({
  ensureProjectMcpConfig: vi.fn(async () => ({
    path: '/tmp/app/mcp.json',
    config: { mcpServers: {} },
  })),
  formatMcpConfig: vi.fn(() => '{}'),
  PROJECT_MCP_CONFIG_BASENAME: 'mcp.json',
}));

vi.mock('../composeTaskSessionInitialPrompt', () => ({
  composeTaskSessionInitialPrompt: vi.fn(async () => 'prompt'),
}));

import { startSshTaskSession } from './startSshTaskSession';
import type { StartSshTaskSessionDeps } from './startSshTaskSession';

function baseProject(): LocalProject {
  return {
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
    gitIntegrationEnabled: false,
    gitlessSingleSessionPerFolder: true,
    repos: [
      {
        id: 'repo-a',
        name: 'App',
        rootPath: '/tmp/app',
        baseBranch: 'main',
      },
    ],
  };
}

function baseTask(): Task {
  return {
    id: 't1',
    title: 'Task',
    status: 'backlog',
    agent: 'cursor',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectId: 'p1',
    repoId: 'repo-a',
    executionDevice: { kind: 'ssh', deviceId: 'devbox' },
  };
}

function sshDevice(): ExecutionDeviceConfig {
  return {
    id: 'devbox',
    kind: 'ssh',
    displayName: 'Devbox',
    enabled: true,
    tmux: { enabled: true },
    ssh: { host: 'devbox.local', user: 'dev' },
  };
}

function mockDeps(overrides: Partial<StartSshTaskSessionDeps> = {}): StartSshTaskSessionDeps {
  const device = sshDevice();
  return {
    deviceStore: {
      getDevice: vi.fn(() => device),
    } as unknown as StartSshTaskSessionDeps['deviceStore'],
    projectStore: {
      getReposAt: vi.fn(async () => baseProject().repos),
    } as unknown as StartSshTaskSessionDeps['projectStore'],
    bindingStore: {} as StartSshTaskSessionDeps['bindingStore'],
    sshTerminalBackend: {
      findRunningByTaskId: vi.fn(() => undefined),
      registerTaskSession: vi.fn(),
    } as unknown as StartSshTaskSessionDeps['sshTerminalBackend'],
    gitRemoteWorkspace: {
      createTaskWorkspaceAndStart: vi.fn(),
    } as unknown as StartSshTaskSessionDeps['gitRemoteWorkspace'],
    directRemoteWorkspace: {
      createTaskWorkspaceAndStart: vi.fn(async () => ({
        ok: true as const,
        session: {
          id: 'sess-1',
          taskId: 't1',
          projectId: 'p1',
          repoId: 'repo-a',
          worktreePath: '/home/dev/project',
          branch: '',
          workspaceKind: 'direct' as const,
          status: 'running' as const,
          startedAt: '2026-05-30T12:00:00.000Z',
          deviceId: 'devbox',
          deviceKind: 'ssh' as const,
          deviceLabel: 'Devbox',
          remotePath: '/home/dev/project',
        },
        tmuxSessionName: 'fluxx-task-p1-sess1',
        manifestRow: { hostLabel: 'Devbox' },
      })),
    } as unknown as StartSshTaskSessionDeps['directRemoteWorkspace'],
    taskAgentSessionRecordStore: {
      recordSessionStart: vi.fn(),
      getResumeConversationId: vi.fn(),
    } as unknown as StartSshTaskSessionDeps['taskAgentSessionRecordStore'],
    terminalSessionRecordStore: {
      recordTerminalStart: vi.fn(),
    } as unknown as StartSshTaskSessionDeps['terminalSessionRecordStore'],
    resolvePlanningDocsDir: () => null,
    activeProjectDir: () => '/tmp/app',
    gitEnabledForProject: vi.fn(async () => false),
    gitlessSingleSessionPerFolderForProject: vi.fn(async () => true),
    listRunningSessions: vi.fn(async () => []),
    ...overrides,
  };
}

describe('startSshTaskSession gitless', () => {
  it('returns REMOTE_FOLDER_REQUIRED when no remote folder is bound', async () => {
    const result = await startSshTaskSession(mockDeps(), {
      task: baseTask(),
      project: baseProject(),
      executionDevice: { kind: 'ssh', deviceId: 'devbox' },
    });
    expect(result).toMatchObject({
      error: 'REMOTE_FOLDER_REQUIRED',
    });
    expect('message' in result && result.message).toContain('Devbox');
  });

  it('starts in the bound folder with workspaceKind direct', async () => {
    const project = {
      ...baseProject(),
      remoteRepoBindings: {
        devbox: {
          'repo-a': {
            remotePath: '/home/dev/project',
            boundAt: '2026-05-30T00:00:00.000Z',
          },
        },
      },
    };
    const directRemoteWorkspace = {
      createTaskWorkspaceAndStart: vi.fn(async () => ({
        ok: true as const,
        session: {
          id: 'sess-1',
          taskId: 't1',
          projectId: 'p1',
          repoId: 'repo-a',
          worktreePath: '/home/dev/project',
          branch: '',
          workspaceKind: 'direct' as const,
          status: 'running' as const,
          startedAt: '2026-05-30T12:00:00.000Z',
          deviceId: 'devbox',
          deviceKind: 'ssh' as const,
          deviceLabel: 'Devbox',
          remotePath: '/home/dev/project',
        },
        tmuxSessionName: 'fluxx-task-p1-sess1',
        manifestRow: { hostLabel: 'Devbox' },
      })),
    };
    const gitRemoteWorkspace = {
      createTaskWorkspaceAndStart: vi.fn(),
    };
    const result = await startSshTaskSession(
      mockDeps({
        directRemoteWorkspace: directRemoteWorkspace as unknown as StartSshTaskSessionDeps['directRemoteWorkspace'],
        gitRemoteWorkspace: gitRemoteWorkspace as unknown as StartSshTaskSessionDeps['gitRemoteWorkspace'],
      }),
      {
        task: baseTask(),
        project,
        executionDevice: { kind: 'ssh', deviceId: 'devbox' },
      },
    );
    expect(gitRemoteWorkspace.createTaskWorkspaceAndStart).not.toHaveBeenCalled();
    expect(directRemoteWorkspace.createTaskWorkspaceAndStart).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: '/home/dev/project',
        repoId: 'repo-a',
      }),
    );
    expect(result).toMatchObject({
      id: 'sess-1',
      workspaceKind: 'direct',
      branch: '',
      worktreePath: '/home/dev/project',
    });
  });

  it('returns WORKSPACE_BUSY when the bound folder is already in use', async () => {
    const project = {
      ...baseProject(),
      remoteRepoBindings: {
        devbox: {
          'repo-a': {
            remotePath: '/home/dev/project',
            boundAt: '2026-05-30T00:00:00.000Z',
          },
        },
      },
    };
    const busySession: Session = {
      id: 'other',
      taskId: 't-other',
      projectId: 'p1',
      worktreePath: '/home/dev/project',
      branch: '',
      workspaceKind: 'direct',
      status: 'running',
      startedAt: '2026-05-30T11:00:00.000Z',
      deviceId: 'devbox',
      deviceKind: 'ssh',
    };
    const result = await startSshTaskSession(
      mockDeps({
        listRunningSessions: vi.fn(async () => [busySession]),
        resolveTaskTitle: () => 'Other task',
      }),
      {
        task: baseTask(),
        project,
        executionDevice: { kind: 'ssh', deviceId: 'devbox' },
      },
    );
    expect(result).toMatchObject({ error: 'WORKSPACE_BUSY' });
  });
});
