import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { primaryRootPathFromCloudBinding } from '../cloudLocalBindingMigration';
import type { AutomationBridgeProjectInfoRepoSummary } from '../rendererAutomationBridge';
import type { RepoConfig, RepoPathStatus, Task, TaskGithubPr } from '../types';
import { collectRepoBranchDiscovery } from './repoGit';
import type { AppStateStore } from './AppStateStore';
import { automationBridgeFailureToInvoke } from './automationBridgeFailureMessage';
import type {
  FluxAutomationInvokeBody,
  FluxAutomationInvokeResponse,
} from './AutomationHttpServer';
import { activeProjectKeysEqual } from './activeProjectKey';
import {
  runFluxAutomationInvocation,
  type FluxAutomationHost,
} from './fluxAutomationRuns';
import type { LocalBindingStore } from './LocalBindingStore';
import type { ProjectStore } from './ProjectStore';
import type { RendererAutomationBridge, AutomationBridgeResult } from './RendererAutomationBridge';
import type { TaskStore } from './TaskStore';
import { repoDisplayLabel, resolvePrimaryRepoIdFromList } from '../repoIdentity';

export type FluxAutomationHostDeps = {
  taskStore: TaskStore;
  projectStore: ProjectStore;
  appStateStore: AppStateStore;
  bindingStore: LocalBindingStore;
  bridge: RendererAutomationBridge;
  getMainWindow: () => BrowserWindow | null;
  taskActions: {
    updateTask: (
      id: string,
      patch: Partial<
        Pick<
          Task,
          | 'title'
          | 'description'
          | 'status'
          | 'agent'
          | 'blockedByTaskIds'
          | 'labels'
          | 'autoStartOnUnblock'
          | 'sourceBranch'
          | 'createSourceBranchIfMissing'
          | 'repoId'
        >
      > & { githubPr?: TaskGithubPr | null },
    ) => Promise<Task>;
    startTask: (id: string) => Promise<Task>;
    startSessionForExistingTask: (task: Task) => Promise<void>;
    autoStartIfTransitionedToInProgress: (previous: Task, updated: Task) => Promise<void>;
  };
};

function notifyTasksChanged(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('tasks:changed');
  }
}

function getTaskInCurrentProject(
  taskStore: TaskStore,
  projectStore: ProjectStore,
  taskId: string,
): Task | null {
  const project = projectStore.get();
  if (!project) {
    return null;
  }
  const task = taskStore.getAll(project.id).find((t) => t.id === taskId);
  return task ?? null;
}

function resolveActive(
  appStateStore: AppStateStore,
  projectStore: ProjectStore,
  bindingStore: LocalBindingStore,
): ReturnType<FluxAutomationHost['resolveActive']> {
  const activeKey = appStateStore.get().activeProjectKey;
  if (!activeKey) return { kind: 'none' };
  if (activeKey.kind === 'local') {
    const project = projectStore.get();
    const projectDir = projectStore.getProjectDir();
    if (!project || !projectDir) return { kind: 'none' };
    return { kind: 'local', activeKey, project, projectDir };
  }
  const binding = bindingStore.get(activeKey.id);
  if (!binding) return { kind: 'none' };
  const rootPath = primaryRootPathFromCloudBinding(activeKey.id, binding);
  if (!rootPath) return { kind: 'none' };
  return { kind: 'cloud', activeKey, rootPath };
}

async function probeRepoPathStatus(resolvedRoot: string): Promise<RepoPathStatus> {
  try {
    await fs.access(resolvedRoot);
  } catch {
    return 'missing';
  }
  try {
    await fs.access(path.join(resolvedRoot, '.git'));
    return 'valid';
  } catch {
    return 'not_git';
  }
}

async function buildLocalProjectInfoRepoSummaries(
  repos: RepoConfig[],
): Promise<AutomationBridgeProjectInfoRepoSummary[]> {
  const primaryId = resolvePrimaryRepoIdFromList(repos);
  const out: AutomationBridgeProjectInfoRepoSummary[] = [];
  for (const r of repos) {
    const resolvedRoot = path.resolve(r.rootPath);
    const pathStatus = await probeRepoPathStatus(resolvedRoot);
    let defaultBranchShort: string | undefined;
    if (pathStatus === 'valid') {
      try {
        const disc = await collectRepoBranchDiscovery(resolvedRoot, r.baseBranch);
        defaultBranchShort = disc.defaultBranchShort;
      } catch {
        // omit defaultBranchShort when discovery fails for this clone
      }
    }
    out.push({
      id: r.id,
      label: repoDisplayLabel(r),
      isPrimary: primaryId !== undefined && r.id === primaryId,
      configuredDefaultBranch: r.baseBranch,
      ...(defaultBranchShort !== undefined ? { defaultBranchShort } : {}),
      rootPath: resolvedRoot,
      pathStatus,
    });
  }
  return out;
}

export function createFluxAutomationHost(deps: FluxAutomationHostDeps): FluxAutomationHost {
  return {
    resolveActive: () => resolveActive(deps.appStateStore, deps.projectStore, deps.bindingStore),
    getTaskInCurrentProject: (taskId) =>
      getTaskInCurrentProject(deps.taskStore, deps.projectStore, taskId),
    notifyTasksChanged: () => notifyTasksChanged(deps.getMainWindow),
    bridge: deps.bridge,
    taskStore: deps.taskStore,
    projectStore: deps.projectStore,
    bindingStore: deps.bindingStore,
    taskActions: deps.taskActions,
    bridgeFailureToInvoke: (result: Extract<AutomationBridgeResult<unknown>, { ok: false }>) =>
      automationBridgeFailureToInvoke(result),
    buildLocalProjectInfoRepoSummaries,
    probeRepoPathStatus,
  };
}

export async function invokeFluxAutomationRequest(
  deps: FluxAutomationHostDeps,
  body: FluxAutomationInvokeBody,
): Promise<FluxAutomationInvokeResponse> {
  const current = deps.appStateStore.get().activeProjectKey;
  if (!current) {
    return { ok: false, error: 'No project open', code: 'NO_ACTIVE_PROJECT' };
  }
  if (!activeProjectKeysEqual(current, body.expectedActiveKey)) {
    return {
      ok: false,
      error: 'Active project does not match this planning shell',
      code: 'PROJECT_KIND_MISMATCH',
    };
  }
  return runFluxAutomationInvocation(createFluxAutomationHost(deps), body.op, body.payload);
}
