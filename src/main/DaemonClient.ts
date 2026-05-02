import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow } from 'electron';
import type {
  Agent,
  PlanningSession,
  Session,
  Shell,
} from '../types';
import {
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  DAEMON_RPC_SOCK,
  DAEMON_STREAM_SOCK,
  NdjsonSplitter,
  PROTOCOL_VERSION,
  WIN_RPC_PIPE,
  WIN_STREAM_PIPE,
  daemonUnixSocketPaths,
  encodeLine,
  type AgentState,
  type AttachResult,
  type DaemonStreamCatchupPayload,
  type CreateSessionParams,
  type CreateSessionResult,
  type CreateShellParams,
  type Hello,
  type PingResult,
  type PlanningAttachResult,
  type RpcRequest,
  type RpcResponse,
  type StartPlanningParams,
  type StartPlanningResult,
  type StreamFrame,
} from '../daemon/protocol';

const HANDSHAKE_TIMEOUT_MS = 3000;
const SPAWN_CONNECT_TIMEOUT_MS = 5000;
const STREAM_RECONNECT_BACKOFF_START_MS = 250;
const STREAM_RECONNECT_BACKOFF_MAX_MS = 30_000;
const SILENCE_POLL_MS = 30_000;

export type SilenceSnapshotReason = 'poll' | 'stream-reconnect';

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Main-process client for the Flux daemon. Handles spawning / reconnecting
 * to the detached daemon process, correlation-id RPC, and fanning stream
 * frames back out to every renderer via existing broadcast channels
 * (`session:data:<id>`, …) with payload `{ data, seq }` for de-duplication.
 */
export class DaemonClient {
  private rpc: net.Socket | null = null;
  private stream: net.Socket | null = null;
  private nextRpcId = 1;
  private pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  private connecting: Promise<void> | null = null;

  /** Set when the last spawned daemon child exits (for timeout diagnostics). */
  private lastSpawnExit: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;

  /** Optional callback invoked when daemon reports agent silence/activity. */
  onAgentState: ((sessionId: string, state: AgentState) => void) | null = null;

  /**
   * Low-frequency RPC reconciliation so missed `agent-state` frames still apply
   * (local task store) after stalls or reconnects.
   */
  onSilenceStatesSnapshot:
    | ((
        states: { id: string; taskId?: string; state: AgentState }[],
        meta: { reason: SilenceSnapshotReason },
      ) => void | Promise<void>)
    | null = null;

  private intentionalDisconnect = false;

  private streamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private streamBackoffMs = STREAM_RECONNECT_BACKOFF_START_MS;
  private streamReconnectAttemptScheduled = false;

  private silencePollInterval: ReturnType<typeof setInterval> | null = null;

  /** Diagnostics (stream drops / freezes). */
  streamDisconnectCount = 0;
  streamReconnectSuccessCount = 0;
  private lastStreamCloseAt: number | null = null;
  private lastStreamOpenAt: number | null = null;
  private lastStreamFrameAt: number | null = null;
  private lastAgentStateAt: number | null = null;
  private readonly lastDataSeqByKey = new Map<string, number>();

  private readonly userData: string;
  private readonly rpcPath: string;
  private readonly streamPath: string;
  private readonly pidPath: string;
  private readonly daemonLogPath: string;

  constructor() {
    this.userData = app.getPath('userData');
    const isWin = process.platform === 'win32';
    if (isWin) {
      this.rpcPath = WIN_RPC_PIPE;
      this.streamPath = WIN_STREAM_PIPE;
    } else {
      const { rpcPath, streamPath } = daemonUnixSocketPaths(this.userData);
      this.rpcPath = rpcPath;
      this.streamPath = streamPath;
    }
    this.pidPath = path.join(this.userData, DAEMON_PID_FILE);
    this.daemonLogPath = path.join(this.userData, DAEMON_LOG_FILE);
  }

  /** Call once after assigning {@link onSilenceStatesSnapshot}. */
  startSilencePolling(): void {
    this.ensureSilencePollRunning();
  }

  private ensureSilencePollRunning(): void {
    if (this.silencePollInterval) return;
    if (!this.onSilenceStatesSnapshot) return;
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
    if (!this.rpc || this.rpc.destroyed || !this.onSilenceStatesSnapshot) return;
    try {
      const states = await this.request<{ id: string; taskId?: string; state: AgentState }[]>(
        'getSessionSilenceStates',
      );
      await this.onSilenceStatesSnapshot(states, { reason: 'poll' });
    } catch (err) {
      console.warn('[DaemonClient] silence poll failed', err);
    }
  }

  private cancelStreamReconnect(): void {
    if (this.streamReconnectTimer) {
      clearTimeout(this.streamReconnectTimer);
      this.streamReconnectTimer = null;
    }
    this.streamReconnectAttemptScheduled = false;
  }

  private resetStreamBackoff(): void {
    this.streamBackoffMs = STREAM_RECONNECT_BACKOFF_START_MS;
  }

  private scheduleStreamReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.streamReconnectAttemptScheduled) return;
    this.streamReconnectAttemptScheduled = true;
    const delay = Math.min(this.streamBackoffMs, STREAM_RECONNECT_BACKOFF_MAX_MS);
    this.streamBackoffMs = Math.min(
      Math.floor(this.streamBackoffMs * 1.5),
      STREAM_RECONNECT_BACKOFF_MAX_MS,
    );
    this.streamReconnectTimer = setTimeout(() => {
      this.streamReconnectTimer = null;
      this.streamReconnectAttemptScheduled = false;
      void this.runStreamReconnectAttempt();
    }, delay);
    this.streamReconnectTimer.unref?.();
    console.warn('[DaemonClient] scheduling stream reconnect', {
      delayMs: delay,
      nextBackoffMs: this.streamBackoffMs,
      rpcUp: Boolean(this.rpc && !this.rpc.destroyed),
      ...this.streamDiagnosticsSummary(),
    });
  }

  private async runStreamReconnectAttempt(): Promise<void> {
    if (this.intentionalDisconnect) return;
    if (this.stream && !this.stream.destroyed) {
      this.resetStreamBackoff();
      return;
    }
    console.warn('[DaemonClient] attempting daemon stream reconnect', this.streamDiagnosticsSummary());
    try {
      if (this.rpc && !this.rpc.destroyed) {
        const ok = await this.connectStreamOnly();
        if (ok) {
          this.streamReconnectSuccessCount++;
          this.resetStreamBackoff();
          this.lastStreamOpenAt = Date.now();
          await this.afterStreamReconnected('stream-only');
          return;
        }
      }
      await this.ensureRunning();
      this.streamReconnectSuccessCount++;
      this.resetStreamBackoff();
      this.lastStreamOpenAt = Date.now();
      await this.afterStreamReconnected('full');
    } catch (err) {
      console.warn('[DaemonClient] stream reconnect attempt failed', err);
      this.scheduleStreamReconnect();
    }
  }

  private async afterStreamReconnected(
    mode: DaemonStreamCatchupPayload['mode'],
  ): Promise<void> {
    const disconnectedMs =
      this.lastStreamCloseAt != null ? Date.now() - this.lastStreamCloseAt : undefined;
    let states: { id: string; taskId?: string; state: AgentState }[] = [];
    try {
      states = await this.request<{ id: string; taskId?: string; state: AgentState }[]>(
        'getSessionSilenceStates',
      );
    } catch (err) {
      console.warn('[DaemonClient] getSessionSilenceStates after reconnect failed', err);
    }

    const lastDataSeq: Record<string, number> = {};
    for (const [k, v] of this.lastDataSeqByKey) {
      lastDataSeq[k] = v;
    }

    console.log('[DaemonClient] stream recovered', {
      mode,
      disconnectedMs,
      runningSessions: states.length,
      lastStreamFrameAt: this.lastStreamFrameAt,
      lastAgentStateAt: this.lastAgentStateAt,
      lastDataSeq,
    });

    for (const { id, state } of states) {
      broadcast(`session:agent-state:${id}`, { state });
    }

    const payload: DaemonStreamCatchupPayload = {
      reason: 'reconnect',
      mode,
      disconnectedMs,
      runningSessions: states.length,
      lastStreamFrameAt: this.lastStreamFrameAt ?? undefined,
      lastAgentStateAt: this.lastAgentStateAt ?? undefined,
      lastDataSeq,
    };
    broadcast('daemon:streamCatchup', payload);

    try {
      await this.onSilenceStatesSnapshot?.(states, { reason: 'stream-reconnect' });
    } catch (err) {
      console.warn('[DaemonClient] silence snapshot after reconnect failed', err);
    }
  }

  private streamDiagnosticsSummary(): Record<string, unknown> {
    const lastDataSeq: Record<string, number> = {};
    for (const [k, v] of this.lastDataSeqByKey) {
      lastDataSeq[k] = v;
    }
    return {
      streamDisconnectCount: this.streamDisconnectCount,
      streamReconnectSuccessCount: this.streamReconnectSuccessCount,
      lastStreamCloseAt: this.lastStreamCloseAt,
      lastStreamOpenAt: this.lastStreamOpenAt,
      lastStreamFrameAt: this.lastStreamFrameAt,
      lastAgentStateAt: this.lastAgentStateAt,
      lastDataSeq,
    };
  }

  private recordIncomingStreamFrame(frame: StreamFrame): void {
    this.lastStreamFrameAt = Date.now();
    if (frame.kind === 'agent-state') {
      this.lastAgentStateAt = this.lastStreamFrameAt;
      return;
    }
    if (frame.kind === 'data' && frame.seq != null) {
      this.lastDataSeqByKey.set(`${frame.target}:${frame.id}`, frame.seq);
    }
  }

  /**
   * Attach only the stream socket while RPC is still healthy (avoids a second RPC client).
   */
  private async connectStreamOnly(): Promise<boolean> {
    const rpc = this.rpc;
    if (!rpc || rpc.destroyed) return false;
    const stream = await this.connectSocket(this.streamPath);
    if (!stream) return false;
    try {
      await this.finishHandshake(stream, 'stream');
      this.attachStreamListener(stream);
      this.stream = stream;
      this.lastStreamOpenAt = Date.now();
      this.ensureSilencePollRunning();
      console.log('[DaemonClient] stream socket reattached (RPC unchanged)');
      return true;
    } catch (err) {
      console.warn('[DaemonClient] stream-only connect failed', err);
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  async ensureRunning(): Promise<void> {
    if (this.rpc && !this.rpc.destroyed && this.stream && !this.stream.destroyed) {
      return;
    }
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        // Replace half-open pairs cleanly and supersede any pending stream backoff timer.
        this.cancelStreamReconnect();
        this.destroySocketsOnly();
        await this.connectOrSpawn();
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private async connectOrSpawn(): Promise<void> {
    // First, try to attach to an existing daemon: pid alive + sockets exist.
    const existing = await this.tryConnectExisting();
    if (existing) {
      console.log('[DaemonClient] attached to existing daemon');
      return;
    }

    // Otherwise spawn a fresh one.
    await this.spawnDaemon();

    // Poll for sockets + successful ping.
    const deadline = Date.now() + SPAWN_CONNECT_TIMEOUT_MS;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        if (await this.connectBoth()) {
          const pong = (await this.request<PingResult>('ping')) as PingResult;
          if (pong.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error(`daemon protocol mismatch: ${pong.protocolVersion}`);
          }
          console.log('[DaemonClient] connected to freshly spawned daemon', pong.pid);
          return;
        }
      } catch (err) {
        lastErr = err;
      }
      await sleep(100);
    }
    const spawnHint =
      this.lastSpawnExit !== null
        ? `daemon child exit: code=${this.lastSpawnExit.code} signal=${this.lastSpawnExit.signal ?? 'none'}`
        : 'daemon child exit: (none observed yet)';
    throw new Error(
      `flux-daemon did not become reachable within ${SPAWN_CONNECT_TIMEOUT_MS}ms ` +
        `(log=${this.daemonLogPath}, rpc=${this.rpcPath}). ${spawnHint}. Last error: ${String(lastErr)}`,
    );
  }

  private async tryConnectExisting(): Promise<boolean> {
    let pidAlive = false;
    try {
      const raw = await fsp.readFile(this.pidPath, 'utf8');
      const pid = Number.parseInt(raw.trim(), 10);
      pidAlive = isPidAlive(pid);
    } catch {
      pidAlive = false;
    }
    if (!pidAlive) return false;

    try {
      let connected = await this.connectBoth();
      if (!connected) {
        // Legacy daemons bound sockets next to userData (pre short-path fix).
        const legacyRpc = path.join(this.userData, DAEMON_RPC_SOCK);
        const legacyStream = path.join(this.userData, DAEMON_STREAM_SOCK);
        if ((await pathExists(legacyRpc)) && (await pathExists(legacyStream))) {
          connected = await this.connectBoth({ rpc: legacyRpc, stream: legacyStream });
        }
        if (!connected) return false;
      }
      const pong = (await this.request<PingResult>('ping')) as PingResult;
      if (pong.protocolVersion !== PROTOCOL_VERSION) {
        this.tearDownSockets();
        return false;
      }
      return true;
    } catch {
      this.tearDownSockets();
      return false;
    }
  }

  private async spawnDaemon(): Promise<void> {
    const daemonScript = resolveDaemonScriptPath();
    if (!daemonScript || !(await pathExists(daemonScript))) {
      throw new Error(`flux-daemon script not found at ${daemonScript}`);
    }
    // Stale socket files left over from a previous crashed daemon would
    // make `listen()` EADDRINUSE; remove before spawning.
    if (process.platform !== 'win32') {
      for (const p of [this.rpcPath, this.streamPath]) {
        try {
          await fsp.unlink(p);
        } catch {
          // ignore ENOENT / others; listen() will surface a real problem.
        }
      }
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FLUX_DAEMON_USER_DATA: this.userData,
    };
    // These Electron-specific vars must NOT leak into a RunAsNode child
    // process, which would otherwise try to reinitialize Chromium state.
    delete env.ELECTRON_NO_ATTACH_CONSOLE;

    this.lastSpawnExit = null;
    const child = spawn(process.execPath, [daemonScript], {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (err) => {
      console.error('[DaemonClient] spawn error', err);
    });
    child.on('exit', (code, signal) => {
      this.lastSpawnExit = { code, signal };
      console.error('[DaemonClient] flux-daemon child exited', {
        code,
        signal,
        log: this.daemonLogPath,
        rpc: this.rpcPath,
      });
    });
    child.unref();
  }

  // ---------------------------------------------------------------- sockets

  private async connectBoth(override?: {
    rpc: string;
    stream: string;
  }): Promise<boolean> {
    const rpcPath = override?.rpc ?? this.rpcPath;
    const streamPath = override?.stream ?? this.streamPath;
    const rpc = await this.connectSocket(rpcPath);
    if (!rpc) return false;
    const stream = await this.connectSocket(streamPath);
    if (!stream) {
      rpc.destroy();
      return false;
    }
    try {
      await Promise.all([
        this.finishHandshake(rpc, 'rpc'),
        this.finishHandshake(stream, 'stream'),
      ]);
    } catch (err) {
      rpc.destroy();
      stream.destroy();
      throw err;
    }
    this.attachRpcListener(rpc);
    this.attachStreamListener(stream);
    this.rpc = rpc;
    this.stream = stream;
    this.lastStreamOpenAt = Date.now();
    this.ensureSilencePollRunning();
    return true;
  }

  private connectSocket(addr: string): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const sock = net.createConnection(addr);
      const done = (ok: boolean) => {
        sock.removeAllListeners('error');
        sock.removeAllListeners('connect');
        resolve(ok ? sock : null);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
  }

  private async finishHandshake(
    socket: net.Socket,
    label: 'rpc' | 'stream',
  ): Promise<void> {
    socket.setEncoding('utf8');
    const helloOut: Hello = {
      hello: 'flux-daemon',
      protocolVersion: PROTOCOL_VERSION,
      role: 'main',
    };
    socket.write(encodeLine(helloOut));

    const splitter = new NdjsonSplitter();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} handshake timeout`)),
        HANDSHAKE_TIMEOUT_MS,
      );
    });
    const firstLine = new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer | string) => {
        const lines = splitter.push(chunk);
        if (lines.length > 0) {
          socket.off('data', onData);
          socket.off('error', onError);
          resolve(lines[0]);
        }
      };
      const onError = (err: Error) => {
        socket.off('data', onData);
        reject(err);
      };
      socket.on('data', onData);
      socket.once('error', onError);
    });

    const line = await Promise.race([firstLine, timeout]);
    let parsed: Partial<Hello>;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${label}: invalid hello`);
    }
    if (
      parsed?.hello !== 'flux-daemon' ||
      parsed.protocolVersion !== PROTOCOL_VERSION
    ) {
      throw new Error(
        `${label}: daemon protocol mismatch (theirs=${parsed?.protocolVersion}, ours=${PROTOCOL_VERSION})`,
      );
    }
    // Any remaining buffered lines after hello are real data for this socket.
    // Re-inject them into the per-socket splitter we hand to the listener.
    (socket as unknown as { __splitter?: NdjsonSplitter }).__splitter = splitter;
  }

  private attachRpcListener(socket: net.Socket): void {
    const splitter =
      (socket as unknown as { __splitter?: NdjsonSplitter }).__splitter ??
      new NdjsonSplitter();
    socket.on('data', (chunk) => {
      for (const line of splitter.push(chunk)) {
        let parsed: RpcResponse;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof parsed?.id !== 'number') continue;
        const waiter = this.pending.get(parsed.id);
        if (!waiter) continue;
        this.pending.delete(parsed.id);
        if (parsed.error) {
          waiter.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
        } else {
          waiter.resolve(parsed.result);
        }
      }
    });
    socket.on('close', () => {
      console.warn('[DaemonClient] rpc socket closed', this.streamDiagnosticsSummary());
      this.rpc = null;
      const orphanStream = this.stream;
      this.stream = null;
      if (orphanStream && !orphanStream.destroyed) {
        try {
          orphanStream.removeAllListeners();
          orphanStream.destroy();
        } catch {
          /* ignore */
        }
      }
      this.clearSilencePoll();
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error('daemon rpc socket closed'));
      }
      this.pending.clear();
      if (!this.intentionalDisconnect) {
        this.scheduleStreamReconnect();
      }
    });
    socket.on('error', (err) => {
      console.error('[DaemonClient] rpc socket error', err.message);
    });
  }

  private attachStreamListener(socket: net.Socket): void {
    const splitter =
      (socket as unknown as { __splitter?: NdjsonSplitter }).__splitter ??
      new NdjsonSplitter();
    socket.on('data', (chunk) => {
      for (const line of splitter.push(chunk)) {
        let frame: StreamFrame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        this.dispatchStreamFrame(frame);
      }
    });
    socket.on('close', () => {
      console.warn('[DaemonClient] stream socket closed', this.streamDiagnosticsSummary());
      if (this.stream === socket) {
        this.stream = null;
      }
      this.streamDisconnectCount++;
      this.lastStreamCloseAt = Date.now();
      if (!this.intentionalDisconnect) {
        this.scheduleStreamReconnect();
      }
    });
    socket.on('error', (err) => {
      console.error(
        '[DaemonClient] stream socket error',
        err.message,
        this.streamDiagnosticsSummary(),
      );
    });
  }

  private dispatchStreamFrame(frame: StreamFrame): void {
    this.recordIncomingStreamFrame(frame);
    if (frame.kind === 'data') {
      const payload = { data: frame.data, seq: frame.seq };
      if (frame.target === 'session') {
        broadcast(`session:data:${frame.id}`, payload);
      } else if (frame.target === 'shell') {
        broadcast(`shell:data:${frame.id}`, payload);
      } else if (frame.target === 'planning') {
        broadcast(`planning:data:${frame.id}`, payload);
      }
      return;
    }
    if (frame.kind === 'session-exit') {
      broadcast('session:exited', frame.session);
      return;
    }
    if (frame.kind === 'shell-exit') {
      broadcast('shell:exited', frame.shell);
      return;
    }
    if (frame.kind === 'planning-exit') {
      broadcast('planning:exited', frame.session);
      return;
    }
    if (frame.kind === 'agent-state') {
      this.onAgentState?.(frame.id, frame.state);
      broadcast(`session:agent-state:${frame.id}`, { state: frame.state });
    }
  }

  private destroySocketsOnly(): void {
    const rpc = this.rpc;
    const stream = this.stream;
    this.rpc = null;
    this.stream = null;
    if (stream && !stream.destroyed) {
      try {
        stream.removeAllListeners();
        stream.destroy();
      } catch {
        // ignore
      }
    }
    if (rpc && !rpc.destroyed) {
      try {
        rpc.removeAllListeners();
        rpc.destroy();
      } catch {
        // ignore
      }
    }
  }

  private tearDownSockets(): void {
    this.cancelStreamReconnect();
    this.destroySocketsOnly();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearSilencePoll();
    this.tearDownSockets();
  }

  // ------------------------------------------------------------------ rpc

  private request<T>(method: string, params?: unknown): Promise<T> {
    const rpc = this.rpc;
    if (!rpc || rpc.destroyed) {
      return Promise.reject(new Error('daemon rpc socket not connected'));
    }
    const id = this.nextRpcId++;
    const req: RpcRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      try {
        rpc.write(encodeLine(req));
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  // ----------------------------------------------------------- session RPC

  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    await this.ensureRunning();
    return this.request<CreateSessionResult>('createSession', params);
  }

  async listSessions(): Promise<Session[]> {
    await this.ensureRunning();
    return this.request<Session[]>('listSessions');
  }

  async getSessionSilenceStates(): Promise<{ id: string; taskId?: string; state: AgentState }[]> {
    await this.ensureRunning();
    return this.request<{ id: string; taskId?: string; state: AgentState }[]>('getSessionSilenceStates');
  }

  /**
   * Full `AttachResult` from the daemon (legacy `replay` + optional v3
   * `snapshot`). The RPC/IPC layers pass the object through without
   * stripping fields; renderer may prefer `snapshot` when present.
   */
  async attachSession(id: string): Promise<AttachResult | null> {
    await this.ensureRunning();
    return this.request<AttachResult | null>('attachSession', { id });
  }

  async stopSession(id: string): Promise<void> {
    await this.ensureRunning();
    await this.request<null>('stopSession', { id });
  }

  writeSession(id: string, data: string): void {
    // Fire-and-forget; the renderer calls this on every keystroke.
    void this.ensureRunning().then(() =>
      this.request<null>('writeSession', { id, data }).catch(() => {
        // ignore — transient disconnects
      }),
    );
  }

  resizeSession(id: string, cols: number, rows: number): void {
    void this.ensureRunning().then(() =>
      this.request<null>('resizeSession', { id, cols, rows }).catch(() => {
        // ignore
      }),
    );
  }

  // ------------------------------------------------------------ shell RPC

  async createShell(params: CreateShellParams): Promise<Shell> {
    await this.ensureRunning();
    return this.request<Shell>('createShell', params);
  }

  async listShells(sessionId: string): Promise<Shell[]> {
    await this.ensureRunning();
    return this.request<Shell[]>('listShells', { sessionId });
  }

  /** See {@link attachSession} — same attach payload shape. */
  async attachShell(id: string): Promise<AttachResult | null> {
    await this.ensureRunning();
    return this.request<AttachResult | null>('attachShell', { id });
  }

  writeShell(id: string, data: string): void {
    void this.ensureRunning().then(() =>
      this.request<null>('writeShell', { id, data }).catch(() => {
        // ignore
      }),
    );
  }

  resizeShell(id: string, cols: number, rows: number): void {
    void this.ensureRunning().then(() =>
      this.request<null>('resizeShell', { id, cols, rows }).catch(() => {
        // ignore
      }),
    );
  }

  async closeShell(id: string): Promise<void> {
    await this.ensureRunning();
    await this.request<null>('closeShell', { id });
  }

  async closeShellsForSession(sessionId: string): Promise<void> {
    await this.ensureRunning();
    await this.request<null>('closeShellsForSession', { sessionId });
  }

  // --------------------------------------------------------- planning RPC

  async startPlanning(params: StartPlanningParams): Promise<StartPlanningResult> {
    await this.ensureRunning();
    return this.request<StartPlanningResult>('startPlanning', params);
  }

  async listPlanning(): Promise<PlanningSession[]> {
    await this.ensureRunning();
    return this.request<PlanningSession[]>('listPlanning');
  }

  async stopPlanning(id: string): Promise<void> {
    await this.ensureRunning();
    await this.request<null>('stopPlanning', { id });
  }

  async getPlanning(id: string): Promise<PlanningSession | null> {
    await this.ensureRunning();
    return this.request<PlanningSession | null>('getPlanning', { id });
  }

  /** Attach for planning PTYs: `AttachResult` fields plus `session` metadata. */
  async attachPlanning(id: string): Promise<PlanningAttachResult | null> {
    await this.ensureRunning();
    return this.request<PlanningAttachResult | null>('attachPlanning', { id });
  }

  writePlanning(id: string, data: string): void {
    void this.ensureRunning().then(() =>
      this.request<null>('writePlanning', { id, data }).catch(() => {
        // ignore
      }),
    );
  }

  resizePlanning(id: string, cols: number, rows: number): void {
    void this.ensureRunning().then(() =>
      this.request<null>('resizePlanning', { id, cols, rows }).catch(() => {
        // ignore
      }),
    );
  }
}

/**
 * Resolve the daemon script path for both `electron-forge start` and
 * packaged builds. Forge's vite plugin emits each build entry's bundle
 * alongside `main.js` in `.vite/build/` (dev) or under `Flux.app/...` (packaged).
 * Both live in the same directory as the current main bundle, so
 * `__dirname + '/daemon.js'` works for both.
 */
function resolveDaemonScriptPath(): string {
  // `__dirname` at runtime is where `main.js` sits; the daemon bundle is
  // emitted into the same folder by the extra forge/vite build entry.
  const candidate = path.join(__dirname, 'daemon.js');
  if (fs.existsSync(candidate)) return candidate;
  // Forge dev mode keeps outputs at .vite/build/<name>.js relative to cwd.
  const dev = path.resolve(process.cwd(), '.vite/build/daemon.js');
  return dev;
}

// Re-export Agent for consumers that import types alongside the client.
export type { Agent };
