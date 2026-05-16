/* eslint-disable import/no-unresolved -- MCP SDK subpath exports */
import { McpServer as BaseMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
/* eslint-enable import/no-unresolved */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { TaskStore } from './TaskStore';
import type { ProjectStore } from './ProjectStore';
import type { AppStateStore } from './AppStateStore';
import { primaryRootPathFromCloudBinding } from '../cloudLocalBindingMigration';
import type { LocalBindingStore } from './LocalBindingStore';
import type { McpRendererBridge, McpBridgeResult } from './McpRendererBridge';
import type { ActiveProjectKey, RepoBranchDiscoveryResponse, RepoConfig, RepoPathStatus, Task, TaskGithubPr } from '../types';
import {
  classifyGitBranchPresence,
  planTaskSourceBranchFieldsForCreate,
  validateStoredTaskSourceBranchName,
} from '../taskBranches';
import { collectRepoBranchDiscovery } from './repoGit';
import { mergedTaskCreateAgentFields } from '../projectAgentDefaults';
import type {
  McpBridgeMember,
  McpBridgeProjectInfoRepoSummary,
  McpBridgeProjectInfoResult,
  McpBridgeTasksCreatePayload,
  McpBridgeTasksDeletePayload,
  McpBridgeTasksUpdatePayload,
  McpBridgeTasksUpdateResult,
} from '../mcpBridge';
import { isTaskBlocked } from '../taskDependencies';
import {
  repoDisplayLabel,
  resolvePrimaryRepoIdFromList,
  resolveLocalTaskRepoIdForCreate,
  resolveRepoForBranchDiscovery,
} from '../repoIdentity';
import { filterTasksByExcludeStatuses, FLUX_TASK_STATUS_VALUES } from './mcpListTasksFilter';

const MCP_PORT = 47432;

interface ActiveMcpSession {
  server: BaseMcpServer;
  transport: SSEServerTransport;
  createdAt: number;
}

function jsonToolPayload(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(err: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const message = err instanceof Error ? err.message : String(err);
  return jsonToolPayload({ error: message });
}

export class McpServer {
  private server: http.Server | null = null;
  private activeSessions = new Map<string, ActiveMcpSession>();

  constructor(
    private taskStore: TaskStore,
    private projectStore: ProjectStore,
    private appStateStore: AppStateStore,
    private bindingStore: LocalBindingStore,
    private bridge: McpRendererBridge,
    private getMainWindow: () => BrowserWindow | null,
    private taskActions: {
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
      autoStartIfTransitionedToInProgress: (
        previous: Task,
        updated: Task,
      ) => Promise<void>;
    },
  ) {}

  private createSdkServer(): BaseMcpServer {
    const server = new BaseMcpServer(
      { name: 'flux', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.registerTools(server);
    return server;
  }

  private notifyTasksChanged(): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('tasks:changed');
    }
  }

  /** Task belonging to the currently open local project, or null if missing / wrong project. */
  private getTaskInCurrentProject(taskId: string): Task | null {
    const project = this.projectStore.get();
    if (!project) {
      return null;
    }
    const task = this.taskStore.getAll(project.id).find((t) => t.id === taskId);
    return task ?? null;
  }

  /**
   * Resolve the currently-active project for an MCP tool call. Returns
   * `local` with concrete handles when a local project is open, `cloud` with
   * the active key + rootPath for cloud projects (data lives in Firestore via
   * the renderer bridge), or `none` when no project is open.
   */
  private resolveActive():
    | { kind: 'none' }
    | {
        kind: 'local';
        activeKey: ActiveProjectKey;
        project: ReturnType<ProjectStore['get']> & object;
        projectDir: string;
      }
    | { kind: 'cloud'; activeKey: ActiveProjectKey; rootPath: string } {
    const activeKey = this.appStateStore.get().activeProjectKey;
    if (!activeKey) return { kind: 'none' };
    if (activeKey.kind === 'local') {
      const project = this.projectStore.get();
      const projectDir = this.projectStore.getProjectDir();
      if (!project || !projectDir) return { kind: 'none' };
      return { kind: 'local', activeKey, project, projectDir };
    }
    const binding = this.bindingStore.get(activeKey.id);
    if (!binding) return { kind: 'none' };
    const rootPath = primaryRootPathFromCloudBinding(activeKey.id, binding);
    if (!rootPath) return { kind: 'none' };
    return { kind: 'cloud', activeKey, rootPath };
  }

  /** Translate a bridge error into the MCP tool error envelope. */
  private bridgeError(
    result: Extract<McpBridgeResult<unknown>, { ok: false }>,
  ): ReturnType<typeof jsonToolPayload> {
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
    return jsonToolPayload({ error: friendly, code: result.code });
  }

  /**
   * Resolve an email address to a member UID by requesting the members list
   * from the renderer. Returns the UID string on success, or a tool error
   * payload if the email is not found or the bridge call fails.
   */
  private async resolveEmailToId(
    email: string,
    activeKey: ActiveProjectKey,
  ): Promise<string | ReturnType<typeof jsonToolPayload>> {
    const result = await this.bridge.request<McpBridgeMember[]>(
      'members.list',
      activeKey,
    );
    if (!result.ok) return this.bridgeError(result);
    const normalised = email.toLowerCase();
    const match = result.data.find((m) => m.email.toLowerCase() === normalised);
    if (!match) {
      return jsonToolPayload({
        error: `No member with email '${email}' found in this project`,
      });
    }
    return match.uid;
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

  private registerTools(server: BaseMcpServer): void {
    server.tool(
      'flux__list_tasks',
      'List tasks on the Flux board for the current project. By default returns every task. Optional excludeStatuses removes tasks in those columns (values: backlog, in-progress, needs-input, done)—e.g. pass ["done"] to omit completed work and shrink the payload. Filtering runs in the desktop app after tasks load so local and cloud projects behave the same.',
      {
        excludeStatuses: z
          .array(z.enum(FLUX_TASK_STATUS_VALUES))
          .optional()
          .describe(
            'Statuses to omit from the result. Each value is a board column id. Omit this field for the full board.',
          ),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const tasks = this.taskStore.getAll(active.project.id);
            return jsonToolPayload(filterTasksByExcludeStatuses(tasks, input.excludeStatuses));
          }
          const result = await this.bridge.request<Task[]>(
            'tasks.list',
            active.activeKey,
          );
          if (!result.ok) return this.bridgeError(result);
          return jsonToolPayload(
            filterTasksByExcludeStatuses(result.data, input.excludeStatuses),
          );
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__create_task',
      'Create a new task on the Flux board for the current project. When the multi-repo2 feature is enabled and the project lists several repositories in flux__get_project_info, pass repoId to attach the task to a specific repo (string id from repos[].id); omit repoId to use the primary repository.',
      {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        agent: z
          .enum(['claude-code', 'codex', 'cursor'])
          .optional()
          .describe('Agent to use. Defaults to claude-code'),
        blockedByTaskIds: z
          .array(z.string())
          .optional()
          .describe('Task ids this task is blocked by (must exist and same project)'),
        labels: z
          .array(z.string())
          .optional()
          .describe(
            'Optional feature tags / labels; trimmed, empty dropped, case-insensitive duplicates merged',
          ),
        assigneeEmail: z
          .string()
          .email()
          .optional()
          .describe('Email of the team member to assign this task to (cloud projects only)'),
        sourceBranch: z
          .string()
          .optional()
          .describe(
            'Git branch this task is based on (short name). Defaults to the project default branch when omitted.',
          ),
        createSourceBranchIfMissing: z
          .boolean()
          .optional()
          .describe(
            'When true and sourceBranch does not exist yet, Flux creates it from the project default on first session start.',
          ),
        agentModel: z
          .string()
          .optional()
          .describe(
            'Optional model id for Cursor/Claude task sessions; project default applies when omitted',
          ),
        agentYolo: z
          .boolean()
          .optional()
          .describe(
            'Fewer permission prompts (Cursor --yolo, Claude --dangerously-skip-permissions); project default when omitted',
          ),
        repoId: z
          .string()
          .optional()
          .describe(
            'Only when multi-repo2 is enabled: stable repo id from flux__get_project_info.repos[].id. Must match a configured repository; omit to use primaryRepoId.',
          ),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          const agent =
            input.agent ??
            (active.kind === 'local'
              ? active.project.defaultTaskAgent
              : this.bindingStore.getPrefs(active.activeKey.id).defaultTaskAgent);
          const spawnDefaultsSrc =
            active.kind === 'local'
              ? active.project
              : this.bindingStore.getPrefs(active.activeKey.id);
          const modelYolo = mergedTaskCreateAgentFields(
            spawnDefaultsSrc,
            agent,
            input.agentModel,
            input.agentYolo,
          );
          if (active.kind === 'local') {
            const repos = await this.projectStore.getReposAt(active.projectDir);
            const requestedRepoId = input.repoId;
            const repoResolved = resolveLocalTaskRepoIdForCreate(repos, requestedRepoId);
            if (!repoResolved.ok) {
              return jsonToolPayload({ error: repoResolved.message });
            }
            const repo = resolveRepoForBranchDiscovery(repos, repoResolved.repoId);
            if (!repo?.rootPath) {
              return jsonToolPayload({ error: 'No repository root configured for this project' });
            }
            const discovery = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
            const planned = planTaskSourceBranchFieldsForCreate(discovery, {
              sourceBranch: input.sourceBranch,
              createSourceBranchIfMissing: input.createSourceBranchIfMissing,
            });
            const branchOk = validateStoredTaskSourceBranchName(planned.sourceBranch);
            if (!branchOk.ok) {
              return jsonToolPayload({ error: branchOk.message });
            }
            let task = await this.taskStore.create({
              title: input.title,
              agent,
              projectId: active.project.id,
              repoId: repoResolved.repoId,
              sourceBranch: planned.sourceBranch,
              createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
              ...modelYolo,
              ...(input.blockedByTaskIds?.length
                ? { blockedByTaskIds: input.blockedByTaskIds }
                : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
            });
            if (input.description != null && input.description !== '') {
              task = await this.taskStore.update(task.id, {
                description: input.description,
              });
            }
            this.notifyTasksChanged();
            return jsonToolPayload(task);
          }
          let assigneeId: string | undefined;
          if (input.assigneeEmail != null) {
            const resolved = await this.resolveEmailToId(
              input.assigneeEmail,
              active.activeKey,
            );
            if (typeof resolved !== 'string') return resolved;
            assigneeId = resolved;
          }
          const payload: McpBridgeTasksCreatePayload = {
            input: {
              title: input.title,
              agent,
              ...modelYolo,
              ...(input.description != null && input.description !== ''
                ? { description: input.description }
                : {}),
              ...(input.blockedByTaskIds?.length
                ? { blockedByTaskIds: input.blockedByTaskIds }
                : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
              ...(assigneeId !== undefined ? { assigneeId } : {}),
              ...(input.sourceBranch !== undefined ? { sourceBranch: input.sourceBranch } : {}),
              ...(input.createSourceBranchIfMissing !== undefined
                ? { createSourceBranchIfMissing: input.createSourceBranchIfMissing }
                : {}),
              ...(input.repoId !== undefined
                ? { repoId: input.repoId }
                : {}),
            },
          };
          const result = await this.bridge.request<Task>(
            'tasks.create',
            active.activeKey,
            payload,
          );
          if (!result.ok) return this.bridgeError(result);
          return jsonToolPayload(result.data);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__update_task',
      'Update an existing task on the Flux board. When multi-repo2 is enabled, repoId may be changed only while the task has no linked PR and no active Flux workspace/session (same rules as the app UI); otherwise the update fails with an error.',
      {
        id: z.string().describe('Task id'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z
          .enum(['backlog', 'in-progress', 'needs-input', 'review', 'done'])
          .optional(),
        agent: z.enum(['claude-code', 'codex', 'cursor']).optional(),
        blockedByTaskIds: z
          .array(z.string())
          .optional()
          .describe('Replace dependency list: task ids this task is blocked by'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Replace feature tags; use [] to clear. Duplicates and casing normalized'),
        autoStartOnUnblock: z
          .boolean()
          .optional()
          .describe(
            'When true, auto-start when the last dependency completes even if the project default is off. When false, opt out of the project “when unblocked” default for this task (requires an assignee for that default to apply). Omit to leave unchanged.',
          ),
        assigneeEmail: z
          .string()
          .email()
          .optional()
          .describe('Email to assign or reassign this task to (cloud only)'),
        unassignAssignee: z
          .boolean()
          .optional()
          .describe('Set true to remove the current assignee from this task (cloud only)'),
        sourceBranch: z.string().optional(),
        createSourceBranchIfMissing: z.boolean().optional(),
        githubPr: z
          .object({
            url: z.string(),
            number: z.number().optional(),
            state: z.enum(['open', 'closed', 'merged']).optional(),
            mergedAt: z.string().optional(),
            headBranch: z.string().optional(),
            baseBranch: z.string().optional(),
            createdAt: z.string().optional(),
            updatedAt: z.string().optional(),
          })
          .nullable()
          .optional()
          .describe('GitHub PR metadata to set or null to clear'),
        repoId: z
          .string()
          .optional()
          .describe(
            'Only when multi-repo2 is enabled: change task.repoId using an id from flux__get_project_info.repos[]. Rejected when a session, worktree, or PR blocks repo moves (same as the UI).',
          ),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const existing = this.getTaskInCurrentProject(input.id);
            if (!existing) {
              return jsonToolPayload({
                error: 'Task not found or not part of the current project',
              });
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
            if (input.agent !== undefined) patch.agent = input.agent;
            if (input.blockedByTaskIds !== undefined)
              patch.blockedByTaskIds = input.blockedByTaskIds;
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
            const updated = await this.taskActions.updateTask(input.id, patch);
            this.notifyTasksChanged();
            return jsonToolPayload(updated);
          }
          let assigneeId: string | null | undefined;
          if (input.assigneeEmail !== undefined && input.unassignAssignee === true) {
            return jsonToolPayload({
              error: 'Pass either assigneeEmail or unassignAssignee, not both',
            });
          }
          if (input.unassignAssignee === true) {
            assigneeId = null;
          } else if (input.assigneeEmail !== undefined) {
            const resolved = await this.resolveEmailToId(
              input.assigneeEmail,
              active.activeKey,
            );
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
          if (input.agent !== undefined) patch.agent = input.agent;
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
          const result = await this.bridge.request<McpBridgeTasksUpdateResult>(
            'tasks.update',
            active.activeKey,
            payload,
          );
          if (!result.ok) return this.bridgeError(result);
          const { previous, updated } = result.data;
          if (previous) {
            await this.taskActions.autoStartIfTransitionedToInProgress(previous, updated);
          }
          return jsonToolPayload(updated);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__start_task',
      'Move a task to In progress on the Flux board and start its agent session',
      {
        id: z.string().describe('Task id from flux__list_tasks'),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const existing = this.getTaskInCurrentProject(input.id);
            if (!existing) {
              return jsonToolPayload({
                error: 'Task not found or not part of the current project',
              });
            }
            const updated = await this.taskActions.startTask(input.id);
            this.notifyTasksChanged();
            return jsonToolPayload(updated);
          }
          // Cloud: pull current tasks for blocked-by validation, then transition + start.
          const listResult = await this.bridge.request<Task[]>(
            'tasks.list',
            active.activeKey,
          );
          if (!listResult.ok) return this.bridgeError(listResult);
          const columnTasks = listResult.data;
          const existing = columnTasks.find((t) => t.id === input.id);
          if (!existing) {
            return jsonToolPayload({
              error: 'Task not found or not part of the current project',
            });
          }
          if (isTaskBlocked(existing, columnTasks)) {
            return jsonToolPayload({
              error:
                'Task is blocked by incomplete dependencies. Finish blocking tasks first.',
            });
          }
          const updateResult = await this.bridge.request<McpBridgeTasksUpdateResult>(
            'tasks.update',
            active.activeKey,
            { taskId: input.id, patch: { status: 'in-progress' } },
          );
          if (!updateResult.ok) return this.bridgeError(updateResult);
          const { updated } = updateResult.data;
          await this.taskActions.startSessionForExistingTask(updated);
          return jsonToolPayload(updated);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__delete_task',
      'Permanently remove a task from the Flux board for the current project. Requires confirm=true after the user explicitly asked to delete this task.',
      {
        id: z.string().describe('Task id from flux__list_tasks'),
        confirm: z
          .literal(true)
          .describe('Must be true — only set after the user confirmed they want this task deleted'),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const existing = this.getTaskInCurrentProject(input.id);
            if (!existing) {
              return jsonToolPayload({
                error: 'Task not found or not part of the current project',
              });
            }
            await this.taskStore.delete(input.id);
            this.notifyTasksChanged();
            return jsonToolPayload({ ok: true, deletedId: input.id });
          }
          const payload: McpBridgeTasksDeletePayload = { taskId: input.id };
          const result = await this.bridge.request<{ deletedId: string }>(
            'tasks.delete',
            active.activeKey,
            payload,
          );
          if (!result.ok) return this.bridgeError(result);
          return jsonToolPayload({ ok: true, deletedId: result.data.deletedId });
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__list_members',
      'List members of the current cloud project (uid, email, displayName, role owner|member, optional photoURL). Sorted with owners first, then by display name. For local projects returns members: [] with a note; use emails for assigneeEmail when creating or updating tasks.',
      {},
      async () => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            return jsonToolPayload({
              members: [] as McpBridgeMember[],
              note: 'Team member listing is only available for cloud projects.',
            });
          }
          const result = await this.bridge.request<McpBridgeMember[]>(
            'members.list',
            active.activeKey,
          );
          if (!result.ok) return this.bridgeError(result);
          return jsonToolPayload(result.data);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__get_project_info',
      'Returns the Flux project name, task counts per column, and git default branch for the primary repository when discovery succeeds. When the multi-repo2 feature is enabled, also returns repos (each with id, label, isPrimary, configuredDefaultBranch, optional defaultBranchShort, rootPath, pathStatus or binding) and primaryRepoId; top-level rootPath is always the primary clone path for backwards compatibility.',
      {},
      async () => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const tasks = this.taskStore.getAll(active.project.id);
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
            const repos = await this.projectStore.getReposAt(active.projectDir);
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
            return jsonToolPayload({
              name: active.project.name,
              rootPath: primaryRootPath,
              taskCounts,
              ...(defaultBranchShort !== undefined ? { defaultBranchShort } : {}),
              ...(branchDiscoveryError !== undefined ? { branchDiscoveryError } : {}),
              ...(primaryRepoId !== undefined ? { primaryRepoId } : {}),
              repos: repoSummaries,
            });
          }
          const result = await this.bridge.request<McpBridgeProjectInfoResult>(
            'projectInfo',
            active.activeKey,
          );
          if (!result.ok) return this.bridgeError(result);
          const data = result.data;
          return jsonToolPayload({
            name: data.name,
            rootPath: active.rootPath,
            taskCounts: data.taskCounts,
            ...(data.defaultBranchShort !== undefined
              ? { defaultBranchShort: data.defaultBranchShort }
              : {}),
            ...(data.branchDiscoveryError !== undefined
              ? { branchDiscoveryError: data.branchDiscoveryError }
              : {}),
            ...(data.primaryRepoId !== undefined ? { primaryRepoId: data.primaryRepoId } : {}),
            ...(data.repos !== undefined ? { repos: data.repos } : {}),
          });
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__list_repo_branches',
      'List local and origin remote branch short names, the configured default branch, and optionally classify one branch name. When multi-repo2 is enabled, pass repoId (from flux__get_project_info.repos[].id) to inspect a non-primary repository; omit repoId for the primary repo.',
      {
        repoId: z
          .string()
          .optional()
          .describe(
            'Only when multi-repo2 is enabled: which project repository to read (id from flux__get_project_info.repos). Omit for the primary repository.',
          ),
        classifyBranch: z
          .string()
          .optional()
          .describe(
            'Optional branch name to normalize and classify against local + origin remote lists',
          ),
      },
      async (input) => {
        try {
          const active = this.resolveActive();
          if (active.kind === 'none') {
            return jsonToolPayload({ error: 'No project open' });
          }
          if (active.kind === 'local') {
            const repos = await this.projectStore.getReposAt(active.projectDir);
            const repoIdArg = input.repoId?.trim() || undefined;
            const repo = resolveRepoForBranchDiscovery(repos, repoIdArg);
            if (!repo?.rootPath) {
              return jsonToolPayload({
                error:
                  input.repoId != null &&
                  input.repoId.trim() !== ''
                    ? 'Unknown repository id for this project'
                    : 'No repository root configured for this project',
              });
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
              return jsonToolPayload(out);
            }
            return jsonToolPayload(disc);
          }
          const result = await this.bridge.request<RepoBranchDiscoveryResponse>(
            'repo.branchDiscovery',
            active.activeKey,
            {
              ...(input.repoId != null &&
              input.repoId.trim() !== ''
                ? { repoId: input.repoId.trim() }
                : {}),
              classifyBranch: input.classifyBranch,
            },
          );
          if (!result.ok) return this.bridgeError(result);
          return jsonToolPayload(result.data);
        } catch (err) {
          return toolError(err);
        }
      },
    );
  }

  private async establishSse(res: http.ServerResponse): Promise<void> {
    const server = this.createSdkServer();
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    this.activeSessions.set(sessionId, {
      server,
      transport,
      createdAt: Date.now(),
    });

    const cleanup = () => {
      const active = this.activeSessions.get(sessionId);
      if (active?.transport === transport) {
        this.activeSessions.delete(sessionId);
        void server.close().catch(() => undefined);
      }
    };

    transport.onclose = () => {
      cleanup();
    };
    res.on('close', cleanup);

    try {
      await server.connect(transport);
    } catch (err) {
      cleanup();
      console.error('[MCP] Failed to establish SSE transport', err);
      if (!res.headersSent) {
        res.writeHead(500).end('MCP transport error');
      }
      throw err;
    }
  }

  start(): void {
    if (this.server) {
      return;
    }

    const httpServer = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    httpServer.once('listening', () => {
      this.server = httpServer;
      console.log('[MCP] Server listening on http://localhost:47432');
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('[MCP] Port 47432 already in use — MCP server not started');
        return;
      }
      console.error('[MCP] HTTP server error', err);
    });

    httpServer.listen(MCP_PORT);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host ?? `localhost:${MCP_PORT}`;
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sse') {
      await this.establishSse(res).catch(() => undefined);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      const now = Date.now();
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: true,
          activeSessions: this.activeSessions.size,
          sessions: Array.from(this.activeSessions.entries()).map(([sessionId, session]) => ({
            sessionId,
            ageMs: now - session.createdAt,
          })),
        }),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400).end('Missing sessionId parameter');
        return;
      }
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.warn('[MCP] POST /messages for unknown session', {
          requestedSessionId: sessionId,
          activeSessionCount: this.activeSessions.size,
          activeSessionIds: Array.from(this.activeSessions.keys()),
        });
        res.writeHead(404).end('Session not found');
        return;
      }
      try {
        await session.transport.handlePostMessage(req, res, undefined);
      } catch (err) {
        console.error('[MCP] Error handling POST /messages', err);
        if (!res.headersSent) {
          res.writeHead(500).end('Error handling request');
        }
      }
      return;
    }

    res.writeHead(404).end();
  }

  stop(): void {
    for (const { server } of this.activeSessions.values()) {
      void server.close().catch(() => undefined);
    }
    this.activeSessions.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
