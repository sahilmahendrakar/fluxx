import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '../types';
import {
  GIT_BRANCH_DISCOVERY_DISABLED_NOTE,
  gitBranchFlagIgnoredNote,
} from '../gitIntegration';
import {
  automationRunCreateTask,
  automationRunRepoBranches,
  type FluxAutomationHost,
  type FluxAutomationResolvedActive,
} from './fluxAutomationRuns';

describe('fluxAutomationRuns gitless CLI', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  function makeHost(options?: { gitIntegrationEnabled?: boolean }): FluxAutomationHost {
    const gitIntegrationEnabled = options?.gitIntegrationEnabled !== false;
    const project: LocalProject = {
      kind: 'local',
      id: 'proj-1',
      name: 'Demo',
      rootPath: tmp,
      addedAt: new Date().toISOString(),
      planningAgent: 'claude-code',
      defaultTaskAgent: 'cursor',
      autoStartSessionOnInProgress: false,
      autoRespondToTrustPrompts: false,
      autoStartWhenUnblocked: false,
      autoCleanupWorkspaceWhenDone: false,
      autoMarkDoneWhenPrMerged: false,
      autoMoveToReviewWhenPrOpen: false,
      persistTerminalsWithTmux: false,
      validationEnabled: false,
      gitIntegrationEnabled,
      gitlessSingleSessionPerFolder: true,
      repos: [{ id: 'r1', rootPath: tmp, baseBranch: 'main' }],
    };
    const active: FluxAutomationResolvedActive = {
      kind: 'local',
      activeKey: { kind: 'local', id: 'proj-1' },
      project,
      projectDir: tmp,
    };
    const taskStore = {
      create: vi.fn(async (input: Record<string, unknown>) => ({
        id: 'task-1',
        title: input.title,
        status: 'backlog',
        agent: input.agent,
        projectId: 'proj-1',
        orderKey: 'a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...input,
      })),
      update: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
        id: 'task-1',
        title: 'T',
        status: 'backlog',
        agent: 'cursor',
        projectId: 'proj-1',
        orderKey: 'a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...patch,
      })),
    };
    return {
      resolveActive: () => active,
      getTaskInCurrentProject: () => null,
      notifyTasksChanged: () => undefined,
      bridge: { request: vi.fn() } as unknown as FluxAutomationHost['bridge'],
      taskStore: taskStore as unknown as FluxAutomationHost['taskStore'],
      projectStore: {
        get: vi.fn(() => project),
        getReposAt: vi.fn(async () => project.repos),
        getGitIntegrationEnabledAt: vi.fn(async () => gitIntegrationEnabled),
      } as unknown as FluxAutomationHost['projectStore'],
      bindingStore: {} as FluxAutomationHost['bindingStore'],
      deviceStore: {
        listDevices: () => [],
        getDevice: () => undefined,
        getGlobalDefaultDeviceId: () => undefined,
      } as unknown as FluxAutomationHost['deviceStore'],
      getActiveProjectKey: () => active.activeKey,
      validationRunStore: {} as FluxAutomationHost['validationRunStore'],
      listTerminalSessions: async () => [],
      getRecordProjectDir: () => tmp,
      taskActions: {} as FluxAutomationHost['taskActions'],
      bridgeFailureToInvoke: (r) => ({ ok: false, error: r.error }),
      buildLocalProjectInfoRepoSummaries: async () => [],
      probeRepoPathStatus: async () => 'valid',
    };
  }

  it('automationRunRepoBranches returns empty discovery with note when git is off', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-gitless-branches-'));
    const host = makeHost({ gitIntegrationEnabled: false });
    const result = await automationRunRepoBranches(host, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        defaultBranchShort: '',
        localBranches: [],
        remoteBranches: [],
      });
      expect(result.stderrNote).toBe(GIT_BRANCH_DISCOVERY_DISABLED_NOTE);
    }
  });

  it('automationRunCreateTask ignores source branch flags with stderr note when git is off', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-gitless-create-'));
    const host = makeHost({ gitIntegrationEnabled: false });
    const result = await automationRunCreateTask(host, {
      title: 'Plain folder task',
      sourceBranch: 'feature/x',
      createSourceBranchIfMissing: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stderrNote).toContain(gitBranchFlagIgnoredNote('--source-branch'));
      expect(result.stderrNote).toContain(
        gitBranchFlagIgnoredNote('--create-source-branch-if-missing'),
      );
    }
    const createMock = host.taskStore.create as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sourceBranch: expect.anything(),
        createSourceBranchIfMissing: expect.anything(),
      }),
    );
  });
});
