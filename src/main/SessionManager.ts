import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { Agent, Project, Session, Task } from '../types';
import { WorktreeService } from './WorktreeService';

export type SessionStartError =
  | { error: 'AGENT_NOT_FOUND'; message: string }
  | { error: 'WORKTREE_FAILED'; message: string };

function agentCommand(agent: Agent): string {
  switch (agent) {
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'cursor':
      return 'cursor';
  }
}

function agentNotFoundMessage(agent: Agent, command: string): string {
  if (agent === 'claude-code') {
    return `${command} not found on PATH. Install with: npm install -g @anthropic-ai/claude-code`;
  }
  return `${command} not found on PATH`;
}

export class SessionManager {
  private sessions = new Map<string, { pty: IPty; session: Session }>();

  constructor(private worktreeService: WorktreeService) {}

  async startSession(
    task: Task,
    project: Project,
    win: BrowserWindow,
  ): Promise<Session | SessionStartError> {
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

    const command = agentCommand(task.agent);
    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(command, [], {
        name: 'xterm-color',
        cols: 220,
        rows: 50,
        cwd: worktreePath,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SessionManager.startSession] PTY spawn failed', {
        taskId: task.id,
        command,
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
      win.webContents.send(`session:data:${session.id}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const entry = this.sessions.get(session.id);
      const liveSession = entry?.session ?? session;
      liveSession.status = exitCode === 0 ? 'stopped' : 'error';
      liveSession.stoppedAt = new Date().toISOString();
      win.webContents.send('session:exited', liveSession);
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
}
