/* eslint-disable import/no-unresolved -- MCP SDK subpath exports */
import { McpServer as BaseMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
/* eslint-enable import/no-unresolved */
import http from 'node:http';
import { URL } from 'node:url';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { TaskStore } from './TaskStore';
import type { ProjectStore } from './ProjectStore';
import type { Task } from '../types';

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
    private getMainWindow: () => BrowserWindow | null,
    private taskActions: {
      updateTask: (
        id: string,
        patch: Partial<
          Pick<
            Task,
            'title' | 'description' | 'status' | 'agent' | 'blockedByTaskIds' | 'labels'
          >
        >,
      ) => Promise<Task>;
      startTask: (id: string) => Promise<Task>;
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

  private registerTools(server: BaseMcpServer): void {
    server.tool(
      'flux__list_tasks',
      'List all tasks on the Flux board for the current project',
      {},
      async () => {
        try {
          const project = this.projectStore.get();
          const projectDir = this.projectStore.getProjectDir();
          if (!project || !projectDir) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const tasks = this.taskStore.getAll(project.id);
          return jsonToolPayload(tasks);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__create_task',
      'Create a new task on the Flux board for the current project',
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
      },
      async (input) => {
        try {
          const project = this.projectStore.get();
          const projectDir = this.projectStore.getProjectDir();
          if (!project || !projectDir) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const agent = input.agent ?? 'claude-code';
          let task = await this.taskStore.create({
            title: input.title,
            agent,
            projectId: project.id,
            ...(input.blockedByTaskIds?.length ? { blockedByTaskIds: input.blockedByTaskIds } : {}),
            ...(input.labels !== undefined ? { labels: input.labels } : {}),
          });
          if (input.description != null && input.description !== '') {
            task = await this.taskStore.update(task.id, { description: input.description });
          }
          this.notifyTasksChanged();
          return jsonToolPayload(task);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__update_task',
      'Update an existing task on the Flux board',
      {
        id: z.string().describe('Task id'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z
          .enum(['backlog', 'in-progress', 'needs-input', 'done'])
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
      },
      async (input) => {
        try {
          const project = this.projectStore.get();
          const projectDir = this.projectStore.getProjectDir();
          if (!project || !projectDir) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const existing = this.getTaskInCurrentProject(input.id);
          if (!existing) {
            return jsonToolPayload({
              error: 'Task not found or not part of the current project',
            });
          }
          const patch: Partial<
            Pick<
              Task,
              'title' | 'description' | 'status' | 'agent' | 'blockedByTaskIds' | 'labels'
            >
          > = {};
          if (input.title !== undefined) patch.title = input.title;
          if (input.description !== undefined) patch.description = input.description;
          if (input.status !== undefined) patch.status = input.status;
          if (input.agent !== undefined) patch.agent = input.agent;
          if (input.blockedByTaskIds !== undefined) patch.blockedByTaskIds = input.blockedByTaskIds;
          if (input.labels !== undefined) patch.labels = input.labels;
          const updated = await this.taskActions.updateTask(input.id, patch);
          this.notifyTasksChanged();
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
          const project = this.projectStore.get();
          const projectDir = this.projectStore.getProjectDir();
          if (!project || !projectDir) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const existing = this.getTaskInCurrentProject(input.id);
          if (!existing) {
            return jsonToolPayload({
              error: 'Task not found or not part of the current project',
            });
          }
          const updated = await this.taskActions.startTask(input.id);
          this.notifyTasksChanged();
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
          const project = this.projectStore.get();
          const projectDir = this.projectStore.getProjectDir();
          if (!project || !projectDir) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const existing = this.getTaskInCurrentProject(input.id);
          if (!existing) {
            return jsonToolPayload({
              error: 'Task not found or not part of the current project',
            });
          }
          await this.taskStore.delete(input.id);
          this.notifyTasksChanged();
          return jsonToolPayload({ ok: true, deletedId: input.id });
        } catch (err) {
          return toolError(err);
        }
      },
    );

    server.tool(
      'flux__get_project_info',
      'Get the current Flux project name, canonical rootPath (git repo / application code location), and task status counts',
      {},
      async () => {
        try {
          const project = this.projectStore.get();
          if (!project) {
            return jsonToolPayload({ error: 'No project open' });
          }
          const tasks = this.taskStore.getAll(project.id);
          const taskCounts = {
            backlog: 0,
            'in-progress': 0,
            'needs-input': 0,
            done: 0,
            total: tasks.length,
          };
          for (const t of tasks) {
            if (t.status === 'backlog') taskCounts.backlog++;
            else if (t.status === 'in-progress') taskCounts['in-progress']++;
            else if (t.status === 'needs-input') taskCounts['needs-input']++;
            else if (t.status === 'done') taskCounts.done++;
          }
          return jsonToolPayload({
            name: project.name,
            rootPath: project.rootPath,
            taskCounts,
          });
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
