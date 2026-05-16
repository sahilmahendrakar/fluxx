import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { PlanningSession, Session, Shell } from '../types';
import type {
  AgentState,
  AttachResult,
  CreateSessionParams,
  CreateSessionResult,
  CreateShellParams,
  PlanningAttachResult,
  StartPlanningParams,
  StartPlanningResult,
  StreamFrame,
} from '../daemon/protocol';
import { SessionRuntime } from '../daemon/SessionRuntime';
import { SilenceDetector } from '../daemon/SilenceDetector';
import { PromptAutoresponder } from '../daemon/PromptAutoresponder';
import { buildTrustPromptAutoresponderRules } from '../daemon/trustPromptAutoresponderRules';
import type { SilenceState } from '../daemon/SilenceDetector';

interface SessionEntry {
  runtime: SessionRuntime;
  session: Session;
  detector: SilenceDetector;
  autoresponder: PromptAutoresponder | null;
}

interface ShellEntry {
  runtime: SessionRuntime;
  shell: Shell;
}

interface PlanningEntry {
  runtime: SessionRuntime;
  session: PlanningSession;
  autoresponder: PromptAutoresponder | null;
}

function defaultShellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.COMSPEC ?? 'cmd.exe', args: [] };
  }
  const sh = process.env.SHELL ?? '/bin/bash';
  return { command: sh, args: ['-l'] };
}

function broadcastToAllWindows(channel: string, payload?: unknown): void {
  let BrowserWindowCtor: { getAllWindows: () => Array<{ isDestroyed: () => boolean; webContents: { send: (c: string, p?: unknown) => void } }> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    BrowserWindowCtor = require('electron').BrowserWindow;
  } catch {
    return;
  }
  for (const win of BrowserWindowCtor.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * Fan-out for live PTY stream control frames to renderer `webContents.send` channels
 * (`session:data:<id>`, …).
 */
export function deliverTerminalStreamFrameToRenderers(frame: StreamFrame): void {
  if (frame.kind === 'data') {
    const payload = { data: frame.data, seq: frame.seq };
    if (frame.target === 'session') {
      broadcastToAllWindows(`session:data:${frame.id}`, payload);
    } else if (frame.target === 'shell') {
      broadcastToAllWindows(`shell:data:${frame.id}`, payload);
    } else if (frame.target === 'planning') {
      broadcastToAllWindows(`planning:data:${frame.id}`, payload);
    }
    return;
  }
  if (frame.kind === 'session-exit') {
    broadcastToAllWindows('session:exited', frame.session);
    return;
  }
  if (frame.kind === 'shell-exit') {
    broadcastToAllWindows('shell:exited', frame.shell);
    return;
  }
  if (frame.kind === 'planning-exit') {
    broadcastToAllWindows('planning:exited', frame.session);
    return;
  }
  if (frame.kind === 'agent-state') {
    broadcastToAllWindows(`session:agent-state:${frame.id}`, { state: frame.state });
    return;
  }
  if (frame.kind === 'auto-responded') {
    if (frame.target === 'session') {
      broadcastToAllWindows(`session:auto-responded:${frame.id}`, {
        ruleId: frame.ruleId,
        agent: frame.agent,
        sessionId: frame.sessionId,
      });
    } else if (frame.target === 'planning') {
      broadcastToAllWindows(`planning:auto-responded:${frame.id}`, {
        ruleId: frame.ruleId,
        agent: frame.agent,
        sessionId: frame.sessionId,
      });
    }
  }
}

export interface TerminalRuntimeManagerOptions {
  /**
   * Deliver stream/control frames (tests inject this). Defaults to
   * {@link deliverTerminalStreamFrameToRenderers}.
   */
  deliverStreamFrame?: (frame: StreamFrame) => void;
  /** Optional hooks for local task-store updates (see main-process terminal backend wiring). */
  onAgentState?: (sessionId: string, state: AgentState) => void;
  onSessionExit?: (session: Session) => void;
}

/**
 * Main-process owner of local PTYs (task sessions, shells, planning). Registry
 * semantics mirror the former detached daemon's `DaemonCore` implementation.
 */
export class TerminalRuntimeManager {
  private sessions = new Map<string, SessionEntry>();
  private shells = new Map<string, ShellEntry>();
  private planning = new Map<string, PlanningEntry>();
  private readonly deliverStreamFrame: (frame: StreamFrame) => void;
  private readonly onAgentState?: (sessionId: string, state: AgentState) => void;
  private readonly onSessionExit?: (session: Session) => void;

  constructor(opts: TerminalRuntimeManagerOptions = {}) {
    this.deliverStreamFrame = opts.deliverStreamFrame ?? deliverTerminalStreamFrameToRenderers;
    this.onAgentState = opts.onAgentState;
    this.onSessionExit = opts.onSessionExit;
  }

  private emitFrame(frame: StreamFrame): void {
    if (frame.kind === 'agent-state') {
      this.onAgentState?.(frame.id, frame.state);
    }
    if (frame.kind === 'session-exit') {
      this.onSessionExit?.(frame.session);
    }
    this.deliverStreamFrame(frame);
  }

  // ------------------------------------------------------------------- sessions

  createSession(params: CreateSessionParams): CreateSessionResult {
    const id = randomUUID();
    const session: Session = {
      id,
      taskId: params.taskId,
      projectId: params.projectId,
      ...(params.repoId != null && params.repoId.length > 0 ? { repoId: params.repoId } : {}),
      worktreePath: params.worktreePath,
      branch: params.branch,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const detector = new SilenceDetector(
      (state) => this.emitFrame({ kind: 'agent-state', id, state }),
      undefined,
      id,
    );

    const trustAutorespondEnabled =
      params.trustPromptAutorespond === true &&
      Array.isArray(params.trustPromptAutorespondRoots) &&
      params.trustPromptAutorespondRoots.length > 0;
    const trustRootsRaw = params.trustPromptAutorespondRoots ?? [];
    const trustRoots = trustAutorespondEnabled
      ? trustRootsRaw.map((r) => path.resolve(r))
      : [];
    const trustRules = trustAutorespondEnabled ? buildTrustPromptAutoresponderRules(trustRoots) : [];

    let autoresponder: PromptAutoresponder | null = null;

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
            this.emitFrame({ kind: 'data', target: 'session', id, data, seq });
            detector.onData();
            autoresponder?.notifyPtyData();
          },
          onExit: ({ exitCode }) => {
            const entry = this.sessions.get(id);
            if (!entry) return;
            entry.detector.dispose();
            entry.autoresponder?.dispose();
            entry.session.status = exitCode === 0 ? 'stopped' : 'error';
            entry.session.stoppedAt = new Date().toISOString();
            this.emitFrame({
              kind: 'session-exit',
              id,
              session: { ...entry.session },
            });
          },
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: 'AGENT_NOT_FOUND', message };
    }

    if (trustRules.length > 0) {
      autoresponder = new PromptAutoresponder(
        id,
        params.agent,
        true,
        trustRules,
        runtime,
        (payload) =>
          this.emitFrame({
            kind: 'auto-responded',
            target: 'session',
            id,
            sessionId: payload.sessionId,
            ruleId: payload.ruleId,
            agent: payload.agent,
          }),
      );
    }

    this.sessions.set(id, { runtime, session, detector, autoresponder });
    return session;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()].map((e) => ({ ...e.session }));
  }

  /** In-process PTYs only (task sessions, shells, planning). */
  liveMainProcessPtyCount(): number {
    let n = 0;
    for (const e of this.sessions.values()) {
      if (e.session.status === 'running') n += 1;
    }
    for (const e of this.shells.values()) {
      if (e.shell.status === 'running') n += 1;
    }
    for (const e of this.planning.values()) {
      if (e.session.status === 'running') n += 1;
    }
    return n;
  }

  getSessionSilenceStates(): { id: string; taskId?: string; state: SilenceState }[] {
    const result: { id: string; taskId?: string; state: SilenceState }[] = [];
    for (const [sid, entry] of this.sessions) {
      if (entry.session.status !== 'running') continue;
      result.push({ id: sid, taskId: entry.session.taskId, state: entry.detector.getCurrentState() });
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

  /**
   * Ensures this write is applied before follow-up writes (e.g. bracketed paste
   * then a lone `\r` for {@link tasks:requestPullRequestFromAgent}).
   */
  async writeSessionAwait(id: string, data: string): Promise<void> {
    this.writeSession(id, data);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.detector.notifyResize();
    entry.runtime.resize(cols, rows);
  }

  stopSession(id: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.detector.dispose();
    entry.autoresponder?.dispose();
    entry.runtime.kill();
    entry.runtime.dispose();
    this.sessions.delete(id);
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
          this.emitFrame({ kind: 'data', target: 'shell', id, data, seq });
        },
        onExit: ({ exitCode }) => {
          const entry = this.shells.get(id);
          if (!entry) return;
          entry.shell.status = exitCode === 0 ? 'stopped' : 'error';
          entry.shell.stoppedAt = new Date().toISOString();
          this.emitFrame({
            kind: 'shell-exit',
            id,
            shell: { ...entry.shell },
          });
          entry.runtime.dispose();
          this.shells.delete(id);
        },
      },
    );

    this.shells.set(id, { runtime, shell });
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
  }

  closeShellsForSession(sessionId: string): void {
    for (const [id, entry] of this.shells) {
      if (entry.shell.sessionId === sessionId) {
        entry.runtime.kill();
        entry.runtime.dispose();
        this.shells.delete(id);
      }
    }
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

    const trustAutorespondEnabled =
      params.trustPromptAutorespond === true &&
      Array.isArray(params.trustPromptAutorespondRoots) &&
      params.trustPromptAutorespondRoots.length > 0;
    const trustRootsRaw = params.trustPromptAutorespondRoots ?? [];
    const trustRoots = trustAutorespondEnabled
      ? trustRootsRaw.map((r) => path.resolve(r))
      : [];
    const trustRules = trustAutorespondEnabled ? buildTrustPromptAutoresponderRules(trustRoots) : [];

    let autoresponder: PromptAutoresponder | null = null;

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
            this.emitFrame({ kind: 'data', target: 'planning', id, data, seq });
            autoresponder?.notifyPtyData();
          },
          onExit: ({ exitCode }) => {
            const entry = this.planning.get(id);
            if (!entry) return;
            entry.autoresponder?.dispose();
            entry.session.status = exitCode === 0 ? 'stopped' : 'error';
            entry.session.stoppedAt = new Date().toISOString();
            this.emitFrame({
              kind: 'planning-exit',
              id,
              session: { ...entry.session },
            });
          },
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: 'AGENT_NOT_FOUND', message };
    }

    if (trustRules.length > 0) {
      autoresponder = new PromptAutoresponder(
        id,
        params.agent,
        true,
        trustRules,
        runtime,
        (payload) =>
          this.emitFrame({
            kind: 'auto-responded',
            target: 'planning',
            id,
            sessionId: payload.sessionId,
            ruleId: payload.ruleId,
            agent: payload.agent,
          }),
      );
    }

    this.planning.set(id, { runtime, session, autoresponder });
    return { ...session };
  }

  listPlanning(): PlanningSession[] {
    return [...this.planning.values()].map((e) => ({ ...e.session }));
  }

  stopPlanning(id: string): void {
    const entry = this.planning.get(id);
    if (!entry) return;
    entry.autoresponder?.dispose();
    entry.runtime.kill();
    entry.runtime.dispose();
    this.planning.delete(id);
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

  /**
   * Kill and dispose every registered PTY (shells, planning, and any in-process
   * task sessions). Used on full app quit so no child processes remain.
   */
  shutdownAllPtys(): void {
    for (const entry of [...this.sessions.values()]) {
      entry.detector.dispose();
      entry.autoresponder?.dispose();
      entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.sessions.clear();
    for (const entry of [...this.shells.values()]) {
      entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.shells.clear();
    for (const entry of [...this.planning.values()]) {
      entry.autoresponder?.dispose();
      entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.planning.clear();
  }
}
