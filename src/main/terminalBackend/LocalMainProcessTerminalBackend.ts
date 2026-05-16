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
  StreamFrame,
} from '../../terminal-runtime/protocol';
import {
  deliverTerminalStreamFrameToRenderers,
  TerminalRuntimeManager,
  type SessionPtyDataPayload,
  type TerminalRuntimeManagerOptions,
} from '../TerminalRuntimeManager';
import type {
  TerminalBackend,
  TerminalSessionLifecycleHooks,
  TerminalSilenceSnapshotReason,
} from './TerminalBackend';

const SILENCE_POLL_MS = 30_000;

function stripTerminalControlSequences(data: string): string {
  /* eslint-disable no-control-regex -- strip OSC sequences and CSI SGR from stream text */
  const withoutOsc = data.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
  const withoutCsi = withoutOsc.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  /* eslint-enable no-control-regex */
  return withoutCsi;
}

/**
 * In-process PTYs via {@link TerminalRuntimeManager}. Local paths and `node-pty` spawn
 * stay inside this implementation — not in IPC handlers.
 */
export class LocalMainProcessTerminalBackend implements TerminalBackend {
  private readonly mgr: TerminalRuntimeManager;
  private hooks: TerminalSessionLifecycleHooks | null = null;
  private silencePollInterval: ReturnType<typeof setInterval> | null = null;
  private sessionPtyDataHook: ((payload: SessionPtyDataPayload) => void) | null = null;
  private readonly sessionOutputTextWaiters = new Map<
    string,
    Array<{ needle: string; data: string; seen: string }>
  >();

  constructor(opts: TerminalRuntimeManagerOptions = {}) {
    const baseDeliver = opts.deliverStreamFrame ?? deliverTerminalStreamFrameToRenderers;
    this.mgr = new TerminalRuntimeManager({
      ...opts,
      deliverStreamFrame: (frame: StreamFrame) => {
        if (frame.kind === 'data' && frame.target === 'session') {
          this.resolveSessionOutputTextWaiters(frame.id, frame.data);
        }
        baseDeliver(frame);
      },
      onAgentState: (sessionId, state) => {
        opts.onAgentState?.(sessionId, state);
        this.hooks?.onAgentState?.(sessionId, state);
      },
      onSessionExit: (session) => {
        opts.onSessionExit?.(session);
        this.hooks?.onSessionExit?.(session);
      },
      onSessionPtyData: (payload) => {
        opts.onSessionPtyData?.(payload);
        this.sessionPtyDataHook?.(payload);
      },
    });
  }

  setSessionPtyDataHook(hook: ((payload: SessionPtyDataPayload) => void) | null): void {
    this.sessionPtyDataHook = hook;
  }

  ensureReady(): Promise<void> {
    return Promise.resolve();
  }

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void {
    this.hooks = hooks;
    this.restartSilencePollIfNeeded();
  }

  startSilenceSnapshotPolling(): void {
    this.restartSilencePollIfNeeded();
  }

  onMainProcessBeforeQuit(): void {
    this.clearSilencePoll();
    this.mgr.shutdownAllPtys();
  }

  async shouldConfirmAppQuit(): Promise<boolean> {
    return this.mgr.liveMainProcessPtyCount() > 0;
  }

  async teardownForAppQuit(): Promise<void> {
    this.onMainProcessBeforeQuit();
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
      const meta: { reason: TerminalSilenceSnapshotReason } = { reason: 'poll' };
      await fn(states, meta);
    } catch {
      /* ignore */
    }
  }

  private resolveSessionOutputTextWaiters(id: string, chunk: string): void {
    const waiters = this.sessionOutputTextWaiters.get(id);
    if (!waiters || waiters.length === 0) return;
    const text = stripTerminalControlSequences(chunk);
    const pending: Array<{ needle: string; data: string; seen: string }> = [];
    for (const waiter of waiters) {
      const seen = `${waiter.seen}${text}`.slice(-8000);
      if (seen.includes(waiter.needle)) {
        this.writeSession(id, waiter.data);
      } else {
        pending.push({ ...waiter, seen });
      }
    }
    if (pending.length > 0) this.sessionOutputTextWaiters.set(id, pending);
    else this.sessionOutputTextWaiters.delete(id);
  }

  createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    return Promise.resolve(this.mgr.createSession(params));
  }

  listSessions(): Promise<Session[]> {
    return Promise.resolve(this.mgr.listSessions());
  }

  getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]> {
    return Promise.resolve(this.mgr.getSessionSilenceStates());
  }

  attachSession(id: string): Promise<AttachResult | null> {
    return this.mgr.attachSession(id);
  }

  async stopSession(id: string): Promise<void> {
    this.sessionOutputTextWaiters.delete(id);
    this.mgr.stopSession(id);
  }

  writeSession(id: string, data: string): void {
    this.mgr.writeSession(id, data);
  }

  async writeSessionAwait(id: string, data: string): Promise<void> {
    await this.mgr.writeSessionAwait(id, data);
  }

  writeSessionAfterOutputText(id: string, needle: string, data: string): void {
    const normalizedNeedle = needle.trim();
    if (!normalizedNeedle) {
      this.writeSession(id, data);
      return;
    }
    const waiters = this.sessionOutputTextWaiters.get(id) ?? [];
    waiters.push({ needle: normalizedNeedle, data, seen: '' });
    this.sessionOutputTextWaiters.set(id, waiters);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    this.mgr.resizeSession(id, cols, rows);
  }

  createShell(params: CreateShellParams): Promise<Shell> {
    return Promise.resolve(this.mgr.createShell(params));
  }

  listShells(sessionId: string): Promise<Shell[]> {
    return Promise.resolve(this.mgr.listShells(sessionId));
  }

  attachShell(id: string): Promise<AttachResult | null> {
    return this.mgr.attachShell(id);
  }

  writeShell(id: string, data: string): void {
    this.mgr.writeShell(id, data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    this.mgr.resizeShell(id, cols, rows);
  }

  async closeShell(id: string): Promise<void> {
    this.mgr.closeShell(id);
  }

  async closeShellsForSession(sessionId: string): Promise<void> {
    this.mgr.closeShellsForSession(sessionId);
  }

  startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
    return Promise.resolve(this.mgr.startPlanning(params));
  }

  listPlanning(): Promise<PlanningSession[]> {
    return Promise.resolve(this.mgr.listPlanning());
  }

  getPlanning(id: string): Promise<PlanningSession | null> {
    return Promise.resolve(this.mgr.getPlanning(id));
  }

  attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    return this.mgr.attachPlanning(id);
  }

  writePlanning(id: string, data: string): void {
    this.mgr.writePlanning(id, data);
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    this.mgr.resizePlanning(id, cols, rows);
  }

  async stopPlanning(id: string): Promise<void> {
    this.mgr.stopPlanning(id);
  }
}
