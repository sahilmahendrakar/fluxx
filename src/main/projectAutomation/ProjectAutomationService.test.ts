import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ActiveProjectKey, CloudProjectLocalBinding, LocalProject, Task } from '../../types';
import { ProjectAutomationService } from './ProjectAutomationService';
import { collectRepoBranchDiscovery } from '../repoGit';

vi.mock('../repoGit', () => ({
  collectRepoBranchDiscovery: vi.fn(),
}));

const mockedCollect = vi.mocked(collectRepoBranchDiscovery);

function baseLocalProject(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    id: 'proj-local',
    kind: 'local',
    name: 'Local',
    rootPath: '/planning',
    addedAt: '0',
    planningAgent: 'cursor',
    defaultTaskAgent: 'cursor',
    autoStartSessionOnInProgress: false,
    autoRespondToTrustPrompts: false,
    autoStartWhenUnblocked: false,
    autoCleanupWorkspaceWhenDone: false,
    autoMarkDoneWhenPrMerged: false,
    autoMoveToReviewWhenPrOpen: false,
    repos: [],
    ...overrides,
  };
}

function cloudBinding(): CloudProjectLocalBinding {
  return {
    rootPath: '/cloud/primary-clone',
    lastOpenedAt: '2020-01-01T00:00:00.000Z',
  };
}

function makeTask(partial: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: 't',
    status: 'backlog',
    agent: 'cursor',
    createdAt: '0',
    projectId: 'p',
    ...partial,
  };
}

describe('ProjectAutomationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCollect.mockResolvedValue({
      defaultBranchShort: 'main',
      localBranches: ['main'],
      remoteBranches: ['main'],
    });
  });

  it('listTasks returns user error when no project is active', async () => {
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn() } as never,
      projectStore: { get: () => null, getProjectDir: () => null, getReposAt: vi.fn() } as never,
      appStateStore: { get: () => ({ activeProjectKey: null }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.listTasks({});
    expect(r).toEqual({ ok: false, error: 'No project open' });
  });

  it('listMembers for local projects returns an empty roster with a note', async () => {
    const localKey: ActiveProjectKey = { kind: 'local', id: 'proj-local' };
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn() } as never,
      projectStore: {
        get: () => baseLocalProject(),
        getProjectDir: () => '/tmp/projdir',
        getReposAt: vi.fn(),
      } as never,
      appStateStore: { get: () => ({ activeProjectKey: localKey }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.listMembers();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(false);
      expect(r.data).toMatchObject({
        members: [],
        note: expect.stringContaining('cloud'),
      });
    }
  });

  it('listMembers for cloud surfaces renderer bridge failures with a friendly code', async () => {
    const cloudKey: ActiveProjectKey = { kind: 'cloud', id: 'cloud-1' };
    const bridge = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        code: 'RENDERER_TIMEOUT',
        message: 'timeout',
      }),
    };
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn() } as never,
      projectStore: { get: () => null, getProjectDir: () => null, getReposAt: vi.fn() } as never,
      appStateStore: { get: () => ({ activeProjectKey: cloudKey }) } as never,
      bindingStore: {
        get: () => cloudBinding(),
        getPrefs: vi.fn().mockReturnValue({ defaultTaskAgent: 'cursor' }),
      } as never,
      bridge: bridge as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.listMembers();
    expect(r).toEqual({
      ok: false,
      error: 'Flux app did not respond in time. Please try again.',
      bridgeCode: 'RENDERER_TIMEOUT',
    });
  });

  it('createTask rejects an unknown local repo id before git discovery', async () => {
    const localKey: ActiveProjectKey = { kind: 'local', id: 'proj-local' };
    const repos = [
      { id: 'repo-a', rootPath: '/r/a', baseBranch: 'main', name: 'A' },
      { id: 'repo-b', rootPath: '/r/b', baseBranch: 'main', name: 'B' },
    ];
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } as never,
      projectStore: {
        get: () => baseLocalProject({ repos }),
        getProjectDir: () => '/tmp/projdir',
        getReposAt: vi.fn().mockResolvedValue(repos),
      } as never,
      appStateStore: { get: () => ({ activeProjectKey: localKey }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.createTask({ title: 'x', repoId: 'nope' });
    expect(r).toEqual({ ok: false, error: 'Unknown repository id: nope' });
    expect(mockedCollect).not.toHaveBeenCalled();
  });

  it('createTask applies default branch from discovery when sourceBranch is omitted', async () => {
    const localKey: ActiveProjectKey = { kind: 'local', id: 'proj-local' };
    const repos = [{ id: 'repo-a', rootPath: '/r/a', baseBranch: 'develop', name: 'A' }];
    const create = vi.fn().mockImplementation(async (row: Record<string, unknown>) => ({
      id: 'new-task',
      title: row.title,
      status: 'backlog',
      agent: row.agent,
      projectId: row.projectId,
      repoId: row.repoId,
      sourceBranch: row.sourceBranch,
      createSourceBranchIfMissing: row.createSourceBranchIfMissing,
      createdAt: '1',
    }));
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn(), create, update: vi.fn(), delete: vi.fn() } as never,
      projectStore: {
        get: () => baseLocalProject({ repos }),
        getProjectDir: () => '/tmp/projdir',
        getReposAt: vi.fn().mockResolvedValue(repos),
      } as never,
      appStateStore: { get: () => ({ activeProjectKey: localKey }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      onTasksChanged: vi.fn(),
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.createTask({ title: 'Hello' });
    expect(r.ok).toBe(true);
    expect(mockedCollect).toHaveBeenCalledWith('/r/a', 'develop');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBranch: 'main',
        repoId: 'repo-a',
      }),
    );
  });

  it('createTask sets createSourceBranchIfMissing when the requested branch is absent from git lists', async () => {
    const localKey: ActiveProjectKey = { kind: 'local', id: 'proj-local' };
    const repos = [{ id: 'repo-a', rootPath: '/r/a', baseBranch: 'main', name: 'A' }];
    mockedCollect.mockResolvedValueOnce({
      defaultBranchShort: 'main',
      localBranches: ['main'],
      remoteBranches: ['main'],
    });
    const create = vi.fn().mockImplementation(async (row: Record<string, unknown>) => ({
      id: 'new-task',
      title: row.title,
      status: 'backlog',
      agent: row.agent,
      projectId: row.projectId,
      repoId: row.repoId,
      sourceBranch: row.sourceBranch,
      createSourceBranchIfMissing: row.createSourceBranchIfMissing,
      createdAt: '1',
    }));
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn(), create, update: vi.fn(), delete: vi.fn() } as never,
      projectStore: {
        get: () => baseLocalProject({ repos }),
        getProjectDir: () => '/tmp/projdir',
        getReposAt: vi.fn().mockResolvedValue(repos),
      } as never,
      appStateStore: { get: () => ({ activeProjectKey: localKey }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.createTask({ title: 'Branchy', sourceBranch: 'feature-absent' });
    expect(r.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBranch: 'feature-absent',
        createSourceBranchIfMissing: true,
      }),
    );
  });

  it('startTask for cloud refuses blocked tasks without calling tasks.update', async () => {
    const cloudKey: ActiveProjectKey = { kind: 'cloud', id: 'cloud-1' };
    const blocker = makeTask({ id: 'b1', status: 'in-progress', blockedByTaskIds: [] });
    const blocked = makeTask({
      id: 't1',
      status: 'backlog',
      agent: 'cursor',
      blockedByTaskIds: ['b1'],
    });
    const bridge = {
      request: vi.fn().mockResolvedValue({ ok: true, data: [blocker, blocked] }),
    };
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn() } as never,
      projectStore: { get: () => null, getProjectDir: () => null, getReposAt: vi.fn() } as never,
      appStateStore: { get: () => ({ activeProjectKey: cloudKey }) } as never,
      bindingStore: {
        get: () => cloudBinding(),
        getPrefs: vi.fn(),
      } as never,
      bridge: bridge as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.startTask({ id: 't1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('blocked');
    }
    expect(bridge.request).toHaveBeenCalledTimes(1);
    expect(bridge.request).toHaveBeenNthCalledWith(1, 'tasks.list', cloudKey);
  });

  it('listRepoBranches for local returns unknown repo id error', async () => {
    const localKey: ActiveProjectKey = { kind: 'local', id: 'proj-local' };
    const repos = [{ id: 'repo-a', rootPath: '/r/a', baseBranch: 'main', name: 'A' }];
    const svc = new ProjectAutomationService({
      taskStore: { getAll: vi.fn() } as never,
      projectStore: {
        get: () => baseLocalProject({ repos }),
        getProjectDir: () => '/tmp/projdir',
        getReposAt: vi.fn().mockResolvedValue(repos),
      } as never,
      appStateStore: { get: () => ({ activeProjectKey: localKey }) } as never,
      bindingStore: { get: vi.fn(), getPrefs: vi.fn() } as never,
      bridge: { request: vi.fn() } as never,
      taskActions: {
        updateTask: vi.fn(),
        startTask: vi.fn(),
        startSessionForExistingTask: vi.fn(),
        autoStartIfTransitionedToInProgress: vi.fn(),
      },
    });
    const r = await svc.listRepoBranches({ repoId: 'missing-repo' });
    expect(r).toEqual({ ok: false, error: 'Unknown repository id for this project' });
  });
});
