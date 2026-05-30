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
} from '../../terminal-runtime/protocol';
import type {
  TerminalBackend,
  TerminalSessionLifecycleHooks,
} from './TerminalBackend';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import { SshTerminalBackend } from './SshTerminalBackend';

const SILENCE_POLL_MS = 30_000;

/**
 * Routes task/shell terminal IPC to local PTYs or SSH attach bridges based on
 * session ownership.
 */
export class RoutingTerminalBackend implements TerminalBackend {
  private hooks: TerminalSessionLifecycleHooks | null = null;
  private silencePollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly local: LocalMainProcessTerminalBackend,
    readonly ssh: SshTerminalBackend,
  ) {}

  private isSshSession(id: string): boolean {
    return this.ssh.hasSession(id);
  }

  private isSshShell(id: string): boolean {
    return this.ssh.hasShell(id);
  }

  ensureReady(): Promise<void> {
    return Promise.all([this.local.ensureReady(), this.ssh.ensureReady()]).then(() => undefined);
  }

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void {
    this.hooks = hooks;
    this.local.setSessionLifecycleHooks(hooks);
    this.ssh.setSessionLifecycleHooks(hooks);
    this.restartSilencePollIfNeeded();
  }

  setSessionPtyDataHook(
    hook: Parameters<NonNullable<TerminalBackend['setSessionPtyDataHook']>>[0],
  ): void {
    this.local.setSessionPtyDataHook?.(hook ?? null);
  }

  setPlanningPtyDataHook(
    hook: Parameters<NonNullable<TerminalBackend['setPlanningPtyDataHook']>>[0],
  ): void {
    this.local.setPlanningPtyDataHook?.(hook ?? null);
  }

  startSilenceSnapshotPolling(): void {
    this.local.startSilenceSnapshotPolling();
    this.restartSilencePollIfNeeded();
  }

  onMainProcessBeforeQuit(): void {
    this.clearSilencePoll();
    this.local.onMainProcessBeforeQuit();
    this.ssh.onMainProcessBeforeQuit();
  }

  async shouldConfirmAppQuit(): Promise<boolean> {
    const local = await this.local.shouldConfirmAppQuit();
    return local;
  }

  getAppQuitConfirmInfo() {
    const localInfo = this.local.getAppQuitConfirmInfo?.() ?? {
      needsConfirm: false,
      persistTmuxEnabled: false,
      directPtyCount: 0,
      tmuxBackedCount: 0,
    };
    const remoteTmuxCount = this.ssh.countRunningTaskSessions();
    if (remoteTmuxCount > 0 && !localInfo.needsConfirm) {
      return { ...localInfo, needsConfirm: false, remoteTmuxBackedCount: remoteTmuxCount };
    }
    return { ...localInfo, remoteTmuxBackedCount: remoteTmuxCount };
  }

  getTerminalRuntimeMeta(
    terminalId: string,
    kind: 'session' | 'shell' | 'planning',
  ) {
    if (kind === 'session' && this.isSshSession(terminalId)) {
      return { runtime: 'tmux' as const };
    }
    if (kind === 'shell' && this.isSshShell(terminalId)) {
      return { runtime: 'tmux' as const };
    }
    return this.local.getTerminalRuntimeMeta?.(terminalId, kind) ?? null;
  }

  async teardownForAppQuit(deadlineMs?: number): Promise<void> {
    this.clearSilencePoll();
    this.ssh.onMainProcessBeforeQuit();
    await this.local.teardownForAppQuit(deadlineMs);
  }

  createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    return this.local.createSession(params);
  }

  async listSessions(): Promise<Session[]> {
    const [localSessions, sshSessions] = await Promise.all([
      this.local.listSessions(),
      this.ssh.listSessions(),
    ]);
    return [...localSessions, ...sshSessions];
  }

  async getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]> {
    const [localStates, sshStates] = await Promise.all([
      this.local.getSessionSilenceStates(),
      this.ssh.getSessionSilenceStates(),
    ]);
    return [...localStates, ...sshStates];
  }

  attachSession(id: string): Promise<AttachResult | null> {
    if (this.isSshSession(id)) return this.ssh.attachSession(id);
    return this.local.attachSession(id);
  }

  stopSession(id: string): Promise<void> {
    if (this.isSshSession(id)) return this.ssh.stopSession(id);
    return this.local.stopSession(id);
  }

  writeSession(id: string, data: string): void {
    if (this.isSshSession(id)) {
      this.ssh.writeSession(id, data);
      return;
    }
    this.local.writeSession(id, data);
  }

  writeSessionAwait(id: string, data: string): Promise<void> {
    if (this.isSshSession(id)) return this.ssh.writeSessionAwait(id, data);
    return this.local.writeSessionAwait(id, data);
  }

  writeSessionAfterOutputText(id: string, needle: string, data: string): void {
    if (this.isSshSession(id)) {
      this.ssh.writeSessionAfterOutputText(id, needle, data);
      return;
    }
    this.local.writeSessionAfterOutputText(id, needle, data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    if (this.isSshSession(id)) {
      this.ssh.resizeSession(id, cols, rows);
      return;
    }
    this.local.resizeSession(id, cols, rows);
  }

  createShell(params: CreateShellParams): Promise<Shell> {
    if (this.isSshSession(params.sessionId) && params.placement !== 'local') {
      return this.ssh.createShell(params);
    }
    return this.local.createShell(params);
  }

  async listShells(sessionId: string): Promise<Shell[]> {
    if (this.isSshSession(sessionId)) {
      const [remote, local] = await Promise.all([
        this.ssh.listShells(sessionId),
        this.local.listShells(sessionId),
      ]);
      return [...remote, ...local];
    }
    return this.local.listShells(sessionId);
  }

  attachShell(id: string): Promise<AttachResult | null> {
    if (this.isSshShell(id)) return this.ssh.attachShell(id);
    return this.local.attachShell(id);
  }

  writeShell(id: string, data: string): void {
    if (this.isSshShell(id)) {
      this.ssh.writeShell(id, data);
      return;
    }
    this.local.writeShell(id, data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    if (this.isSshShell(id)) {
      this.ssh.resizeShell(id, cols, rows);
      return;
    }
    this.local.resizeShell(id, cols, rows);
  }

  closeShell(id: string): Promise<void> {
    if (this.isSshShell(id)) return this.ssh.closeShell(id);
    return this.local.closeShell(id);
  }

  async closeShellsForSession(sessionId: string): Promise<void> {
    if (this.isSshSession(sessionId)) {
      await Promise.all([
        this.ssh.closeShellsForSession(sessionId),
        this.local.closeShellsForSession(sessionId),
      ]);
      return;
    }
    await this.local.closeShellsForSession(sessionId);
  }

  startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
    return this.local.startPlanning(params);
  }

  listPlanning(): Promise<PlanningSession[]> {
    return this.local.listPlanning();
  }

  getPlanning(id: string): Promise<PlanningSession | null> {
    return this.local.getPlanning(id);
  }

  attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    return this.local.attachPlanning(id);
  }

  writePlanning(id: string, data: string): void {
    this.local.writePlanning(id, data);
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    this.local.resizePlanning(id, cols, rows);
  }

  stopPlanning(id: string): Promise<void> {
    return this.local.stopPlanning(id);
  }

  notifyAppearanceChange(resolved: import('../../theme/appearance').ResolvedAppearance): void {
    this.local.notifyAppearanceChange(resolved);
  }

  reconcileTmuxPersistedTerminals(
    params: NonNullable<Parameters<NonNullable<TerminalBackend['reconcileTmuxPersistedTerminals']>>[0]>,
  ) {
    return this.local.reconcileTmuxPersistedTerminals!(params);
  }

  setResolveTerminalRuntimeContext(
    resolver: Parameters<LocalMainProcessTerminalBackend['setResolveTerminalRuntimeContext']>[0],
  ): void {
    this.local.setResolveTerminalRuntimeContext(resolver);
  }

  private restartSilencePollIfNeeded(): void {
    this.clearSilencePoll();
    if (!this.hooks?.onSilenceStatesSnapshot) return;
    this.silencePollInterval = setInterval(
      () => void this.runSilencePollTick(),
      SILENCE_POLL_MS,
    );
    this.silencePollInterval.unref?.();
  }

  private clearSilencePoll(): void {
    if (this.silencePollInterval) {
      clearInterval(this.silencePollInterval);
      this.silencePollInterval = null;
    }
  }

  private async runSilencePollTick(): Promise<void> {
    const fn = this.hooks?.onSilenceStatesSnapshot;
    if (!fn) return;
    try {
      const states = await this.getSessionSilenceStates();
      await fn(states, { reason: 'poll' });
    } catch {
      /* ignore */
    }
  }
}
