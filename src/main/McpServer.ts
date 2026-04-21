/* eslint-disable import/no-unresolved -- MCP SDK subpath exports */
import { McpServer as BaseMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
/* eslint-enable import/no-unresolved */
import http from 'node:http';
import { URL } from 'node:url';
import { z } from 'zod';
import type { TaskStore } from './TaskStore';
import type { ProjectStore } from './ProjectStore';
import type { Task } from '../types';

const MCP_PORT = 47432;

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
  private mcpServer: BaseMcpServer;
  private activeTransport: SSEServerTransport | null = null;
  private sseChain: Promise<void> = Promise.resolve();

  constructor(
    private taskStore: TaskStore,
    private projectStore: ProjectStore,
  ) {
    this.mcpServer = new BaseMcpServer(
      { name: 'flux', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.tool(
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

    this.mcpServer.tool(
      'flux__create_task',
      'Create a new task on the Flux board for the current project',
      {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        agent: z
          .enum(['claude-code', 'codex', 'cursor'])
          .optional()
          .describe('Agent to use. Defaults to claude-code'),
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
          });
          if (input.description != null && input.description !== '') {
            task = await this.taskStore.update(task.id, { description: input.description });
          }
          return jsonToolPayload(task);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    this.mcpServer.tool(
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
      },
      async (input) => {
        try {
          const patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'agent'>> = {};
          if (input.title !== undefined) patch.title = input.title;
          if (input.description !== undefined) patch.description = input.description;
          if (input.status !== undefined) patch.status = input.status;
          if (input.agent !== undefined) patch.agent = input.agent;
          const updated = await this.taskStore.update(input.id, patch);
          return jsonToolPayload(updated);
        } catch (err) {
          return toolError(err);
        }
      },
    );

    this.mcpServer.tool(
      'flux__get_project_info',
      'Get a summary of the current Flux project and task counts',
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
    if (this.mcpServer.isConnected()) {
      await this.mcpServer.close().catch(() => undefined);
    }
    this.activeTransport = null;

    const transport = new SSEServerTransport('/messages', res);
    transport.onclose = () => {
      if (this.activeTransport === transport) {
        this.activeTransport = null;
      }
    };

    try {
      await this.mcpServer.connect(transport);
      this.activeTransport = transport;
    } catch (err) {
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
      this.sseChain = this.sseChain
        .then(() => this.establishSse(res))
        .catch(() => undefined);
      await this.sseChain;
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400).end('Missing sessionId parameter');
        return;
      }
      const transport = this.activeTransport;
      if (!transport || transport.sessionId !== sessionId) {
        res.writeHead(404).end('Session not found');
        return;
      }
      try {
        await transport.handlePostMessage(req, res, undefined);
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
    void this.mcpServer.close().catch(() => undefined);
    this.activeTransport = null;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
