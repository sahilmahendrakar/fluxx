import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {
  Agent,
  ExecutionDeviceConfig,
  PlanningSession,
  Session,
  Shell,
} from '../../types';
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
import { SilenceDetector } from '../../terminal-runtime/SilenceDetector';
import { PromptAutoresponder } from '../../terminal-runtime/PromptAutoresponder';
import {
  buildTrustPromptAutoresponderRules,
  TRUST_PROMPT_AUTORESPOND_SSH_TTL_MS,
} from '../../terminal-runtime/trustPromptAutoresponderRules';
import { buildFluxxTmuxSessionName } from '../tmux/tmuxSessionName';
import type { DeviceStore } from '../DeviceStore';
import type {
  TerminalBackend,
  TerminalSessionLifecycleHooks,
  TerminalSilenceSnapshotReason,
} from '../terminalBackend/TerminalBackend';
import { deliverTerminalStreamFrameToRenderers } from '../TerminalRuntimeManager';
import { RemoteHelperClient } from '../ssh/RemoteHelperClient';
import { SshAttachBridge } from '../ssh/SshAttachBridge';
import { deviceProbeHostLabel } from '../ssh/opensshRunner';
import { collapsedBottomScreenText } from '../../terminal-runtime/renderedScreenText';
import type {
  RemoteHelperStartShellData,
  RemoteHelperStopTerminalData,
} from '../ssh/remoteHelperProtocol';

type SshTaskEntry = {
  session: Session;
  deviceId: string;
  tmuxSessionName: string;
  agent?: Agent;
  bridge: SshAttachBridge | null;
  detector: SilenceDetector | null;
  autoresponder: PromptAutoresponder | null;
  trustPromptAutorespond: boolean;
  trustPromptAutorespondRoots: string[];
  cols: number;
  rows: number;
};

type SshShellEntry = {
  shell: Shell;
  deviceId: string;
  tmuxSessionName: string;
  bridge: SshAttachBridge | null;
  cols: number;
  rows: number;
};

export type SshTerminalBackendOptions = {
  deviceStore: DeviceStore;
  helper?: RemoteHelperClient;
  deliverStreamFrame?: (frame: StreamFrame) => void;
};

export type RegisterRemoteTaskSessionInput = {
  session: Session;
  deviceId: string;
  tmuxSessionName: string;
  agent?: Agent;
  cols?: number;
  rows?: number;
  trustPromptAutorespond?: boolean;
  trustPromptAutorespondRoots?: string[];
};

export type RegisterRemoteShellSessionInput = {
  shell: Shell;
  deviceId: string;
  tmuxSessionName: string;
  cols?: number;
  rows?: number;
};

export class SshTerminalBackend implements TerminalBackend {
  private readonly deviceStore: DeviceStore;
  private readonly helper: RemoteHelperClient;
  private readonly deliverStreamFrame: (frame: StreamFrame) => void;
  private readonly sessions = new Map<string, SshTaskEntry>();
  private readonly shells = new Map<string, SshShellEntry>();
  private hooks: TerminalSessionLifecycleHooks | null = null;

  constructor(opts: SshTerminalBackendOptions) {
    this.deviceStore = opts.deviceStore;
    this.helper = opts.helper ?? new RemoteHelperClient();
    this.deliverStreamFrame = opts.deliverStreamFrame ?? deliverTerminalStreamFrameToRenderers;
  }

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  hasShell(id: string): boolean {
    return this.shells.has(id);
  }

  registerTaskSession(input: RegisterRemoteTaskSessionInput): void {
    const { session, deviceId, tmuxSessionName, agent } = input;
    const trustPromptAutorespond = input.trustPromptAutorespond === true;
    const trustPromptAutorespondRoots = trustPromptAutorespond
      ? (input.trustPromptAutorespondRoots ?? []).map((r) => path.resolve(r))
      : [];
    this.sessions.set(session.id, {
      session: { ...session },
      deviceId,
      tmuxSessionName,
      agent,
      bridge: null,
      autoresponder: null,
      trustPromptAutorespond,
      trustPromptAutorespondRoots,
      detector: agent
        ? new SilenceDetector(
            (state) => this.emitFrame({ kind: 'agent-state', id: session.id, state }),
            undefined,
            session.id,
          )
        : null,
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
    });
  }

  registerShellSession(input: RegisterRemoteShellSessionInput): void {
    const { shell, deviceId, tmuxSessionName } = input;
    this.shells.set(shell.id, {
      shell: { ...shell },
      deviceId,
      tmuxSessionName,
      bridge: null,
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
    });
  }

  /** Running SSH task sessions only (excludes shells). */
  countRunningTaskSessions(): number {
    let n = 0;
    for (const entry of this.sessions.values()) {
      if (entry.session.status === 'running') n += 1;
    }
    return n;
  }

  ensureReady(): Promise<void> {
    return Promise.resolve();
  }

  setSessionLifecycleHooks(hooks: TerminalSessionLifecycleHooks | null): void {
    this.hooks = hooks;
  }

  startSilenceSnapshotPolling(): void {
    /* SSH silence uses the same hook contract; polling is owned by RoutingTerminalBackend. */
  }

  onMainProcessBeforeQuit(): void {
    for (const entry of this.sessions.values()) {
      entry.bridge?.detachForAppQuit();
      entry.bridge = null;
    }
    for (const entry of this.shells.values()) {
      entry.bridge?.detachForAppQuit();
      entry.bridge = null;
    }
  }

  async shouldConfirmAppQuit(): Promise<boolean> {
    return false;
  }

  async teardownForAppQuit(): Promise<void> {
    this.onMainProcessBeforeQuit();
  }

  private emitFrame(frame: StreamFrame): void {
    if (frame.kind === 'agent-state') {
      this.hooks?.onAgentState?.(frame.id, frame.state);
    }
    if (frame.kind === 'session-exit') {
      this.hooks?.onSessionExit?.(frame.session);
    }
    if (frame.kind === 'shell-exit') {
      this.hooks?.onShellExit?.(frame.shell);
    }
    this.deliverStreamFrame(frame);
  }

  private requireSshDevice(deviceId: string): ExecutionDeviceConfig {
    const device = this.deviceStore.getDevice(deviceId);
    if (!device || device.kind !== 'ssh' || !device.ssh) {
      throw new Error(`SSH device "${deviceId}" is not configured`);
    }
    return device;
  }

  private localBridgeCwd(worktreePath: string): string {
    try {
      return os.homedir();
    } catch {
      return worktreePath;
    }
  }

  private wireAutoresponderIfNeeded(entry: SshTaskEntry, bridge: SshAttachBridge): void {
    if (entry.autoresponder || !entry.agent || !entry.trustPromptAutorespond) return;
    if (entry.trustPromptAutorespondRoots.length === 0) return;
    const trustRules = buildTrustPromptAutoresponderRules(entry.trustPromptAutorespondRoots, {
      ttlMsFromSpawn: TRUST_PROMPT_AUTORESPOND_SSH_TTL_MS,
    });
    if (trustRules.length === 0) return;

    const worktreePath = entry.session.worktreePath;
    const runtimeAdapter = {
      get currentCwd() {
        return worktreePath;
      },
      flushHeadlessParser: () =>
        new Promise<void>((resolve) => {
          bridge.headless.write('', () => resolve());
        }),
      getCollapsedBottomScreenText: (maxLines = 40) =>
        collapsedBottomScreenText(bridge.headless, maxLines),
      write: (data: string) => bridge.write(data),
    };

    entry.autoresponder = new PromptAutoresponder(
      entry.session.id,
      entry.agent,
      true,
      trustRules,
      runtimeAdapter,
      (payload) =>
        this.emitFrame({
          kind: 'auto-responded',
          target: 'session',
          id: entry.session.id,
          sessionId: payload.sessionId,
          ruleId: payload.ruleId,
          agent: payload.agent,
        }),
    );
    entry.autoresponder.notifyPtyData();
  }

  private ensureTaskBridge(entry: SshTaskEntry): SshAttachBridge {
    if (entry.bridge?.isBridgeAttached) {
      return entry.bridge;
    }
    entry.bridge?.dispose();
    const device = this.requireSshDevice(entry.deviceId);
    entry.bridge = SshAttachBridge.create(
      {
        ssh: device.ssh!,
        terminalId: entry.session.id,
        cwd: this.localBridgeCwd(entry.session.worktreePath),
        cols: entry.cols,
        rows: entry.rows,
        termProgram: 'kitty',
      },
      {
        onData: (data, seq) => {
          this.emitFrame({
            kind: 'data',
            target: 'session',
            id: entry.session.id,
            data,
            seq,
          });
          entry.detector?.onData();
          entry.autoresponder?.notifyPtyData();
        },
        onBridgeDetach: () => {
          entry.autoresponder?.dispose();
          entry.autoresponder = null;
          entry.bridge?.dispose();
          entry.bridge = null;
        },
      },
    );
    this.wireAutoresponderIfNeeded(entry, entry.bridge);
    return entry.bridge;
  }

  private ensureShellBridge(entry: SshShellEntry): SshAttachBridge {
    if (entry.bridge?.isBridgeAttached) {
      return entry.bridge;
    }
    entry.bridge?.dispose();
    const device = this.requireSshDevice(entry.deviceId);
    entry.bridge = SshAttachBridge.create(
      {
        ssh: device.ssh!,
        terminalId: entry.shell.id,
        cwd: this.localBridgeCwd(entry.shell.worktreePath),
        cols: entry.cols,
        rows: entry.rows,
      },
      {
        onData: (data, seq) => {
          this.emitFrame({
            kind: 'data',
            target: 'shell',
            id: entry.shell.id,
            data,
            seq,
          });
        },
        onBridgeDetach: () => {
          entry.bridge?.dispose();
          entry.bridge = null;
        },
      },
    );
    return entry.bridge;
  }

  createSession(_params: CreateSessionParams): Promise<CreateSessionResult> {
    return Promise.resolve({
      error: 'INVALID_PARAMS',
      message: 'SSH task sessions are started via the remote worktree path, not createSession.',
    });
  }

  listSessions(): Promise<Session[]> {
    return Promise.resolve([...this.sessions.values()].map((e) => ({ ...e.session })));
  }

  getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]> {
    const result: { id: string; taskId?: string; state: AgentState }[] = [];
    for (const [id, entry] of this.sessions) {
      if (entry.session.status !== 'running' || !entry.detector) continue;
      result.push({
        id,
        taskId: entry.session.taskId,
        state: entry.detector.getCurrentState(),
      });
    }
    return Promise.resolve(result);
  }

  findRunningByTaskId(taskId: string): Session | undefined {
    return [...this.sessions.values()].find(
      (e) => e.session.taskId === taskId && e.session.status === 'running',
    )?.session;
  }

  async attachSession(id: string): Promise<AttachResult | null> {
    const entry = this.sessions.get(id);
    if (!entry || entry.session.status !== 'running') return null;
    const bridge = this.ensureTaskBridge(entry);
    const result = await bridge.snapshot();
    entry.autoresponder?.notifyPtyData();
    return result;
  }

  async stopSession(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.detector?.dispose();
    entry.autoresponder?.dispose();
    entry.bridge?.killBridge();
    entry.bridge?.dispose();
    entry.bridge = null;

    const device = this.requireSshDevice(entry.deviceId);
    await this.helper.runJsonCommand<RemoteHelperStopTerminalData>(device, 'stop-terminal', {
      terminalId: id,
      deviceId: entry.deviceId,
      reason: 'user-stopped',
    });

    for (const [shellId, shellEntry] of this.shells) {
      if (shellEntry.shell.sessionId !== id) continue;
      await this.closeShell(shellId);
    }

    entry.session.status = 'stopped';
    entry.session.stoppedAt = new Date().toISOString();
    this.emitFrame({ kind: 'session-exit', id, session: { ...entry.session } });
    this.sessions.delete(id);
  }

  writeSession(id: string, data: string): void {
    const entry = this.sessions.get(id);
    if (!entry || entry.session.status !== 'running') return;
    this.ensureTaskBridge(entry).write(data);
  }

  async writeSessionAwait(id: string, data: string): Promise<void> {
    this.writeSession(id, data);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  writeSessionAfterOutputText(id: string, needle: string, data: string): void {
    const normalizedNeedle = needle.trim();
    if (!normalizedNeedle) {
      this.writeSession(id, data);
      return;
    }
    this.writeSession(id, data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const entry = this.sessions.get(id);
    if (!entry || entry.session.status !== 'running') return;
    entry.cols = cols;
    entry.rows = rows;
    entry.detector?.notifyResize();
    if (entry.bridge?.isBridgeAttached) {
      entry.bridge.resize(cols, rows);
    }
  }

  async createShell(params: CreateShellParams): Promise<Shell> {
    const parent = this.sessions.get(params.sessionId);
    if (!parent) {
      throw new Error(`No SSH session for id: ${params.sessionId}`);
    }
    const device = this.requireSshDevice(parent.deviceId);
    const shellId = randomUUID();
    const tmuxSessionName = buildFluxxTmuxSessionName({
      kind: 'shell',
      projectSlugSource: parent.session.projectId,
      terminalId: shellId,
    });
    const hostLabel = deviceProbeHostLabel(device);
    const started = await this.helper.runJsonCommand<RemoteHelperStartShellData>(
      device,
      'start-shell',
      {
        terminalId: shellId,
        deviceId: device.id,
        parentSessionId: parent.session.id,
        projectId: parent.session.projectId,
        cwd: params.worktreePath,
        tmuxSessionName,
        hostLabel,
        cols: params.cols,
        rows: params.rows,
      },
    );
    if (!started.ok) {
      throw new Error(started.message);
    }

    const shell: Shell = {
      id: shellId,
      sessionId: params.sessionId,
      worktreePath: params.worktreePath,
      status: 'running',
      startedAt: started.data.startedAt,
      deviceId: device.id,
      deviceKind: 'ssh',
      deviceLabel: device.displayName,
      remotePath: params.worktreePath,
      shellPlacement: 'remote',
    };
    this.shells.set(shellId, {
      shell,
      deviceId: device.id,
      tmuxSessionName,
      bridge: null,
      cols: params.cols,
      rows: params.rows,
    });
    return shell;
  }

  listShells(sessionId: string): Promise<Shell[]> {
    const all = [...this.shells.values()].map((e) => ({ ...e.shell }));
    return Promise.resolve(all.filter((s) => s.sessionId === sessionId));
  }

  async attachShell(id: string): Promise<AttachResult | null> {
    const entry = this.shells.get(id);
    if (!entry || entry.shell.status !== 'running') return null;
    const bridge = this.ensureShellBridge(entry);
    return bridge.snapshot();
  }

  writeShell(id: string, data: string): void {
    const entry = this.shells.get(id);
    if (!entry || entry.shell.status !== 'running') return;
    this.ensureShellBridge(entry).write(data);
  }

  resizeShell(id: string, cols: number, rows: number): void {
    const entry = this.shells.get(id);
    if (!entry || entry.shell.status !== 'running') return;
    entry.cols = cols;
    entry.rows = rows;
    if (entry.bridge?.isBridgeAttached) {
      entry.bridge.resize(cols, rows);
    }
  }

  async closeShell(id: string): Promise<void> {
    const entry = this.shells.get(id);
    if (!entry) return;
    entry.bridge?.killBridge();
    entry.bridge?.dispose();
    entry.bridge = null;

    const device = this.requireSshDevice(entry.deviceId);
    await this.helper.runJsonCommand<RemoteHelperStopTerminalData>(device, 'stop-terminal', {
      terminalId: id,
      deviceId: entry.deviceId,
      reason: 'user-stopped',
    });

    entry.shell.status = 'stopped';
    entry.shell.stoppedAt = new Date().toISOString();
    this.emitFrame({ kind: 'shell-exit', id, shell: { ...entry.shell } });
    this.shells.delete(id);
  }

  async closeShellsForSession(sessionId: string): Promise<void> {
    const shellIds = [...this.shells.values()]
      .filter((e) => e.shell.sessionId === sessionId)
      .map((e) => e.shell.id);
    for (const shellId of shellIds) {
      await this.closeShell(shellId);
    }
  }

  startPlanning(_params: StartPlanningParams): Promise<StartPlanningResult> {
    return Promise.resolve({
      error: 'INVALID_PARAMS',
      message: 'Planning sessions are not supported on SSH devices in this release.',
    });
  }

  listPlanning(): Promise<PlanningSession[]> {
    return Promise.resolve([]);
  }

  getPlanning(_id: string): Promise<PlanningSession | null> {
    return Promise.resolve(null);
  }

  attachPlanning(_id: string): Promise<PlanningAttachResult | null> {
    return Promise.resolve(null);
  }

  writePlanning(_id: string, _data: string): void {
    /* no-op */
  }

  resizePlanning(_id: string, _cols: number, _rows: number): void {
    /* no-op */
  }

  async stopPlanning(_id: string): Promise<void> {
    /* no-op */
  }

  async runSilencePollTick(): Promise<void> {
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
}
