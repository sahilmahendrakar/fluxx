import type { PlanningSession, Session, Shell } from '../../types';
import type { SessionPtyDataPayload } from '../TerminalRuntimeManager';
import type {
  AgentState,
  AttachResult,
  CreateSessionParams,
  CreateSessionResult,
  CreateShellParams,
  PlanningAttachResult,
  StartPlanningParams,
  StartPlanningResult,
} from '../../terminal-runtime/protocol';

/** Why snapshots run on a timer instead of only on stream events. */
export type TerminalSilenceSnapshotReason = 'poll';

export interface TerminalSessionLifecycleHooks {
  onAgentState?: (sessionId: string, state: AgentState) => void;
  onSessionExit?: (session: Session) => void;
  onSilenceStatesSnapshot?: (
    states: { id: string; taskId?: string; state: AgentState }[],
    meta: { reason: TerminalSilenceSnapshotReason },
  ) => void | Promise<void>;
}

/**
 * Neutral terminal runtime surface for task sessions, interactive shells, and planning
 * PTYs. Main IPC should depend on this type — not on a concrete process model — so a
 * future cloud/remote runner can swap in behind the same handlers.
 *
 * **Local-only today (Electron main PTY):** absolute `worktreePath` / `planningDir`,
 * spawning a local CLI, SIGWINCH resize, `process.kill` teardown, and app quit
 * confirmation are all host decisions.
 *
 * **Future remote/cloud backend would need:** a stable logical worktree/cwd key (not
 * necessarily a local path), a duplex transport (e.g. WebSocket) for PTY I/O and control
 * frames mirroring `StreamFrame` in `terminal-runtime/protocol.ts`, remote stop and
 * cleanup RPCs, and silence/agent-status events pushed or polled from the service.
 *
 * Renderer IPC channel names (`session:data:*`, …) stay stable; only this main-process
 * implementation changes.
 */
export interface TerminalBackend {
  /** Ensures the backend can accept RPC-style calls (no-op for in-process PTYs). */
  ensureReady(): Promise<void>;

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void;

  /**
   * Local in-process PTYs only: stream raw task-session PTY bytes (conversation id capture).
   * Detached / remote backends omit this hook.
   */
  setSessionPtyDataHook?(hook: ((payload: SessionPtyDataPayload) => void) | null): void;

  /** Low-frequency silence reconciliation when {@link TerminalSessionLifecycleHooks.onSilenceStatesSnapshot} is set. */
  startSilenceSnapshotPolling(): void;

  /**
   * Electron `before-quit`: in-process PTYs should exit with the app.
   *
   * Prefer {@link teardownForAppQuit} from the main-process quit path so sessions
   * are stopped on full app quit.
   */
  onMainProcessBeforeQuit(): void;

  /** True when quitting would stop visible in-flight local work (optional confirmation). */
  shouldConfirmAppQuit(): Promise<boolean>;

  /**
   * Full app quit: stop all terminal runtime sessions (bounded by the caller).
   * Idempotent with respect to local PTYs.
   */
  teardownForAppQuit(): Promise<void>;

  createSession(params: CreateSessionParams): Promise<CreateSessionResult>;
  listSessions(): Promise<Session[]>;
  getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]>;
  attachSession(id: string): Promise<AttachResult | null>;
  stopSession(id: string): Promise<void>;
  writeSession(id: string, data: string): void;
  writeSessionAwait(id: string, data: string): Promise<void>;
  writeSessionAfterOutputText(id: string, needle: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;

  createShell(params: CreateShellParams): Promise<Shell>;
  listShells(sessionId: string): Promise<Shell[]>;
  attachShell(id: string): Promise<AttachResult | null>;
  writeShell(id: string, data: string): void;
  resizeShell(id: string, cols: number, rows: number): void;
  closeShell(id: string): Promise<void>;
  closeShellsForSession(sessionId: string): Promise<void>;

  startPlanning(params: StartPlanningParams): Promise<StartPlanningResult>;
  listPlanning(): Promise<PlanningSession[]>;
  getPlanning(id: string): Promise<PlanningSession | null>;
  attachPlanning(id: string): Promise<PlanningAttachResult | null>;
  writePlanning(id: string, data: string): void;
  resizePlanning(id: string, cols: number, rows: number): void;
  stopPlanning(id: string): Promise<void>;
}
