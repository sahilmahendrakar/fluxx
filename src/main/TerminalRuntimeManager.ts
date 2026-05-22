import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
  agentSupportsGracefulQuitCapture,
  GRACEFUL_QUIT_AGENT_INTERRUPT_COUNT,
  GRACEFUL_QUIT_INTERRUPT_GAP_MS,
  sleepMs,
} from './gracefulAgentExit';
import type { Agent, PlanningSession, Session, Shell } from '../types';
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
} from '../terminal-runtime/protocol';
import { SessionRuntime } from '../terminal-runtime/SessionRuntime';
import { TmuxTerminalRuntime } from '../terminal-runtime/TmuxTerminalRuntime';
import { SilenceDetector } from '../terminal-runtime/SilenceDetector';
import { PromptAutoresponder } from '../terminal-runtime/PromptAutoresponder';
import { buildTrustPromptAutoresponderRules } from '../terminal-runtime/trustPromptAutoresponderRules';
import type { SilenceState } from '../terminal-runtime/SilenceDetector';
import type { TerminalKind, TerminalRuntime } from '../types';
import {
  createTerminalRuntime,
  type AnyTerminalRuntime,
} from './tmux/terminalRuntimeFactory';
import { resolveFluxxTmuxSpawnLauncherPath } from './tmux/resolveFluxxTmuxSpawnLauncherPath';

function isTmuxRuntime(runtime: AnyTerminalRuntime): runtime is TmuxTerminalRuntime {
  return runtime.isTmuxBacked;
}

interface SessionEntry {
  runtime: AnyTerminalRuntime;
  tmuxSessionName?: string;
  session: Session;
  detector: SilenceDetector;
  autoresponder: PromptAutoresponder | null;
  agent: Agent;
}

interface ShellEntry {
  runtime: AnyTerminalRuntime;
  tmuxSessionName?: string;
  shell: Shell;
}

interface PlanningEntry {
  runtime: AnyTerminalRuntime;
  tmuxSessionName?: string;
  session: PlanningSession;
  autoresponder: PromptAutoresponder | null;
}

export interface TerminalRuntimeContext {
  persistTerminalsWithTmux: boolean;
  projectSlugSource: string;
}

export interface AppQuitConfirmInfo {
  needsConfirm: boolean;
  persistTmuxEnabled: boolean;
  directPtyCount: number;
  tmuxBackedCount: number;
}

export interface TerminalRuntimeMeta {
  runtime: TerminalRuntime;
  tmuxSessionName?: string;
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

export interface SessionPtyDataPayload {
  sessionId: string;
  taskId: string;
  projectId: string;
  agent: Agent;
  data: string;
}

export interface PlanningPtyDataPayload {
  sessionId: string;
  projectId: string;
  agent: Agent;
  data: string;
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
  onShellExit?: (shell: Shell) => void;
  onPlanningExit?: (session: PlanningSession) => void;
  /** Raw PTY bytes for task agent sessions (conversation id capture, etc.). */
  onSessionPtyData?: (payload: SessionPtyDataPayload) => void;
  /** Raw PTY bytes for planning agent sessions (conversation id capture, etc.). */
  onPlanningPtyData?: (payload: PlanningPtyDataPayload) => void;
  /** Per-call tmux persistence + naming (main process supplies active project). */
  resolveTerminalRuntimeContext?: () => TerminalRuntimeContext | null;
  /** Override launcher path (tests). */
  tmuxSpawnLauncherPath?: string;
}

/**
 * Main-process owner of local PTYs (task sessions, shells, planning). Registry
 * semantics match the historical detached-daemon core, without a separate process.
 */
type PtyExitTarget = { kind: 'session' | 'planning'; id: string };

export class TerminalRuntimeManager {
  private sessions = new Map<string, SessionEntry>();
  private shells = new Map<string, ShellEntry>();
  private planning = new Map<string, PlanningEntry>();
  private readonly exitWaiters = new Map<string, Array<() => void>>();
  private readonly deliverStreamFrame: (frame: StreamFrame) => void;
  private readonly onAgentState?: (sessionId: string, state: AgentState) => void;
  private readonly onSessionExit?: (session: Session) => void;
  private readonly onShellExit?: (shell: Shell) => void;
  private readonly onPlanningExit?: (session: PlanningSession) => void;
  private readonly onSessionPtyData?: (payload: SessionPtyDataPayload) => void;
  private readonly onPlanningPtyData?: (payload: PlanningPtyDataPayload) => void;
  private resolveTerminalRuntimeContext?: () => TerminalRuntimeContext | null;
  private readonly tmuxSpawnLauncherPath: string;

  constructor(opts: TerminalRuntimeManagerOptions = {}) {
    this.deliverStreamFrame = opts.deliverStreamFrame ?? deliverTerminalStreamFrameToRenderers;
    this.onAgentState = opts.onAgentState;
    this.onSessionExit = opts.onSessionExit;
    this.onShellExit = opts.onShellExit;
    this.onPlanningExit = opts.onPlanningExit;
    this.onSessionPtyData = opts.onSessionPtyData;
    this.onPlanningPtyData = opts.onPlanningPtyData;
    this.resolveTerminalRuntimeContext = opts.resolveTerminalRuntimeContext;
    this.tmuxSpawnLauncherPath =
      opts.tmuxSpawnLauncherPath ?? resolveFluxxTmuxSpawnLauncherPath();
  }

  setResolveTerminalRuntimeContext(
    resolver: (() => TerminalRuntimeContext | null) | undefined,
  ): void {
    this.resolveTerminalRuntimeContext = resolver;
  }

  private factoryContext(
    kind: TerminalKind,
    terminalId: string,
    projectSlugSource: string,
  ) {
    const ctx = this.resolveTerminalRuntimeContext?.();
    return {
      kind,
      terminalId,
      projectSlugSource: ctx?.projectSlugSource ?? projectSlugSource,
      persistTerminalsWithTmux: ctx?.persistTerminalsWithTmux === true,
      tmuxSpawnLauncherPath: this.tmuxSpawnLauncherPath,
    };
  }

  getTerminalRuntimeMeta(
    terminalId: string,
    kind: 'session' | 'shell' | 'planning',
  ): TerminalRuntimeMeta | null {
    if (kind === 'session') {
      const entry = this.sessions.get(terminalId);
      if (!entry) return null;
      return {
        runtime: isTmuxRuntime(entry.runtime) ? 'tmux' : 'node-pty',
        tmuxSessionName: entry.tmuxSessionName,
      };
    }
    if (kind === 'shell') {
      const entry = this.shells.get(terminalId);
      if (!entry) return null;
      return {
        runtime: isTmuxRuntime(entry.runtime) ? 'tmux' : 'node-pty',
        tmuxSessionName: entry.tmuxSessionName,
      };
    }
    const entry = this.planning.get(terminalId);
    if (!entry) return null;
    return {
      runtime: isTmuxRuntime(entry.runtime) ? 'tmux' : 'node-pty',
      tmuxSessionName: entry.tmuxSessionName,
    };
  }

  getAppQuitConfirmInfo(): AppQuitConfirmInfo {
    let directPtyCount = 0;
    let tmuxBackedCount = 0;
    const ctx = this.resolveTerminalRuntimeContext?.();
    const persistTmuxEnabled = ctx?.persistTerminalsWithTmux === true;

    for (const entry of this.sessions.values()) {
      if (entry.session.status !== 'running') continue;
      if (isTmuxRuntime(entry.runtime)) tmuxBackedCount += 1;
      else directPtyCount += 1;
    }
    for (const entry of this.shells.values()) {
      if (entry.shell.status !== 'running') continue;
      if (isTmuxRuntime(entry.runtime)) tmuxBackedCount += 1;
      else directPtyCount += 1;
    }
    for (const entry of this.planning.values()) {
      if (entry.session.status !== 'running') continue;
      if (isTmuxRuntime(entry.runtime)) tmuxBackedCount += 1;
      else directPtyCount += 1;
    }

    return {
      needsConfirm: directPtyCount + tmuxBackedCount > 0,
      persistTmuxEnabled,
      directPtyCount,
      tmuxBackedCount,
    };
  }

  private exitWaiterKey(target: PtyExitTarget): string {
    return `${target.kind}:${target.id}`;
  }

  private notifyExitWaiters(target: PtyExitTarget): void {
    const key = this.exitWaiterKey(target);
    const waiters = this.exitWaiters.get(key);
    if (!waiters) return;
    this.exitWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }

  private waitForPtyExit(target: PtyExitTarget, timeoutMs: number): Promise<void> {
    const entry =
      target.kind === 'session' ? this.sessions.get(target.id) : this.planning.get(target.id);
    if (!entry) return Promise.resolve();
    const status =
      target.kind === 'session'
        ? (entry as SessionEntry).session.status
        : (entry as PlanningEntry).session.status;
    if (status !== 'running' || entry.runtime.isExited) return Promise.resolve();

    return Promise.race([
      new Promise<void>((resolve) => {
        const key = this.exitWaiterKey(target);
        const list = this.exitWaiters.get(key) ?? [];
        list.push(resolve);
        this.exitWaiters.set(key, list);
      }),
      sleepMs(timeoutMs),
    ]);
  }

  private requestGracefulAgentExit(target: PtyExitTarget): void {
    const entry =
      target.kind === 'session' ? this.sessions.get(target.id) : this.planning.get(target.id);
    if (!entry) return;
    entry.runtime.interrupt();
  }

  private ptyTargetStillRunning(target: PtyExitTarget): boolean {
    const entry =
      target.kind === 'session' ? this.sessions.get(target.id) : this.planning.get(target.id);
    if (!entry) return false;
    const status =
      target.kind === 'session'
        ? (entry as SessionEntry).session.status
        : (entry as PlanningEntry).session.status;
    return status === 'running' && !entry.runtime.isExited;
  }

  /** Send up to two Ctrl+C bursts; first often cancels the turn, second exits and prints resume id. */
  private async gracefulAgentExitTarget(target: PtyExitTarget, timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return;
    const deadline = Date.now() + timeoutMs;

    for (let i = 0; i < GRACEFUL_QUIT_AGENT_INTERRUPT_COUNT; i++) {
      if (!this.ptyTargetStillRunning(target) || Date.now() >= deadline) return;

      this.requestGracefulAgentExit(target);

      const remaining = deadline - Date.now();
      if (remaining <= 0) return;

      const waitMs =
        i < GRACEFUL_QUIT_AGENT_INTERRUPT_COUNT - 1
          ? Math.min(GRACEFUL_QUIT_INTERRUPT_GAP_MS, remaining)
          : remaining;
      await this.waitForPtyExit(target, waitMs);
    }
  }

  private emitFrame(frame: StreamFrame): void {
    if (frame.kind === 'agent-state') {
      this.onAgentState?.(frame.id, frame.state);
    }
    if (frame.kind === 'session-exit') {
      this.notifyExitWaiters({ kind: 'session', id: frame.id });
      this.onSessionExit?.(frame.session);
    }
    if (frame.kind === 'shell-exit') {
      this.onShellExit?.(frame.shell);
    }
    if (frame.kind === 'planning-exit') {
      this.notifyExitWaiters({ kind: 'planning', id: frame.id });
      this.onPlanningExit?.(frame.session);
    }
    this.deliverStreamFrame(frame);
  }

  // ------------------------------------------------------------------- sessions

  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
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

    let runtime: AnyTerminalRuntime;
    let tmuxSessionName: string | undefined;
    try {
      const spawned = await createTerminalRuntime(
        this.factoryContext('task', id, params.projectId),
        {
          command: params.command,
          args: params.args,
          cwd: params.worktreePath,
          cols: params.cols,
          rows: params.rows,
          env: {
            ...process.env,
            HOME: process.env.HOME ?? os.homedir(),
            ...(params.ptyEnv ?? {}),
          },
          termProgram: 'kitty',
        },
        {
          onData: (data, seq) => {
            this.emitFrame({ kind: 'data', target: 'session', id, data, seq });
            detector.onData();
            autoresponder?.notifyPtyData();
            this.onSessionPtyData?.({
              sessionId: id,
              taskId: params.taskId,
              projectId: params.projectId,
              agent: params.agent,
              data,
            });
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
      runtime = spawned.runtime;
      tmuxSessionName = spawned.tmuxSessionName;
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

    this.sessions.set(id, {
      runtime,
      tmuxSessionName,
      session,
      detector,
      autoresponder,
      agent: params.agent,
    });
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

  async createShell(params: CreateShellParams): Promise<Shell> {
    const id = randomUUID();
    const { command, args } = defaultShellCommand();
    const shell: Shell = {
      id,
      sessionId: params.sessionId,
      worktreePath: params.worktreePath,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const parent = this.sessions.get(params.sessionId);
    const projectSlugSource = parent?.session.projectId ?? 'project';

    const { runtime, tmuxSessionName } = await createTerminalRuntime(
      this.factoryContext('shell', id, projectSlugSource),
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

    this.shells.set(id, { runtime, tmuxSessionName, shell });
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

  async startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
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

    let runtime: AnyTerminalRuntime;
    let tmuxSessionName: string | undefined;
    try {
      const spawned = await createTerminalRuntime(
        this.factoryContext('planning', id, params.projectId),
        {
          command: params.command,
          args: params.args,
          cwd: params.planningDir,
          cols: params.cols,
          rows: params.rows,
          env: {
            ...process.env,
            HOME: process.env.HOME ?? os.homedir(),
            ...(params.ptyEnv ?? {}),
          },
          termProgram: 'kitty',
        },
        {
          onData: (data, seq) => {
            this.emitFrame({ kind: 'data', target: 'planning', id, data, seq });
            autoresponder?.notifyPtyData();
            this.onPlanningPtyData?.({
              sessionId: id,
              projectId: params.projectId,
              agent: params.agent,
              data,
            });
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
      runtime = spawned.runtime;
      tmuxSessionName = spawned.tmuxSessionName;
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

    this.planning.set(id, { runtime, tmuxSessionName, session, autoresponder });
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
   * App quit: when tmux persistence is off, interrupt resumable direct agent PTYs
   * (double Ctrl+C) before teardown. When tmux persistence is on, skip interrupts —
   * agents keep running in tmux or legacy direct PTYs are released without capture.
   */
  async gracefulShutdownForAppQuit(deadlineMs: number): Promise<void> {
    const started = Date.now();
    const remainingMs = () => Math.max(0, deadlineMs - (Date.now() - started));

    const persistTmuxEnabled =
      this.resolveTerminalRuntimeContext?.()?.persistTerminalsWithTmux === true;

    const targets: PtyExitTarget[] = [];
    if (!persistTmuxEnabled) {
      for (const [id, entry] of this.sessions) {
        if (entry.session.status !== 'running') continue;
        if (!agentSupportsGracefulQuitCapture(entry.agent)) continue;
        targets.push({ kind: 'session', id });
      }
      for (const [id, entry] of this.planning) {
        if (entry.session.status !== 'running') continue;
        if (!agentSupportsGracefulQuitCapture(entry.session.agent)) continue;
        targets.push({ kind: 'planning', id });
      }
    }

    if (targets.length > 0 && remainingMs() > 0) {
      const perTargetMs = Math.min(800, Math.floor(remainingMs() / targets.length));
      await Promise.allSettled(
        targets.map(async (target) => {
          const budget = Math.min(perTargetMs, remainingMs());
          if (budget <= 0) return;
          await this.gracefulAgentExitTarget(target, budget);
        }),
      );
    }

    const drainMs = Math.min(250, remainingMs());
    if (drainMs > 0) await sleepMs(drainMs);

    this.releaseRegistriesForAppQuit();
  }

  /**
   * Full app quit: graceful-stop direct agent PTYs, detach tmux attach bridges
   * without killing Fluxx-owned tmux sessions, then clear registries.
   */
  releaseRegistriesForAppQuit(): void {
    for (const entry of [...this.sessions.values()]) {
      entry.detector.dispose();
      entry.autoresponder?.dispose();
      if (isTmuxRuntime(entry.runtime)) entry.runtime.detachAttachBridgeForAppQuit();
      else entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.sessions.clear();
    for (const entry of [...this.shells.values()]) {
      if (isTmuxRuntime(entry.runtime)) entry.runtime.detachAttachBridgeForAppQuit();
      else entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.shells.clear();
    for (const entry of [...this.planning.values()]) {
      entry.autoresponder?.dispose();
      if (isTmuxRuntime(entry.runtime)) entry.runtime.detachAttachBridgeForAppQuit();
      else entry.runtime.kill();
      entry.runtime.dispose();
    }
    this.planning.clear();
  }

  /**
   * Kill and dispose every registered PTY (shells, planning, and task sessions),
   * including tmux sessions. Used for explicit stop/delete — not app quit.
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
