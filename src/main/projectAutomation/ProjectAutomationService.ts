import fs from 'node:fs/promises';
import path from 'node:path';
import { primaryRootPathFromCloudBinding } from '../../cloudLocalBindingMigration';
import type {
  ActiveProjectKey,
  Agent,
  RepoBranchDiscoveryResponse,
  RepoConfig,
  RepoPathStatus,
  Task,
  TaskGithubPr,
} from '../../types';
import {
  classifyGitBranchPresence,
  planTaskSourceBranchFieldsForCreate,
  validateStoredTaskSourceBranchName,
} from '../../taskBranches';
import { collectRepoBranchDiscovery } from '../repoGit';
import { mergedTaskCreateAgentFields } from '../../projectAgentDefaults';
import type {
  McpBridgeMember,
  McpBridgeProjectInfoRepoSummary,
  McpBridgeProjectInfoResult,
  McpBridgeTasksCreatePayload,
  McpBridgeTasksDeletePayload,
  McpBridgeTasksUpdatePayload,
  McpBridgeTasksUpdateResult,
} from '../../mcpBridge';
import { isTaskBlocked } from '../../taskDependencies';
import {
  repoDisplayLabel,
  resolvePrimaryRepoIdFromList,
  resolveLocalTaskRepoIdForCreate,
  resolveRepoForBranchDiscovery,
} from '../../repoIdentity';
import { filterTasksByExcludeStatuses } from '../mcpListTasksFilter';
import type { TaskStore } from '../TaskStore';
import type { ProjectStore } from '../ProjectStore';
import type { AppStateStore } from '../AppStateStore';
import type { LocalBindingStore } from '../LocalBindingStore';
import type { McpRendererBridge, McpBridgeResult } from '../McpRendererBridge';
import type {
  CreateTaskInput,
  DeleteTaskInput,
  ListMembersLocalPayload,
  ListRepoBranchesInput,
  ListTasksInput,
  ProjectAutomationResult,
  ProjectInfoPayload,
  StartTaskInput,
  UpdateTaskInput,
} from './fluxAutomationContract';

export type ListMembersSuccess = McpBridgeMember[] | ListMembersLocalPayload;

type ActiveResolved =
  | { kind: 'none' }
  | {
      kind: 'local';
      activeKey: ActiveProjectKey;
      project: ReturnType<ProjectStore['get']> & object;
      projectDir: string;
    }
  | { kind: 'cloud'; activeKey: ActiveProjectKey; rootPath: string };

function bridgeFailure<T>(
  result: Extract<McpBridgeResult<T>, { ok: false }>,
): ProjectAutomationResult<never> {
  const friendly = (() => {
    switch (result.code) {
      case 'AUTH_NOT_READY':
        return 'Sign in to Flux to use cloud project tools';
      case 'RENDERER_NOT_READY':
        return 'Open the Flux app to enable cloud project tools';
      case 'RENDERER_TIMEOUT':
        return 'Flux app did not respond in time. Please try again.';
      case 'PROJECT_KIND_MISMATCH':
        return 'Active project changed during request. Please retry.';
      case 'NO_ACTIVE_PROJECT':
        return 'No project open';
      default:
        return result.message;
    }
  })();
  return { ok: false, error: friendly, bridgeCode: result.code };
}

export interface ProjectAutomationTaskActions {
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
}

export interface ProjectAutomationServiceDeps {
  taskStore: TaskStore;
  projectStore: ProjectStore;
  appStateStore: AppStateStore;
  bindingStore: LocalBindingStore;
  bridge: McpRendererBridge;
  onTasksChanged?: () => void;
  taskActions: ProjectAutomationTaskActions;
}

/**
 * Planning-assistant automation (tasks, project info, repos, members) without
 * MCP or HTTP transport. {@link McpServer} delegates here so behavior stays
 * aligned while a `flux` CLI is introduced.
 */
export class ProjectAutomationService {
  constructor(private readonly deps: ProjectAutomationServiceDeps) {}

  private notifyTasksChanged(): void {
    this.deps.onTasksChanged?.();
  }

  private getTaskInCurrentProject(taskId: string): Task | null {
    const project = this.deps.projectStore.get();
    if (!project) {
      return null;
    }
    const task = this.deps.taskStore.getAll(project.id).find((t) => t.id === taskId);
    return task ?? null;
  }

  private resolveActive(): ActiveResolved {
    const activeKey = this.deps.appStateStore.get().activeProjectKey;
    if (!activeKey) return { kind: 'none' };
    if (activeKey.kind === 'local') {
      const project = this.deps.projectStore.get();
      const projectDir = this.deps.projectStore.getProjectDir();
      if (!project || !projectDir) return { kind: 'none' };
      return { kind: 'local', activeKey, project, projectDir };
    }
    const binding = this.deps.bindingStore.get(activeKey.id);
    if (!binding) return { kind: 'none' };
    const rootPath = primaryRootPathFromCloudBinding(activeKey.id, binding);
    if (!rootPath) return { kind: 'none' };
    return { kind: 'cloud', activeKey, rootPath };
  }

  private async resolveEmailToId(
    email: string,
    activeKey: ActiveProjectKey,
  ): Promise<ProjectAutomationResult<string>> {
    const result = await this.deps.bridge.request<McpBridgeMember[]>(
      'members.list',
      activeKey,
    );
    if (!result.ok) return bridgeFailure(result);
    const normalised = email.toLowerCase();
    const match = result.data.find((m) => m.email.toLowerCase() === normalised);
    if (!match) {
      return {
        ok: false,
        error: `No member with email '${email}' found in this project`,
      };
    }
    return { ok: true, data: match.uid };
  }

  private async probeRepoPathStatus(resolvedRoot: string): Promise<RepoPathStatus> {
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

  private async buildLocalProjectInfoRepoSummaries(
    repos: RepoConfig[],
  ): Promise<McpBridgeProjectInfoRepoSummary[]> {
    const primaryId = resolvePrimaryRepoIdFromList(repos);
    const out: McpBridgeProjectInfoRepoSummary[] = [];
    for (const r of repos) {
      const resolvedRoot = path.resolve(r.rootPath);
      const pathStatus = await this.probeRepoPathStatus(resolvedRoot);
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

  async listTasks(input: ListTasksInput): Promise<ProjectAutomationResult<Task[]>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const tasks = this.deps.taskStore.getAll(active.project.id);
      return { ok: true, data: filterTasksByExcludeStatuses(tasks, input.excludeStatuses) };
    }
    const result = await this.deps.bridge.request<Task[]>('tasks.list', active.activeKey);
    if (!result.ok) return bridgeFailure(result);
    return {
      ok: true,
      data: filterTasksByExcludeStatuses(result.data, input.excludeStatuses),
    };
  }

  async createTask(input: CreateTaskInput): Promise<ProjectAutomationResult<Task>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    const agent: Agent | null =
      input.agent === 'none'
        ? null
        : input.agent != null
          ? input.agent
          : active.kind === 'local'
            ? active.project.defaultTaskAgent
            : this.deps.bindingStore.getPrefs(active.activeKey.id).defaultTaskAgent;
    const spawnDefaultsSrc =
      active.kind === 'local' ? active.project : this.deps.bindingStore.getPrefs(active.activeKey.id);
    const modelYolo =
      agent != null
        ? mergedTaskCreateAgentFields(spawnDefaultsSrc, agent, input.agentModel, input.agentYolo)
        : {};
    if (active.kind === 'local') {
      const repos = await this.deps.projectStore.getReposAt(active.projectDir);
      const requestedRepoId = input.repoId;
      const repoResolved = resolveLocalTaskRepoIdForCreate(repos, requestedRepoId);
      if (!repoResolved.ok) {
        return { ok: false, error: repoResolved.message };
      }
      const repo = resolveRepoForBranchDiscovery(repos, repoResolved.repoId);
      if (!repo?.rootPath) {
        return { ok: false, error: 'No repository root configured for this project' };
      }
      const discovery = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
      const planned = planTaskSourceBranchFieldsForCreate(discovery, {
        sourceBranch: input.sourceBranch,
        createSourceBranchIfMissing: input.createSourceBranchIfMissing,
      });
      const branchOk = validateStoredTaskSourceBranchName(planned.sourceBranch);
      if (!branchOk.ok) {
        return { ok: false, error: branchOk.message };
      }
      let task = await this.deps.taskStore.create({
        title: input.title,
        agent,
        projectId: active.project.id,
        repoId: repoResolved.repoId,
        sourceBranch: planned.sourceBranch,
        createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
        ...modelYolo,
        ...(input.blockedByTaskIds?.length ? { blockedByTaskIds: input.blockedByTaskIds } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
      });
      if (input.description != null && input.description !== '') {
        task = await this.deps.taskStore.update(task.id, {
          description: input.description,
        });
      }
      this.notifyTasksChanged();
      return { ok: true, data: task };
    }
    let assigneeId: string | undefined;
    if (input.assigneeEmail != null) {
      const resolved = await this.resolveEmailToId(input.assigneeEmail, active.activeKey);
      if (!resolved.ok) return resolved;
      assigneeId = resolved.data;
    }
    const payload: McpBridgeTasksCreatePayload = {
      input: {
        title: input.title,
        agent,
        ...modelYolo,
        ...(input.description != null && input.description !== ''
          ? { description: input.description }
          : {}),
        ...(input.blockedByTaskIds?.length ? { blockedByTaskIds: input.blockedByTaskIds } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(input.sourceBranch !== undefined ? { sourceBranch: input.sourceBranch } : {}),
        ...(input.createSourceBranchIfMissing !== undefined
          ? { createSourceBranchIfMissing: input.createSourceBranchIfMissing }
          : {}),
        ...(input.repoId !== undefined ? { repoId: input.repoId } : {}),
      },
    };
    const result = await this.deps.bridge.request<Task>(
      'tasks.create',
      active.activeKey,
      payload,
    );
    if (!result.ok) return bridgeFailure(result);
    return { ok: true, data: result.data };
  }

  async updateTask(input: UpdateTaskInput): Promise<ProjectAutomationResult<Task>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const existing = this.getTaskInCurrentProject(input.id);
      if (!existing) {
        return {
          ok: false,
          error: 'Task not found or not part of the current project',
        };
      }
      const patch: Partial<
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
      > & { githubPr?: TaskGithubPr | null } = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.status !== undefined) patch.status = input.status;
      if (input.agent !== undefined) {
        patch.agent = input.agent === 'none' ? null : input.agent;
      }
      if (input.blockedByTaskIds !== undefined) patch.blockedByTaskIds = input.blockedByTaskIds;
      if (input.labels !== undefined) patch.labels = input.labels;
      if (input.autoStartOnUnblock !== undefined) {
        patch.autoStartOnUnblock = input.autoStartOnUnblock;
      }
      if (input.githubPr !== undefined) {
        patch.githubPr = input.githubPr;
      }
      if (input.sourceBranch !== undefined) {
        patch.sourceBranch = input.sourceBranch;
      }
      if (input.createSourceBranchIfMissing !== undefined) {
        patch.createSourceBranchIfMissing = input.createSourceBranchIfMissing;
      }
      if (input.repoId !== undefined) {
        patch.repoId = input.repoId;
      }
      const updated = await this.deps.taskActions.updateTask(input.id, patch);
      this.notifyTasksChanged();
      return { ok: true, data: updated };
    }
    let assigneeId: string | null | undefined;
    if (input.assigneeEmail !== undefined && input.unassignAssignee === true) {
      return {
        ok: false,
        error: 'Pass either assigneeEmail or unassignAssignee, not both',
      };
    }
    if (input.unassignAssignee === true) {
      assigneeId = null;
    } else if (input.assigneeEmail !== undefined) {
      const resolved = await this.resolveEmailToId(input.assigneeEmail, active.activeKey);
      if (!resolved.ok) return resolved;
      assigneeId = resolved.data;
    }
    const patch: Partial<
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
    > & { assigneeId?: string | null; githubPr?: TaskGithubPr | null } = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.agent !== undefined) {
      patch.agent = input.agent === 'none' ? null : input.agent;
    }
    if (input.blockedByTaskIds !== undefined) {
      patch.blockedByTaskIds = input.blockedByTaskIds;
    }
    if (input.labels !== undefined) patch.labels = input.labels;
    if (input.autoStartOnUnblock !== undefined) {
      patch.autoStartOnUnblock = input.autoStartOnUnblock;
    }
    if (input.githubPr !== undefined) {
      patch.githubPr = input.githubPr;
    }
    if (input.sourceBranch !== undefined) {
      patch.sourceBranch = input.sourceBranch;
    }
    if (input.createSourceBranchIfMissing !== undefined) {
      patch.createSourceBranchIfMissing = input.createSourceBranchIfMissing;
    }
    if (input.repoId !== undefined) {
      patch.repoId = input.repoId;
    }
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    const payload: McpBridgeTasksUpdatePayload = { taskId: input.id, patch };
    const result = await this.deps.bridge.request<McpBridgeTasksUpdateResult>(
      'tasks.update',
      active.activeKey,
      payload,
    );
    if (!result.ok) return bridgeFailure(result);
    const { previous, updated } = result.data;
    if (previous) {
      await this.deps.taskActions.autoStartIfTransitionedToInProgress(previous, updated);
    }
    return { ok: true, data: updated };
  }

  async startTask(input: StartTaskInput): Promise<ProjectAutomationResult<Task>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const existing = this.getTaskInCurrentProject(input.id);
      if (!existing) {
        return {
          ok: false,
          error: 'Task not found or not part of the current project',
        };
      }
      if (existing.agent == null) {
        return {
          ok: false,
          error:
            'This task has no coding agent assigned. Use flux__update_task to set agent before starting.',
        };
      }
      const updated = await this.deps.taskActions.startTask(input.id);
      this.notifyTasksChanged();
      return { ok: true, data: updated };
    }
    const listResult = await this.deps.bridge.request<Task[]>('tasks.list', active.activeKey);
    if (!listResult.ok) return bridgeFailure(listResult);
    const columnTasks = listResult.data;
    const existing = columnTasks.find((t) => t.id === input.id);
    if (!existing) {
      return {
        ok: false,
        error: 'Task not found or not part of the current project',
      };
    }
    if (isTaskBlocked(existing, columnTasks)) {
      return {
        ok: false,
        error: 'Task is blocked by incomplete dependencies. Finish blocking tasks first.',
      };
    }
    if (existing.agent == null) {
      return {
        ok: false,
        error:
          'This task has no coding agent assigned. Use flux__update_task to set agent before starting.',
      };
    }
    const updateResult = await this.deps.bridge.request<McpBridgeTasksUpdateResult>(
      'tasks.update',
      active.activeKey,
      { taskId: input.id, patch: { status: 'in-progress' } },
    );
    if (!updateResult.ok) return bridgeFailure(updateResult);
    const { updated } = updateResult.data;
    await this.deps.taskActions.startSessionForExistingTask(updated);
    return { ok: true, data: updated };
  }

  async deleteTask(
    input: DeleteTaskInput,
  ): Promise<ProjectAutomationResult<{ ok: true; deletedId: string }>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const existing = this.getTaskInCurrentProject(input.id);
      if (!existing) {
        return {
          ok: false,
          error: 'Task not found or not part of the current project',
        };
      }
      await this.deps.taskStore.delete(input.id);
      this.notifyTasksChanged();
      return { ok: true, data: { ok: true, deletedId: input.id } };
    }
    const payload: McpBridgeTasksDeletePayload = { taskId: input.id };
    const result = await this.deps.bridge.request<{ deletedId: string }>(
      'tasks.delete',
      active.activeKey,
      payload,
    );
    if (!result.ok) return bridgeFailure(result);
    return { ok: true, data: { ok: true, deletedId: result.data.deletedId } };
  }

  async listMembers(): Promise<ProjectAutomationResult<ListMembersSuccess>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      return {
        ok: true,
        data: {
          members: [],
          note: 'Team member listing is only available for cloud projects.',
        },
      };
    }
    const result = await this.deps.bridge.request<McpBridgeMember[]>(
      'members.list',
      active.activeKey,
    );
    if (!result.ok) return bridgeFailure(result);
    return { ok: true, data: result.data };
  }

  async getProjectInfo(): Promise<ProjectAutomationResult<ProjectInfoPayload>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const tasks = this.deps.taskStore.getAll(active.project.id);
      const taskCounts = {
        backlog: 0,
        'in-progress': 0,
        'needs-input': 0,
        review: 0,
        done: 0,
        total: tasks.length,
      };
      for (const t of tasks) {
        if (t.status === 'backlog') taskCounts.backlog++;
        else if (t.status === 'in-progress') taskCounts['in-progress']++;
        else if (t.status === 'needs-input') taskCounts['needs-input']++;
        else if (t.status === 'review') taskCounts.review++;
        else if (t.status === 'done') taskCounts.done++;
      }
      const repos = await this.deps.projectStore.getReposAt(active.projectDir);
      const primaryRepoId = resolvePrimaryRepoIdFromList(repos);
      const primaryRepo =
        (primaryRepoId !== undefined ? repos.find((r) => r.id === primaryRepoId) : undefined) ??
        repos[0];
      const primaryRootPath = primaryRepo
        ? path.resolve(primaryRepo.rootPath)
        : path.resolve(active.project.rootPath);
      let defaultBranchShort: string | undefined;
      let branchDiscoveryError: string | undefined;
      if (primaryRepo?.rootPath) {
        try {
          const disc = await collectRepoBranchDiscovery(
            path.resolve(primaryRepo.rootPath),
            primaryRepo.baseBranch,
          );
          defaultBranchShort = disc.defaultBranchShort;
        } catch (err) {
          branchDiscoveryError = err instanceof Error ? err.message : String(err);
        }
      }
      const repoSummaries = await this.buildLocalProjectInfoRepoSummaries(repos);
      return {
        ok: true,
        data: {
          name: active.project.name,
          rootPath: primaryRootPath,
          taskCounts,
          ...(defaultBranchShort !== undefined ? { defaultBranchShort } : {}),
          ...(branchDiscoveryError !== undefined ? { branchDiscoveryError } : {}),
          ...(primaryRepoId !== undefined ? { primaryRepoId } : {}),
          repos: repoSummaries,
        },
      };
    }
    const result = await this.deps.bridge.request<McpBridgeProjectInfoResult>(
      'projectInfo',
      active.activeKey,
    );
    if (!result.ok) return bridgeFailure(result);
    const data = result.data;
    return {
      ok: true,
      data: {
        name: data.name,
        rootPath: active.rootPath,
        taskCounts: data.taskCounts,
        ...(data.defaultBranchShort !== undefined ? { defaultBranchShort: data.defaultBranchShort } : {}),
        ...(data.branchDiscoveryError !== undefined
          ? { branchDiscoveryError: data.branchDiscoveryError }
          : {}),
        ...(data.primaryRepoId !== undefined ? { primaryRepoId: data.primaryRepoId } : {}),
        ...(data.repos !== undefined ? { repos: data.repos } : {}),
      },
    };
  }

  async listRepoBranches(
    input: ListRepoBranchesInput,
  ): Promise<ProjectAutomationResult<RepoBranchDiscoveryResponse>> {
    const active = this.resolveActive();
    if (active.kind === 'none') {
      return { ok: false, error: 'No project open' };
    }
    if (active.kind === 'local') {
      const repos = await this.deps.projectStore.getReposAt(active.projectDir);
      const repoIdArg = input.repoId?.trim() || undefined;
      const repo = resolveRepoForBranchDiscovery(repos, repoIdArg);
      if (!repo?.rootPath) {
        return {
          ok: false,
          error:
            input.repoId != null && input.repoId.trim() !== ''
              ? 'Unknown repository id for this project'
              : 'No repository root configured for this project',
        };
      }
      const disc = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
      if (input.classifyBranch != null && input.classifyBranch.trim() !== '') {
        const { normalizedShort, presence } = classifyGitBranchPresence(
          input.classifyBranch,
          disc.localBranches,
          disc.remoteBranches,
        );
        const out: RepoBranchDiscoveryResponse = {
          ...disc,
          classification: {
            raw: input.classifyBranch,
            normalizedShort,
            presence,
          },
        };
        return { ok: true, data: out };
      }
      return { ok: true, data: disc };
    }
    const result = await this.deps.bridge.request<RepoBranchDiscoveryResponse>(
      'repo.branchDiscovery',
      active.activeKey,
      {
        ...(input.repoId != null && input.repoId.trim() !== '' ? { repoId: input.repoId.trim() } : {}),
        classifyBranch: input.classifyBranch,
      },
    );
    if (!result.ok) return bridgeFailure(result);
    return { ok: true, data: result.data };
  }
}
