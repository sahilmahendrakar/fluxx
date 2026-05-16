/**
 * Planning-agent automation invoked via HTTP (`AutomationHttpServer`) and MCP tools.
 * Keep behavior aligned with the `flux__*` MCP tool implementations in `McpServer.ts`.
 */
import path from 'node:path';
import type { McpBridgeResult, McpRendererBridge } from './McpRendererBridge';
import type {
  McpBridgeMember,
  McpBridgeProjectInfoRepoSummary,
  McpBridgeProjectInfoResult,
  McpBridgeTasksCreatePayload,
  McpBridgeTasksDeletePayload,
  McpBridgeTasksUpdatePayload,
  McpBridgeTasksUpdateResult,
} from '../mcpBridge';
import type { ActiveProjectKey, Agent, RepoBranchDiscoveryResponse, RepoConfig, Task, TaskGithubPr } from '../types';
import {
  classifyGitBranchPresence,
  planTaskSourceBranchFieldsForCreate,
  validateStoredTaskSourceBranchName,
} from '../taskBranches';
import { collectRepoBranchDiscovery } from './repoGit';
import { mergedTaskCreateAgentFields } from '../projectAgentDefaults';
import { isTaskBlocked } from '../taskDependencies';
import {
  resolvePrimaryRepoIdFromList,
  resolveLocalTaskRepoIdForCreate,
  resolveRepoForBranchDiscovery,
} from '../repoIdentity';
import { filterTasksByExcludeStatuses, FLUX_TASK_STATUS_VALUES } from './mcpListTasksFilter';
import type { ProjectStore } from './ProjectStore';
import type { TaskStore } from './TaskStore';
import type { LocalBindingStore } from './LocalBindingStore';
import type { FluxAutomationHttpOp, FluxAutomationInvokeResponse } from './AutomationHttpServer';

export type FluxAutomationResolvedActive =
  | { kind: 'none' }
  | {
      kind: 'local';
      activeKey: ActiveProjectKey;
      project: NonNullable<ReturnType<ProjectStore['get']>>;
      projectDir: string;
    }
  | { kind: 'cloud'; activeKey: ActiveProjectKey; rootPath: string };

export type FluxMcpAutomationHost = {
  resolveActive: () => FluxAutomationResolvedActive;
  getTaskInCurrentProject: (taskId: string) => Task | null;
  notifyTasksChanged: () => void;
  bridge: McpRendererBridge;
  taskStore: TaskStore;
  projectStore: ProjectStore;
  bindingStore: LocalBindingStore;
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
  bridgeFailureToInvoke: (result: Extract<McpBridgeResult<unknown>, { ok: false }>) => FluxAutomationInvokeResponse;
  buildLocalProjectInfoRepoSummaries: (
    repos: RepoConfig[],
  ) => Promise<McpBridgeProjectInfoRepoSummary[]>;
  probeRepoPathStatus: (resolvedRoot: string) => Promise<import('../types').RepoPathStatus>;
};

async function resolveEmailToIdOnHost(
  h: FluxMcpAutomationHost,
  email: string,
  activeKey: ActiveProjectKey,
): Promise<string | FluxAutomationInvokeResponse> {
  const result = await h.bridge.request<McpBridgeMember[]>('members.list', activeKey);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  const normalised = email.toLowerCase();
  const match = result.data.find((m) => m.email.toLowerCase() === normalised);
  if (!match) {
    return { ok: false, error: `No member with email '${email}' found in this project` };
  }
  return match.uid;
}

export async function automationRunListTasks(
  h: FluxMcpAutomationHost,
  input: { excludeStatuses?: (typeof FLUX_TASK_STATUS_VALUES)[number][] },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const tasks = h.taskStore.getAll(active.project.id);
    return { ok: true, data: filterTasksByExcludeStatuses(tasks, input.excludeStatuses) };
  }
  const result = await h.bridge.request<Task[]>('tasks.list', active.activeKey);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: filterTasksByExcludeStatuses(result.data, input.excludeStatuses) };
}

type CreateTaskMcpShape = {
  title: string;
  description?: string;
  agent?: 'claude-code' | 'codex' | 'cursor' | 'none';
  blockedByTaskIds?: string[];
  labels?: string[];
  assigneeEmail?: string;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  agentModel?: string;
  agentYolo?: boolean;
  repoId?: string;
};

export async function automationRunCreateTask(
  h: FluxMcpAutomationHost,
  input: CreateTaskMcpShape,
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
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
          : h.bindingStore.getPrefs(active.activeKey.id).defaultTaskAgent;
  const spawnDefaultsSrc =
    active.kind === 'local' ? active.project : h.bindingStore.getPrefs(active.activeKey.id);
  const modelYolo =
    agent != null
      ? mergedTaskCreateAgentFields(spawnDefaultsSrc, agent, input.agentModel, input.agentYolo)
      : {};
  if (active.kind === 'local') {
    const repos = await h.projectStore.getReposAt(active.projectDir);
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
    let task = await h.taskStore.create({
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
      task = await h.taskStore.update(task.id, {
        description: input.description,
      });
    }
    h.notifyTasksChanged();
    return { ok: true, data: task };
  }
  let assigneeId: string | undefined;
  if (input.assigneeEmail != null) {
    const resolved = await resolveEmailToIdOnHost(h, input.assigneeEmail, active.activeKey);
    if (typeof resolved !== 'string') return resolved;
    assigneeId = resolved;
  }
  const payload: McpBridgeTasksCreatePayload = {
    input: {
      title: input.title,
      agent,
      ...modelYolo,
      ...(input.description != null && input.description !== '' ? { description: input.description } : {}),
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
  const result = await h.bridge.request<Task>('tasks.create', active.activeKey, payload);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: result.data };
}

type UpdateTaskMcpShape = {
  id: string;
  title?: string;
  description?: string;
  status?: 'backlog' | 'in-progress' | 'needs-input' | 'review' | 'done';
  agent?: 'claude-code' | 'codex' | 'cursor' | 'none';
  blockedByTaskIds?: string[];
  labels?: string[];
  autoStartOnUnblock?: boolean;
  assigneeEmail?: string;
  unassignAssignee?: boolean;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  githubPr?: TaskGithubPr | null;
  repoId?: string;
};

export async function automationRunUpdateTask(
  h: FluxMcpAutomationHost,
  input: UpdateTaskMcpShape,
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const existing = h.getTaskInCurrentProject(input.id);
    if (!existing) {
      return { ok: false, error: 'Task not found or not part of the current project' };
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
    const updated = await h.taskActions.updateTask(input.id, patch);
    h.notifyTasksChanged();
    return { ok: true, data: updated };
  }
  let assigneeId: string | null | undefined;
  if (input.assigneeEmail !== undefined && input.unassignAssignee === true) {
    return { ok: false, error: 'Pass either assigneeEmail or unassignAssignee, not both' };
  }
  if (input.unassignAssignee === true) {
    assigneeId = null;
  } else if (input.assigneeEmail !== undefined) {
    const resolved = await resolveEmailToIdOnHost(h, input.assigneeEmail, active.activeKey);
    if (typeof resolved !== 'string') return resolved;
    assigneeId = resolved;
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
  const result = await h.bridge.request<McpBridgeTasksUpdateResult>(
    'tasks.update',
    active.activeKey,
    payload,
  );
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  const { previous, updated } = result.data;
  if (previous) {
    await h.taskActions.autoStartIfTransitionedToInProgress(previous, updated);
  }
  return { ok: true, data: updated };
}

export async function automationRunStartTask(
  h: FluxMcpAutomationHost,
  input: { id: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const existing = h.getTaskInCurrentProject(input.id);
    if (!existing) {
      return { ok: false, error: 'Task not found or not part of the current project' };
    }
    if (existing.agent == null) {
      return {
        ok: false,
        error:
          'This task has no coding agent assigned. Use flux__update_task to set agent before starting.',
      };
    }
    const updated = await h.taskActions.startTask(input.id);
    h.notifyTasksChanged();
    return { ok: true, data: updated };
  }
  const listResult = await h.bridge.request<Task[]>('tasks.list', active.activeKey);
  if (!listResult.ok) return h.bridgeFailureToInvoke(listResult);
  const columnTasks = listResult.data;
  const existing = columnTasks.find((t) => t.id === input.id);
  if (!existing) {
    return { ok: false, error: 'Task not found or not part of the current project' };
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
  const updateResult = await h.bridge.request<McpBridgeTasksUpdateResult>('tasks.update', active.activeKey, {
    taskId: input.id,
    patch: { status: 'in-progress' },
  });
  if (!updateResult.ok) return h.bridgeFailureToInvoke(updateResult);
  const { updated } = updateResult.data;
  await h.taskActions.startSessionForExistingTask(updated);
  return { ok: true, data: updated };
}

export async function automationRunDeleteTask(
  h: FluxMcpAutomationHost,
  input: { id: string; confirm: true },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const existing = h.getTaskInCurrentProject(input.id);
    if (!existing) {
      return { ok: false, error: 'Task not found or not part of the current project' };
    }
    await h.taskStore.delete(input.id);
    h.notifyTasksChanged();
    return { ok: true, data: { ok: true, deletedId: input.id } };
  }
  const payload: McpBridgeTasksDeletePayload = { taskId: input.id };
  const result = await h.bridge.request<{ deletedId: string }>('tasks.delete', active.activeKey, payload);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: { ok: true, deletedId: result.data.deletedId } };
}

export async function automationRunListMembers(h: FluxMcpAutomationHost): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    return {
      ok: true,
      data: {
        members: [] as McpBridgeMember[],
        note: 'Team member listing is only available for cloud projects.',
      },
    };
  }
  const result = await h.bridge.request<McpBridgeMember[]>('members.list', active.activeKey);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: result.data };
}

export async function automationRunProjectInfo(h: FluxMcpAutomationHost): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const tasks = h.taskStore.getAll(active.project.id);
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
    const repos = await h.projectStore.getReposAt(active.projectDir);
    const primaryRepoId = resolvePrimaryRepoIdFromList(repos);
    const primaryRepo =
      (primaryRepoId !== undefined ? repos.find((r) => r.id === primaryRepoId) : undefined) ?? repos[0];
    const primaryRootPath = primaryRepo
      ? path.resolve(primaryRepo.rootPath)
      : path.resolve(active.project.rootPath);
    let defaultBranchShort: string | undefined;
    let branchDiscoveryError: string | undefined;
    if (primaryRepo?.rootPath) {
      try {
        const disc = await collectRepoBranchDiscovery(path.resolve(primaryRepo.rootPath), primaryRepo.baseBranch);
        defaultBranchShort = disc.defaultBranchShort;
      } catch (err) {
        branchDiscoveryError = err instanceof Error ? err.message : String(err);
      }
    }
    const repoSummaries = await h.buildLocalProjectInfoRepoSummaries(repos);
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
  const result = await h.bridge.request<McpBridgeProjectInfoResult>('projectInfo', active.activeKey);
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  const data = result.data;
  return {
    ok: true,
    data: {
      name: data.name,
      rootPath: active.rootPath,
      taskCounts: data.taskCounts,
      ...(data.defaultBranchShort !== undefined ? { defaultBranchShort: data.defaultBranchShort } : {}),
      ...(data.branchDiscoveryError !== undefined ? { branchDiscoveryError: data.branchDiscoveryError } : {}),
      ...(data.primaryRepoId !== undefined ? { primaryRepoId: data.primaryRepoId } : {}),
      ...(data.repos !== undefined ? { repos: data.repos } : {}),
    },
  };
}

export async function automationRunRepoBranches(
  h: FluxMcpAutomationHost,
  input: { repoId?: string; classifyBranch?: string },
): Promise<FluxAutomationInvokeResponse> {
  const active = h.resolveActive();
  if (active.kind === 'none') {
    return { ok: false, error: 'No project open' };
  }
  if (active.kind === 'local') {
    const repos = await h.projectStore.getReposAt(active.projectDir);
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
  const result = await h.bridge.request<RepoBranchDiscoveryResponse>('repo.branchDiscovery', active.activeKey, {
    ...(input.repoId != null && input.repoId.trim() !== '' ? { repoId: input.repoId.trim() } : {}),
    classifyBranch: input.classifyBranch,
  });
  if (!result.ok) return h.bridgeFailureToInvoke(result);
  return { ok: true, data: result.data };
}

export async function runFluxAutomationInvocation(
  h: FluxMcpAutomationHost,
  op: FluxAutomationHttpOp,
  payload: unknown,
): Promise<FluxAutomationInvokeResponse> {
  switch (op) {
    case 'tasks.list':
      return automationRunListTasks(h, (payload ?? {}) as { excludeStatuses?: (typeof FLUX_TASK_STATUS_VALUES)[number][] });
    case 'tasks.create': {
      const flat = (() => {
        if (payload && typeof payload === 'object' && 'input' in payload) {
          return (payload as { input: CreateTaskMcpShape }).input;
        }
        return payload as CreateTaskMcpShape;
      })();
      if (!flat || typeof flat !== 'object' || typeof flat.title !== 'string') {
        return { ok: false, error: 'tasks.create requires { title } or { input: { title } }' };
      }
      return automationRunCreateTask(h, flat);
    }
    case 'tasks.update': {
      const p = payload as Partial<UpdateTaskMcpShape> & { taskId?: string; id?: string };
      const id = p.id ?? p.taskId;
      if (typeof id !== 'string') {
        return { ok: false, error: 'tasks.update requires task id as id or taskId' };
      }
      const { taskId: _dropTaskId, ...rest } = p;
      void _dropTaskId;
      return automationRunUpdateTask(h, { id, ...rest } as UpdateTaskMcpShape);
    }
    case 'tasks.delete': {
      const p = payload as { taskId?: string; id?: string; confirm?: boolean };
      const id = p.id ?? p.taskId;
      if (typeof id !== 'string') {
        return { ok: false, error: 'tasks.delete requires task id as id or taskId' };
      }
      if (p.confirm !== true) {
        return { ok: false, error: 'tasks.delete requires confirm:true' };
      }
      return automationRunDeleteTask(h, { id, confirm: true });
    }
    case 'tasks.start': {
      const p = payload as { id?: string; taskId?: string };
      const id = p.id ?? p.taskId;
      if (typeof id !== 'string') {
        return { ok: false, error: 'tasks.start requires id or taskId' };
      }
      return automationRunStartTask(h, { id });
    }
    case 'members.list':
      return automationRunListMembers(h);
    case 'projectInfo':
      return automationRunProjectInfo(h);
    case 'repo.branchDiscovery':
      return automationRunRepoBranches(h, (payload ?? {}) as { repoId?: string; classifyBranch?: string });
    default:
      return { ok: false, error: `Unknown op: ${String(op)}` };
  }
}
