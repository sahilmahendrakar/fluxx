// Wire protocol shared between the Flux main process and the detached
// session daemon. NDJSON (one JSON value per line) on two sockets:
//   - RPC socket   : main → daemon request/response, correlation ids
//   - stream socket: daemon → main PTY output frames
//
// See 0001-session-daemon.md for the architecture rationale. Two sockets
// avoid head-of-line blocking when a session spews output fast enough to
// fill the kernel buffer, which would otherwise queue RPC responses behind
// megabytes of `cat bigfile.log`.

import type { Agent, PlanningSession, Session, Shell } from '../types';

export const PROTOCOL_VERSION = 2;

/** Unix socket / named pipe names inside Electron userData. */
export const DAEMON_PID_FILE = 'flux-daemon.pid';
export const DAEMON_RPC_SOCK = 'flux-daemon.rpc.sock';
export const DAEMON_STREAM_SOCK = 'flux-daemon.stream.sock';
export const DAEMON_LOG_FILE = 'flux-daemon.log';

/** Windows named pipe paths. */
export const WIN_RPC_PIPE = '\\\\.\\pipe\\flux-daemon-rpc';
export const WIN_STREAM_PIPE = '\\\\.\\pipe\\flux-daemon-stream';

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

export interface AttachResult {
  replay: string;
  cols: number;
  rows: number;
}

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
  | { kind: 'data'; target: StreamTarget; id: string; data: string }
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
