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
import type { RendererAutomationBridge, AutomationBridgeResult } from './RendererAutomationBridge';
import type { ActiveProjectKey, RepoConfig, RepoPathStatus, Task, TaskGithubPr } from '../types';
import { collectRepoBranchDiscovery } from './repoGit';
import type { AutomationBridgeProjectInfoRepoSummary } from '../rendererAutomationBridge';
import { automationBridgeFailureToInvoke } from './automationBridgeFailureMessage';
import type {
  FluxAutomationInvokeBody,
  FluxAutomationInvokeResponse,
} from './AutomationHttpServer';
import { activeProjectKeysEqual } from './activeProjectKey';
import { runFluxAutomationInvocation, type FluxAutomationHost } from './fluxAutomationRuns';
import { repoDisplayLabel, resolvePrimaryRepoIdFromList } from '../repoIdentity';
import { FLUX_TASK_STATUS_VALUES } from './mcpListTasksFilter';

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

function mcpFromAutomationResult(r: FluxAutomationInvokeResponse): {
  content: Array<{ type: 'text'; text: string }>;
} {
  if (r.ok) return jsonToolPayload(r.data);
  return jsonToolPayload(
    r.code !== undefined ? { error: r.error, code: r.code } : { error: r.error },
  );
}

export class McpServer {
  private server: http.Server | null = null;
  private activeSessions = new Map<string, ActiveMcpSession>();

  constructor(
    private taskStore: TaskStore,
    private projectStore: ProjectStore,
    private appStateStore: AppStateStore,
    private bindingStore: LocalBindingStore,
    private bridge: RendererAutomationBridge,
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
      { name: 'flux', version: '0.1.1' },
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

  private bridgeFailureToInvoke(
    result: Extract<AutomationBridgeResult<unknown>, { ok: false }>,
  ): FluxAutomationInvokeResponse {
    return automationBridgeFailureToInvoke(result);
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
  ): Promise<AutomationBridgeProjectInfoRepoSummary[]> {
    const primaryId = resolvePrimaryRepoIdFromList(repos);
    const out: AutomationBridgeProjectInfoRepoSummary[] = [];
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'tasks.list', input),
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
          .enum(['claude-code', 'codex', 'cursor', 'none'])
          .optional()
          .describe(
            'Agent to use. Use none for an unassigned task. When omitted, the project default task agent applies.',
          ),
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'tasks.create', input),
          );
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
        agent: z
          .enum(['claude-code', 'codex', 'cursor', 'none'])
          .optional()
          .describe('Set to none to clear the task coding agent'),
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'tasks.update', input),
          );
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'tasks.start', input),
          );
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'tasks.delete', input),
          );
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'members.list', undefined),
          );
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'projectInfo', undefined),
          );
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
          return mcpFromAutomationResult(
            await runFluxAutomationInvocation(this.automationHost(), 'repo.branchDiscovery', input),
          );
        } catch (err) {
          return toolError(err);
        }
      },
    );
  }

  private automationHost(): FluxAutomationHost {
    return {
      resolveActive: () => this.resolveActive(),
      getTaskInCurrentProject: (taskId) => this.getTaskInCurrentProject(taskId),
      notifyTasksChanged: () => this.notifyTasksChanged(),
      bridge: this.bridge,
      taskStore: this.taskStore,
      projectStore: this.projectStore,
      bindingStore: this.bindingStore,
      taskActions: this.taskActions,
      bridgeFailureToInvoke: (r) => this.bridgeFailureToInvoke(r),
      buildLocalProjectInfoRepoSummaries: (repos) => this.buildLocalProjectInfoRepoSummaries(repos),
      probeRepoPathStatus: (root) => this.probeRepoPathStatus(root),
    };
  }

  public async invokeAutomationRequest(
    body: FluxAutomationInvokeBody,
  ): Promise<FluxAutomationInvokeResponse> {
    const current = this.appStateStore.get().activeProjectKey;
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
    return runFluxAutomationInvocation(this.automationHost(), body.op, body.payload);
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
