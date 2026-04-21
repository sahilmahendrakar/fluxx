import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { Agent, PlanningSession, Project, Session, Task } from '../types';
import { WorktreeService } from './WorktreeService';

function broadcastSessionChannel(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
  }
}

export type SessionStartError =
  | { error: 'AGENT_NOT_FOUND'; message: string }
  | { error: 'WORKTREE_FAILED'; message: string };

function taskInitialPrompt(task: Task): string {
  const desc = (task.description ?? '').trim();
  return desc ? `${task.title}\n\n${desc}` : task.title;
}

function agentSpawnSpec(agent: Agent, initialPrompt: string): { command: string; args: string[] } {
  switch (agent) {
    case 'claude-code':
      return { command: 'claude', args: [initialPrompt] };
    case 'codex':
      return { command: 'codex', args: [] };
    case 'cursor':
      return { command: 'agent', args: ['--model', 'auto', initialPrompt] };
  }
}

function planningAgentForProject(project: Project): Agent {
  return project.kind === 'local' ? project.planningAgent : 'claude-code';
}

function planningSpawnSpec(
  agent: Agent,
  project: Project,
  mcpConfigPath: string,
): { command: string; args: string[] } {
  const name = project.name;
  const rootPath = project.rootPath;
  switch (agent) {
    case 'claude-code':
      return {
        command: 'claude',
        args: [
          '--allowedTools',
          'Read,Glob,Grep,LS,mcp__flux__list_tasks,mcp__flux__create_task,mcp__flux__update_task,mcp__flux__get_project_info',
          '--mcp-config',
          mcpConfigPath,
          '--append-system-prompt',
          'You are a planning assistant for a software project. Help the developer plan features, maintain documentation in this directory, and manage tasks on the Flux board using the available flux__ tools. Do not write application code.',
          '-p',
          `You are helping plan the ${name} project located at ${rootPath}. Start by reading the codebase structure and any existing planning documents in this directory, then ask how you can help.`,
        ],
      };
    case 'codex':
      return {
        command: 'codex',
        args: [
          '-p',
          `You are a planning assistant for the ${name} project at ${rootPath}. You have access to flux MCP tools for task management. Do not write application code — focus on planning, documentation, and task creation.`,
        ],
      };
    case 'cursor':
      return {
        command: 'cursor',
        args: [
          '-p',
          `You are a planning assistant for the ${name} project at ${rootPath}. Focus on planning, documentation, and task management. Do not write application code.`,
        ],
      };
  }
}

function agentNotFoundMessage(agent: Agent, command: string): string {
  if (agent === 'claude-code') {
    return `${command} not found on PATH. Install with: npm install -g @anthropic-ai/claude-code`;
  }
  if (agent === 'cursor') {
    return `${command} not found on PATH. Install Cursor Agent CLI: https://cursor.com/docs/cli/installation`;
  }
  return `${command} not found on PATH`;
}

export class SessionManager {
  private sessions = new Map<string, { pty: IPty; session: Session }>();
  private planningPty: IPty | null = null;
  private planningSession: PlanningSession | null = null;

  constructor(private worktreeService: WorktreeService) {}

  async startSession(task: Task, project: Project): Promise<Session | SessionStartError> {
    const existing = this.getSession(task.id);
    if (existing) {
      return existing;
    }

    let worktreePath = '';
    let branch = '';
    try {
      const created = await this.worktreeService.create(task.id);
      worktreePath = created.worktreePath;
      branch = created.branch;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SessionManager.startSession] worktree create failed', {
        taskId: task.id,
        projectId: project.id,
        message,
      });
      return { error: 'WORKTREE_FAILED', message };
    }

    const initialPrompt = taskInitialPrompt(task);
    const { command, args } = agentSpawnSpec(task.agent, initialPrompt);
    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(command, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: worktreePath,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SessionManager.startSession] PTY spawn failed', {
        taskId: task.id,
        command,
        args,
        message,
        err,
      });
      try {
        await this.worktreeService.remove(worktreePath);
      } catch (removeErr: unknown) {
        console.error('[SessionManager.startSession] cleanup worktree after spawn failure', removeErr);
      }
      return {
        error: 'AGENT_NOT_FOUND',
        message: agentNotFoundMessage(task.agent, command),
      };
    }

    const session: Session = {
      id: randomUUID(),
      taskId: task.id,
      projectId: project.id,
      worktreePath,
      branch,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    ptyProcess.onData((data) => {
      broadcastSessionChannel(`session:data:${session.id}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const entry = this.sessions.get(session.id);
      const liveSession = entry?.session ?? session;
      liveSession.status = exitCode === 0 ? 'stopped' : 'error';
      liveSession.stoppedAt = new Date().toISOString();
      broadcastSessionChannel('session:exited', liveSession);
      if (entry) {
        this.sessions.delete(session.id);
        void this.worktreeService.remove(entry.session.worktreePath);
      }
    });

    this.sessions.set(session.id, { pty: ptyProcess, session });

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }
    try {
      entry.pty.kill();
    } catch (err: unknown) {
      console.error('[SessionManager.stopSession] pty.kill failed', { sessionId, err });
    }
    try {
      await this.worktreeService.remove(entry.session.worktreePath);
    } catch (err: unknown) {
      console.error('[SessionManager.stopSession] worktree remove failed', { sessionId, err });
    }
    this.sessions.delete(sessionId);
  }

  getSession(taskId: string): Session | null {
    for (const { session } of this.sessions.values()) {
      if (session.taskId === taskId) {
        return session;
      }
    }
    return null;
  }

  getSessionBySessionId(sessionId: string): Session | null {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()].map(({ session }) => session);
  }

  write(sessionId: string, data: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.pty.resize(cols, rows);
  }

  async startPlanningSession(
    project: Project,
    projectDir: string,
    win: BrowserWindow,
  ): Promise<PlanningSession | { error: string; message?: string }> {
    if (this.planningPty && this.planningSession) {
      return this.planningSession;
    }

    const planningDir = path.join(projectDir, 'planning');
    const mcpConfigPath = path.join(projectDir, 'mcp.json');
    await fs.mkdir(planningDir, { recursive: true });

    const agent = planningAgentForProject(project);
    const { command, args } = planningSpawnSpec(agent, project, mcpConfigPath);
    const sessionId = randomUUID();

    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(command, args, {
        name: 'xterm-color',
        cols: 220,
        rows: 50,
        cwd: planningDir,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SessionManager.startPlanningSession] PTY spawn failed', {
        projectId: project.id,
        command,
        args,
        message,
        err,
      });
      return {
        error: 'AGENT_NOT_FOUND',
        message: agentNotFoundMessage(agent, command),
      };
    }

    const planningSession: PlanningSession = {
      id: sessionId,
      projectId: project.id,
      agent,
      planningDir,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    this.planningPty = ptyProcess;
    this.planningSession = planningSession;

    ptyProcess.onData((data) => {
      win.webContents.send('planning:data', data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.planningPty !== ptyProcess) {
        return;
      }
      planningSession.status = exitCode === 0 ? 'stopped' : 'error';
      planningSession.stoppedAt = new Date().toISOString();
      win.webContents.send('planning:exited', planningSession);
      this.planningPty = null;
      this.planningSession = null;
    });

    return planningSession;
  }

  async stopPlanningSession(): Promise<void> {
    if (!this.planningPty || !this.planningSession) {
      return;
    }
    try {
      this.planningPty.kill();
    } catch (err: unknown) {
      console.error('[SessionManager.stopPlanningSession] pty.kill failed', err);
    }
    this.planningPty = null;
    this.planningSession = null;
  }

  getPlanningSession(): PlanningSession | null {
    return this.planningSession;
  }

  writePlanning(data: string): void {
    if (!this.planningPty) {
      return;
    }
    this.planningPty.write(data);
  }

  resizePlanning(cols: number, rows: number): void {
    if (!this.planningPty) {
      return;
    }
    this.planningPty.resize(cols, rows);
  }
}
