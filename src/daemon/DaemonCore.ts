import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type {
  PlanningSession,
  Session,
  Shell,
} from '../types';
import type {
  AttachResult,
  CreateSessionParams,
  CreateSessionResult,
  CreateShellParams,
  PlanningAttachResult,
  StartPlanningParams,
  StartPlanningResult,
  StreamFrame,
} from './protocol';
import { SessionRuntime } from './SessionRuntime';
import { SilenceDetector } from './SilenceDetector';

interface SessionEntry {
  runtime: SessionRuntime;
  session: Session;
  detector: SilenceDetector;
}

interface ShellEntry {
  runtime: SessionRuntime;
  shell: Shell;
}

interface PlanningEntry {
  runtime: SessionRuntime;
  session: PlanningSession;
}

/** Idle-shutdown timer: exit after N ms with zero live PTYs. */
const DEFAULT_IDLE_MS = 24 * 60 * 60 * 1000;

function defaultShellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.COMSPEC ?? 'cmd.exe', args: [] };
  }
  const sh = process.env.SHELL ?? '/bin/bash';
  // Login shell gives users their normal PATH / aliases.
  return { command: sh, args: ['-l'] };
}

/**
 * In-daemon registry for every PTY the daemon currently owns. Pure
 * business logic — socket I/O lives in the daemon entry point. The
 * daemon broadcasts PTY output by handing a `broadcast` callback to
 * each `SessionRuntime`.
 */
export class DaemonCore {
  private sessions = new Map<string, SessionEntry>();
  private shells = new Map<string, ShellEntry>();
  private planning = new Map<string, PlanningEntry>();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleMs: number;

  constructor(
    private readonly broadcast: (frame: StreamFrame) => void,
    opts: { idleMs?: number } = {},
  ) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.armIdleTimer();
  }

  // ------------------------------------------------------------------- sessions

  createSession(params: CreateSessionParams): CreateSessionResult {
    const id = randomUUID();
    const session: Session = {
      id,
      taskId: params.taskId,
      projectId: params.projectId,
      worktreePath: params.worktreePath,
      branch: params.branch,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const detector = new SilenceDetector(
      (state) => this.broadcast({ kind: 'agent-state', id, state }),
      undefined,
      id,
    );

    let runtime: SessionRuntime;
    try {
      runtime = new SessionRuntime(
        {
          command: params.command,
          args: params.args,
          cwd: params.worktreePath,
          cols: params.cols,
          rows: params.rows,
        },
        {
          onData: (data, seq) => {
            this.broadcast({ kind: 'data', target: 'session', id, data, seq });
            detector.onData();
          },
          onExit: ({ exitCode }) => {
            const entry = this.sessions.get(id);
            if (!entry) return;
            entry.detector.dispose();
            entry.session.status = exitCode === 0 ? 'stopped' : 'error';
            entry.session.stoppedAt = new Date().toISOString();
            this.broadcast({
              kind: 'session-exit',
              id,
              session: { ...entry.session },
            });
            // Intentionally leave the entry in the map so list/get can still
            // surface the stopped session to main until it's archived.
          },
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: 'AGENT_NOT_FOUND', message };
    }

    this.sessions.set(id, { runtime, session, detector });
    this.cancelIdleTimer();
    return session;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()].map((e) => ({ ...e.session }));
  }

  /** Returns the current silence state for every running session. Used for catchup on reconnect. */
  getSessionSilenceStates(): { id: string; taskId?: string; state: import('./SilenceDetector').SilenceState }[] {
    const result: { id: string; taskId?: string; state: import('./SilenceDetector').SilenceState }[] = [];
    for (const [id, entry] of this.sessions) {
      if (entry.session.status !== 'running') continue;
      result.push({ id, taskId: entry.session.taskId, state: entry.detector.getCurrentState() });
    }
    return result;
  }

  async attachSession(id: string): Promise<AttachResult | null> {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    return entry.runtime.snapshot();
  }

  writeSession(id: string, data: string): void {
    this.sessions.get(id)?.runtime.write(data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    // Notify the detector before the resize so the SIGWINCH-triggered redraw
    // is suppressed and does not falsely transition the task to in-progress.
    entry.detector.notifyResize();
    entry.runtime.resize(cols, rows);
  }

  /** Kill + forget. Worktree removal is main's job. */
  stopSession(id: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.detector.dispose();
    entry.runtime.kill();
    entry.runtime.dispose();
    this.sessions.delete(id);
    this.armIdleTimer();
  }

  // --------------------------------------------------------------------- shells

  createShell(params: CreateShellParams): Shell {
    const id = randomUUID();
    const { command, args } = defaultShellCommand();
    const shell: Shell = {
      id,
      sessionId: params.sessionId,
      worktreePath: params.worktreePath,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const runtime = new SessionRuntime(
      {
        command,
        args,
        cwd: params.worktreePath,
        cols: params.cols,
        rows: params.rows,
        env: { ...process.env, HOME: process.env.HOME ?? os.homedir() },
      },
      {
        onData: (data, seq) => {
          this.broadcast({ kind: 'data', target: 'shell', id, data, seq });
        },
        onExit: ({ exitCode }) => {
          const entry = this.shells.get(id);
          if (!entry) return;
          entry.shell.status = exitCode === 0 ? 'stopped' : 'error';
          entry.shell.stoppedAt = new Date().toISOString();
          this.broadcast({
            kind: 'shell-exit',
            id,
            shell: { ...entry.shell },
          });
          entry.runtime.dispose();
          this.shells.delete(id);
          this.armIdleTimer();
        },
      },
    );

    this.shells.set(id, { runtime, shell });
    this.cancelIdleTimer();
    return shell;
  }

  listShells(sessionId?: string): Shell[] {
    const all = [...this.shells.values()].map((e) => ({ ...e.shell }));
    return sessionId ? all.filter((s) => s.sessionId === sessionId) : all;
  }

  async attachShell(id: string): Promise<AttachResult | null> {
    const entry = this.shells.get(id);
    if (!entry) return null;
    return entry.runtime.snapshot();
  }

  writeShell(id: string, data: string): void {
    this.shells.get(id)?.runtime.write(data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    this.shells.get(id)?.runtime.resize(cols, rows);
  }

  closeShell(id: string): void {
    const entry = this.shells.get(id);
    if (!entry) return;
    entry.runtime.kill();
    entry.runtime.dispose();
    this.shells.delete(id);
    this.armIdleTimer();
  }

  closeShellsForSession(sessionId: string): void {
    for (const [id, entry] of this.shells) {
      if (entry.shell.sessionId === sessionId) {
        entry.runtime.kill();
        entry.runtime.dispose();
        this.shells.delete(id);
      }
    }
    this.armIdleTimer();
  }

  // ------------------------------------------------------------------- planning

  startPlanning(params: StartPlanningParams): StartPlanningResult {
    const id = randomUUID();
    const session: PlanningSession = {
      id,
      projectId: params.projectId,
      agent: params.agent,
      planningDir: params.planningDir,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    let runtime: SessionRuntime;
    try {
      runtime = new SessionRuntime(
        {
          command: params.command,
          args: params.args,
          cwd: params.planningDir,
          cols: params.cols,
          rows: params.rows,
        },
        {
          onData: (data, seq) => {
            this.broadcast({ kind: 'data', target: 'planning', id, data, seq });
          },
          onExit: ({ exitCode }) => {
            const entry = this.planning.get(id);
            if (!entry) return;
            entry.session.status = exitCode === 0 ? 'stopped' : 'error';
            entry.session.stoppedAt = new Date().toISOString();
            this.broadcast({
              kind: 'planning-exit',
              id,
              session: { ...entry.session },
            });
            // Match task sessions: keep the entry (and replay buffer) until
            // `stopPlanning` archives it so attach/list stay coherent.
            this.armIdleTimer();
          },
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: 'AGENT_NOT_FOUND', message };
    }

    this.planning.set(id, { runtime, session });
    this.cancelIdleTimer();
    return { ...session };
  }

  listPlanning(): PlanningSession[] {
    return [...this.planning.values()].map((e) => ({ ...e.session }));
  }

  /** Kill + forget. */
  stopPlanning(id: string): void {
    const entry = this.planning.get(id);
    if (!entry) return;
    entry.runtime.kill();
    entry.runtime.dispose();
    this.planning.delete(id);
    this.armIdleTimer();
  }

  getPlanning(id: string): PlanningSession | null {
    const entry = this.planning.get(id);
    return entry ? { ...entry.session } : null;
  }

  async attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    const entry = this.planning.get(id);
    if (!entry) return null;
    const snap = await entry.runtime.snapshot();
    return {
      ...snap,
      session: { ...entry.session },
    };
  }

  writePlanning(id: string, data: string): void {
    this.planning.get(id)?.runtime.write(data);
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    this.planning.get(id)?.runtime.resize(cols, rows);
  }

  // -------------------------------------------------------------- lifecycle

  /** Kill every PTY this daemon owns. Called from signal handlers. */
  killAll(): void {
    for (const { runtime } of this.sessions.values()) runtime.kill();
    for (const { runtime } of this.shells.values()) runtime.kill();
    for (const { runtime } of this.planning.values()) runtime.kill();
  }

  private isIdle(): boolean {
    for (const entry of this.planning.values()) {
      if (!entry.runtime.isExited) return false;
    }
    for (const entry of this.sessions.values()) {
      if (!entry.runtime.isExited) return false;
    }
    for (const entry of this.shells.values()) {
      if (!entry.runtime.isExited) return false;
    }
    return true;
  }

  private armIdleTimer(): void {
    if (this.idleTimer) return;
    if (!this.isIdle()) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.isIdle()) {
        process.exit(0);
      }
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
