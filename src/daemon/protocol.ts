// Wire protocol shared between the Flux main process and the detached
// session daemon. NDJSON (one JSON value per line) on two sockets:
//   - RPC socket   : main → daemon request/response, correlation ids
//   - stream socket: daemon → main PTY output frames
//
// See 0001-session-daemon.md for the architecture rationale. Two sockets
// avoid head-of-line blocking when a session spews output fast enough to
// fill the kernel buffer, which would otherwise queue RPC responses behind
// megabytes of `cat bigfile.log`.

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Agent, PlanningSession, Session, Shell } from '../types';

/**
 * Wire protocol generation for the main ↔ daemon NDJSON handshake and RPC.
 * Main and daemon must match exactly; a running v2 daemon is discarded when
 * the app upgrades to v3 (spawn fresh).
 *
 * - **v2** — Stream frames + attach `{ replay, cols, rows }` only.
 * - **v3** — Attach payloads may include optional `snapshot` (`TerminalSnapshot`).
 *   Consumers should prefer `snapshot` for warm-reattach when defined; `replay`
 *   remains for transition/debug. The daemon may omit `snapshot` until
 *   `SessionRuntime` emits serialized headless state.
 * - **v3+ streamSeq** — `data` stream frames may carry a monotonically
 *   increasing per-PTY `seq` (see `StreamFrame`); `AttachResult.streamSeq` is
 *   the last seq reflected in a warm snapshot so the renderer can drop
 *   buffered live chunks already represented by `snapshot` / replay.
 */
export const PROTOCOL_VERSION = 3;

/** Unix socket / named pipe names inside Electron userData. */
export const DAEMON_PID_FILE = 'flux-daemon.pid';
export const DAEMON_RPC_SOCK = 'flux-daemon.rpc.sock';
export const DAEMON_STREAM_SOCK = 'flux-daemon.stream.sock';
export const DAEMON_LOG_FILE = 'flux-daemon.log';

/** Windows named pipe paths. */
export const WIN_RPC_PIPE = '\\\\.\\pipe\\flux-daemon-rpc';
export const WIN_STREAM_PIPE = '\\\\.\\pipe\\flux-daemon-stream';

/**
 * Unix domain socket paths for the daemon must stay short: macOS `sun_path`
 * is ~104 bytes, and Electron `userData` under Flux worktrees can exceed that.
 * We place sockets under `os.tmpdir()` keyed by a hash of the resolved
 * `userData` path so profiles stay isolated.
 */
export function daemonUnixSocketPaths(userData: string): {
  runtimeDir: string;
  rpcPath: string;
  streamPath: string;
} {
  const resolved = path.resolve(userData);
  const hash = crypto.createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 16);
  const runtimeDir = path.join(os.tmpdir(), `flux-daemon-${hash}`);
  return {
    runtimeDir,
    rpcPath: path.join(runtimeDir, DAEMON_RPC_SOCK),
    streamPath: path.join(runtimeDir, DAEMON_STREAM_SOCK),
  };
}

/** First line either side writes on connect. Mismatched major version → close. */
export interface Hello {
  hello: 'flux-daemon';
  protocolVersion: number;
  role: 'main' | 'daemon';
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

export interface RpcRequest<Method extends string = string, Params = unknown> {
  id: number;
  method: Method;
  params?: Params;
}

export interface RpcResponse<Result = unknown> {
  id: number;
  result?: Result;
  error?: { code: string; message: string };
}

// --- Params / results ---

export interface PingResult {
  protocolVersion: number;
  pid: number;
}

export interface CreateSessionParams {
  /** Caller (main) is responsible for worktree creation. */
  worktreePath: string;
  branch: string;
  taskId: string;
  projectId: string;
  agent: Agent;
  command: string;
  args: string[];
  cols: number;
  rows: number;
}

export type CreateSessionResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'INVALID_PARAMS'; message: string };

/**
 * DECSET-style flags the daemon tracks from PTY output so the renderer can
 * replay `rehydrateSequences` after applying `snapshotAnsi`. Names follow
 * common xterm/VT documentation (CSI ?Pm h / l).
 */
export interface TerminalModes {
  /** DECCKM — application cursor keys (`CSI ?1`) */
  applicationCursorKeys: boolean;
  /** DECOM — origin mode (`CSI ?6`) */
  originMode: boolean;
  /** DECAWM — autowrap (`CSI ?7`) */
  autoWrap: boolean;
  /** DECTCEM — cursor visible (`CSI ?25`) */
  cursorVisible: boolean;
  /** Alternate screen buffer (`CSI ?47` / `CSI ?1049`) */
  alternateScreen: boolean;
  /** X10 mouse (`CSI ?9`) */
  mouseX10: boolean;
  /** VT200 mouse — press/release (`CSI ?1000`) */
  mouseVT200: boolean;
  /** Hilite mouse (`CSI ?1001`) */
  mouseHighlight: boolean;
  /** Cell motion tracking (`CSI ?1002`) */
  mouseCellMotion: boolean;
  /** All motion tracking (`CSI ?1003`) */
  mouseAllMotion: boolean;
  /** UTF-8 mouse encoding (`CSI ?1005`) */
  mouseUTF8: boolean;
  /** SGR mouse extended coordinates (`CSI ?1006`) */
  mouseSGR: boolean;
  /** Focus in/out events (`CSI ?1004`) */
  focusReporting: boolean;
  /** Bracketed paste (`CSI ?2004`) */
  bracketedPaste: boolean;
}

/**
 * Serialized headless xterm state for warm-reattach (see planning doc).
 * Filled by the daemon once `SessionRuntime` wires `@xterm/addon-serialize`;
 * geometry must match `cols` / `rows` on the attach response.
 */
export interface TerminalSnapshot {
  /** Screen state from SerializeAddon (or equivalent), safe to write into a fresh terminal. */
  snapshotAnsi: string;
  /** Mode re-entry sequences not covered by `snapshotAnsi` alone. */
  rehydrateSequences: string;
  modes: TerminalModes;
  cols: number;
  rows: number;
}

/** Warm-reattach payload for agent sessions and shell panes. */
export interface AttachResult {
  /**
   * Bounded raw PTY prefix (legacy warm-reattach). Still populated for
   * compatibility; prefer `snapshot` when the daemon sends it.
   */
  replay: string;
  cols: number;
  rows: number;
  /**
   * Highest `seq` of any `data` frame for this PTY that is already reflected
   * in `snapshot` (or the legacy `replay` join). The renderer must not replay
   * live chunks with `seq <= streamSeq` after applying the attach. Omitted
   * when the daemon does not assign stream sequence numbers. `0` when no
   * output has been emitted yet.
   */
  streamSeq?: number;
  snapshot?: TerminalSnapshot;
}

/** Planning attach extends the session/shell attach shape with session metadata. */
export type PlanningAttachResult = AttachResult & { session: PlanningSession };

export interface CreateShellParams {
  sessionId: string;
  worktreePath: string;
  cols: number;
  rows: number;
}

export interface StartPlanningParams {
  projectId: string;
  agent: Agent;
  planningDir: string;
  command: string;
  args: string[];
  cols: number;
  rows: number;
}

export type StartPlanningResult =
  | PlanningSession
  | { error: 'AGENT_NOT_FOUND' | 'INVALID_PARAMS'; message: string };

// ---------------------------------------------------------------------------
// Stream frames (daemon → main, stream socket)
// ---------------------------------------------------------------------------

export type StreamTarget = 'session' | 'shell' | 'planning';

export type StreamFrame =
  | {
      kind: 'data';
      target: StreamTarget;
      id: string;
      data: string;
      /** Monotonic per PTY (session/shell/planning id) — used with `AttachResult.streamSeq`. */
      seq?: number;
    }
  | { kind: 'session-exit'; id: string; session: Session }
  | { kind: 'shell-exit'; id: string; shell: Shell }
  | { kind: 'planning-exit'; id: string; session: PlanningSession };

// ---------------------------------------------------------------------------
// NDJSON framer
// ---------------------------------------------------------------------------

/**
 * Stateful line splitter: feed raw socket chunks, get back completed JSON
 * lines. Handles arbitrary TCP/Unix-socket segmentation; any trailing
 * partial line is retained until the next chunk arrives.
 */
export class NdjsonSplitter {
  private buf = '';

  push(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }
}

/** Serialize a value as a single NDJSON line terminated with `\n`. */
export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
