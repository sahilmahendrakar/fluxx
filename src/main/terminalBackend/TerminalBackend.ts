import type { PlanningSession, Session, Shell } from '../../types';
import type {
  AgentState,
  AttachResult,
  CreateSessionParams,
  CreateSessionResult,
  CreateShellParams,
  PlanningAttachResult,
  StartPlanningParams,
  StartPlanningResult,
} from '../../daemon/protocol';

/**
 * Why `poll` vs `stream-reconnect`: detached RPC backends may lose a stream socket
 * and reconcile silence state after reconnect; in-process PTYs typically only use `poll`.
 */
export type TerminalSilenceSnapshotReason = 'poll' | 'stream-reconnect';

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
 * **Local-only today (Electron main PTY or legacy detached child):** absolute
 * `worktreePath` / `planningDir`, spawning a local CLI, SIGWINCH resize, `process.kill`
 * teardown, and "full app quit" vs "leave PTYs running" are all host decisions.
 *
 * **Future remote/cloud backend would need:** a stable logical worktree/cwd key (not
 * necessarily a local path), a duplex transport (e.g. WebSocket) for PTY I/O and control
 * frames mirroring `StreamFrame` in `daemon/protocol.ts`, remote stop and cleanup RPCs,
 * and silence/agent-status events pushed or polled from the service.
 *
 * Renderer IPC channel names (`session:data:*`, …) stay stable; only this main-process
 * implementation changes.
 */
export interface TerminalBackend {
  /** Ensures the backend can accept RPC-style calls (no-op for in-process PTYs). */
  ensureReady(): Promise<void>;

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void;

  /** Low-frequency silence reconciliation when {@link TerminalSessionLifecycleHooks.onSilenceStatesSnapshot} is set. */
  startSilenceSnapshotPolling(): void;

  /**
   * Electron `before-quit`: in-process PTYs should exit with the app; detached backends
   * may intentionally leave remote PTYs running (legacy daemon semantics).
   *
   * Prefer {@link teardownForAppQuit} from the main-process quit path so daemon-backed
   * sessions and the legacy daemon itself are stopped on full app quit.
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
