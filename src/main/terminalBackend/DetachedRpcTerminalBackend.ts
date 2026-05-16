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
import { DaemonClient } from '../DaemonClient';
import type {
  TerminalBackend,
  TerminalSessionLifecycleHooks,
} from './TerminalBackend';

/**
 * Terminal backend backed by the legacy detached child process (NDJSON RPC + stream).
 * Keeps warm-reattach semantics on app quit — see {@link DaemonClient.disconnect}.
 */
export class DetachedRpcTerminalBackend implements TerminalBackend {
  constructor(private readonly client: DaemonClient) {}

  ensureReady(): Promise<void> {
    return this.client.ensureRunning();
  }

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void {
    if (!hooks) {
      this.client.onAgentState = null;
      this.client.onSessionExit = null;
      this.client.onSilenceStatesSnapshot = null;
      return;
    }
    this.client.onAgentState = hooks.onAgentState ?? null;
    this.client.onSessionExit = hooks.onSessionExit ?? null;
    this.client.onSilenceStatesSnapshot = hooks.onSilenceStatesSnapshot ?? null;
  }

  startSilenceSnapshotPolling(): void {
    this.client.startSilencePolling();
  }

  onMainProcessBeforeQuit(): void {
    /* Detached PTYs intentionally survive Flux quit. */
  }

  createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    return this.client.createSession(params);
  }

  listSessions(): Promise<Session[]> {
    return this.client.listSessions();
  }

  getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]> {
    return this.client.getSessionSilenceStates();
  }

  attachSession(id: string): Promise<AttachResult | null> {
    return this.client.attachSession(id);
  }

  stopSession(id: string): Promise<void> {
    return this.client.stopSession(id);
  }

  writeSession(id: string, data: string): void {
    this.client.writeSession(id, data);
  }

  writeSessionAwait(id: string, data: string): Promise<void> {
    return this.client.writeSessionAwait(id, data);
  }

  writeSessionAfterOutputText(id: string, needle: string, data: string): void {
    this.client.writeSessionAfterOutputText(id, needle, data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    this.client.resizeSession(id, cols, rows);
  }

  createShell(params: CreateShellParams): Promise<Shell> {
    return this.client.createShell(params);
  }

  listShells(sessionId: string): Promise<Shell[]> {
    return this.client.listShells(sessionId);
  }

  attachShell(id: string): Promise<AttachResult | null> {
    return this.client.attachShell(id);
  }

  writeShell(id: string, data: string): void {
    this.client.writeShell(id, data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    this.client.resizeShell(id, cols, rows);
  }

  closeShell(id: string): Promise<void> {
    return this.client.closeShell(id);
  }

  closeShellsForSession(sessionId: string): Promise<void> {
    return this.client.closeShellsForSession(sessionId);
  }

  startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
    return this.client.startPlanning(params);
  }

  listPlanning(): Promise<PlanningSession[]> {
    return this.client.listPlanning();
  }

  getPlanning(id: string): Promise<PlanningSession | null> {
    return this.client.getPlanning(id);
  }

  attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    return this.client.attachPlanning(id);
  }

  writePlanning(id: string, data: string): void {
    this.client.writePlanning(id, data);
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    this.client.resizePlanning(id, cols, rows);
  }

  stopPlanning(id: string): Promise<void> {
    return this.client.stopPlanning(id);
  }
}
