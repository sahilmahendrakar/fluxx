import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { Agent, Project, Session, Task } from '../types';
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

  constructor(private worktreeService: WorktreeService) {}

  async startSession(task: Task, project: Project): Promise<Session | SessionStartError> {
    const existingEntry = [...this.sessions.values()].find(
      (e) => e.session.taskId === task.id,
    );
    if (existingEntry) {
      if (existingEntry.session.status === 'running') {
        return existingEntry.session;
      }
      // A stopped session for this task lingered; drop it so we can start
      // anew. Its worktree (if any) will be reclaimed by WorktreeService.create.
      this.sessions.delete(existingEntry.session.id);
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
      // Keep the entry in the map and keep the worktree on disk so the
      // workspace lingers in the sidebar as 'stopped' until the user
      // explicitly archives or deletes it.
    });

    this.sessions.set(session.id, { pty: ptyProcess, session });

    return session;
  }

  /** Kill agent PTY and forget the session. Leaves the worktree on disk. */
  archiveSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch (err: unknown) {
      console.error('[SessionManager.archiveSession] pty.kill failed', { sessionId, err });
    }
    this.sessions.delete(sessionId);
  }

  /** Kill agent PTY, forget the session, and remove the worktree from disk. */
  async deleteWorkspace(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch (err: unknown) {
      console.error('[SessionManager.deleteWorkspace] pty.kill failed', { sessionId, err });
    }
    const worktreePath = entry.session.worktreePath;
    this.sessions.delete(sessionId);
    try {
      await this.worktreeService.remove(worktreePath);
    } catch (err: unknown) {
      console.error('[SessionManager.deleteWorkspace] worktree remove failed', {
        sessionId,
        err,
      });
    }
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
