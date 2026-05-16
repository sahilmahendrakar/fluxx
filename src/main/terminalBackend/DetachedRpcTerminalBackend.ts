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
import {
  deliverTerminalStreamFrameToRenderers,
  TerminalRuntimeManager,
} from '../TerminalRuntimeManager';
import type {
  TerminalBackend,
  TerminalSessionLifecycleHooks,
} from './TerminalBackend';

/**
 * Task agent sessions use the legacy detached child (NDJSON RPC + stream).
 * Shell panes and planning PTYs run in the Electron main process so they do not
 * depend on the daemon (see {@link TerminalRuntimeManager}).
 */
export class DetachedRpcTerminalBackend implements TerminalBackend {
  private readonly localShellPlanning: TerminalRuntimeManager;

  constructor(private readonly client: DaemonClient) {
    this.localShellPlanning = new TerminalRuntimeManager({
      deliverStreamFrame: deliverTerminalStreamFrameToRenderers,
    });
  }

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
    this.localShellPlanning.shutdownAllPtys();
  }

  async shouldConfirmAppQuit(): Promise<boolean> {
    if (this.localShellPlanning.liveMainProcessPtyCount() > 0) return true;
    const sessions = await this.client.tryListSessionsForQuitConfirmation(800);
    return sessions != null && sessions.some((s) => s.status === 'running');
  }

  async teardownForAppQuit(): Promise<void> {
    this.localShellPlanning.shutdownAllPtys();
    await this.client.requestDaemonShutdownForAppQuit();
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
    return Promise.resolve(this.localShellPlanning.createShell(params));
  }

  listShells(sessionId: string): Promise<Shell[]> {
    return Promise.resolve(this.localShellPlanning.listShells(sessionId));
  }

  attachShell(id: string): Promise<AttachResult | null> {
    return this.localShellPlanning.attachShell(id);
  }

  writeShell(id: string, data: string): void {
    this.localShellPlanning.writeShell(id, data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    this.localShellPlanning.resizeShell(id, cols, rows);
  }

  async closeShell(id: string): Promise<void> {
    this.localShellPlanning.closeShell(id);
  }

  async closeShellsForSession(sessionId: string): Promise<void> {
    this.localShellPlanning.closeShellsForSession(sessionId);
  }

  startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
    return Promise.resolve(this.localShellPlanning.startPlanning(params));
  }

  listPlanning(): Promise<PlanningSession[]> {
    return Promise.resolve(this.localShellPlanning.listPlanning());
  }

  getPlanning(id: string): Promise<PlanningSession | null> {
    return Promise.resolve(this.localShellPlanning.getPlanning(id));
  }

  attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    return this.localShellPlanning.attachPlanning(id);
  }

  writePlanning(id: string, data: string): void {
    this.localShellPlanning.writePlanning(id, data);
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    this.localShellPlanning.resizePlanning(id, cols, rows);
  }

  async stopPlanning(id: string): Promise<void> {
    this.localShellPlanning.stopPlanning(id);
  }
}
