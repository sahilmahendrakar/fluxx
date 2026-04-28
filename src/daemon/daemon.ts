// Flux session daemon entry point.
//
// Spawned by the Electron main process via:
//   child_process.spawn(process.execPath, [daemonEntry], {
//     env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FLUX_DAEMON_USER_DATA: userDataPath },
//     detached: true,
//     stdio: 'ignore',
//   }).unref()
//
// Opens two Unix servers (short paths under os.tmpdir(), keyed by userData) or
// Windows named pipes:
//   - flux-daemon.rpc.sock    — request/response NDJSON
//   - flux-daemon.stream.sock — server-push NDJSON (PTY output)
//
// The daemon survives quitting Electron so `cmd-Q` → relaunch keeps
// live sessions running. See 0001-session-daemon.md.

import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { DaemonCore } from './DaemonCore';
import {
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  NdjsonSplitter,
  PROTOCOL_VERSION,
  WIN_RPC_PIPE,
  WIN_STREAM_PIPE,
  daemonUnixSocketPaths,
  encodeLine,
} from './protocol';
import type {
  CreateSessionParams,
  CreateShellParams,
  Hello,
  PingResult,
  RpcRequest,
  RpcResponse,
  StartPlanningParams,
  StreamFrame,
} from './protocol';

const userData = process.env.FLUX_DAEMON_USER_DATA;
if (!userData) {
  process.stderr.write('flux-daemon: FLUX_DAEMON_USER_DATA not set\n');
  process.exit(2);
}

const isWin = process.platform === 'win32';
const pidPath = path.join(userData, DAEMON_PID_FILE);
const logPath = path.join(userData, DAEMON_LOG_FILE);
let rpcPath: string;
let streamPath: string;
/** Non-null on Unix: directory created in main() before listen(). */
let socketRuntimeDir: string | null = null;
if (isWin) {
  rpcPath = WIN_RPC_PIPE;
  streamPath = WIN_STREAM_PIPE;
} else {
  const u = daemonUnixSocketPaths(userData);
  rpcPath = u.rpcPath;
  streamPath = u.streamPath;
  socketRuntimeDir = u.runtimeDir;
}

function log(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // Logging failures must not crash the daemon.
  }
}

async function cleanStaleSocket(p: string): Promise<void> {
  if (isWin) return;
  try {
    await fsp.unlink(p);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    // Fall through: listen() will fail loudly if the file is still in use.
  }
}

function writePidfile(): void {
  try {
    fs.writeFileSync(pidPath, String(process.pid), 'utf8');
  } catch (err) {
    log('pidfile write failed', err);
    process.exit(3);
  }
}

function removePidfile(): void {
  try {
    const raw = fs.readFileSync(pidPath, 'utf8');
    if (raw.trim() === String(process.pid)) {
      fs.unlinkSync(pidPath);
    }
  } catch {
    // Already gone, or another daemon owns it now.
  }
}

// ---------------------------------------------------------------------------
// Stream socket — at most one active client; broadcasts daemon→main frames.
// ---------------------------------------------------------------------------

let streamClient: net.Socket | null = null;

function broadcast(frame: StreamFrame): void {
  if (!streamClient || streamClient.destroyed) return;
  try {
    streamClient.write(encodeLine(frame));
  } catch (err) {
    log('stream write failed', err);
  }
}

const daemon = new DaemonCore(broadcast);

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

async function handleRpc(req: RpcRequest): Promise<RpcResponse> {
  const id = req.id;
  try {
    switch (req.method) {
      case 'ping': {
        const result: PingResult = {
          protocolVersion: PROTOCOL_VERSION,
          pid: process.pid,
        };
        return { id, result };
      }
      case 'createSession':
        return { id, result: daemon.createSession(req.params as CreateSessionParams) };
      case 'listSessions':
        return { id, result: daemon.listSessions() };
      case 'attachSession':
        return {
          id,
          result: await daemon.attachSession((req.params as { id: string }).id),
        };
      case 'writeSession': {
        const p = req.params as { id: string; data: string };
        daemon.writeSession(p.id, p.data);
        return { id, result: null };
      }
      case 'resizeSession': {
        const p = req.params as { id: string; cols: number; rows: number };
        daemon.resizeSession(p.id, p.cols, p.rows);
        return { id, result: null };
      }
      case 'stopSession': {
        daemon.stopSession((req.params as { id: string }).id);
        return { id, result: null };
      }

      case 'createShell':
        return { id, result: daemon.createShell(req.params as CreateShellParams) };
      case 'listShells': {
        const p = req.params as { sessionId?: string } | undefined;
        return { id, result: daemon.listShells(p?.sessionId) };
      }
      case 'attachShell':
        return {
          id,
          result: await daemon.attachShell((req.params as { id: string }).id),
        };
      case 'writeShell': {
        const p = req.params as { id: string; data: string };
        daemon.writeShell(p.id, p.data);
        return { id, result: null };
      }
      case 'resizeShell': {
        const p = req.params as { id: string; cols: number; rows: number };
        daemon.resizeShell(p.id, p.cols, p.rows);
        return { id, result: null };
      }
      case 'closeShell': {
        daemon.closeShell((req.params as { id: string }).id);
        return { id, result: null };
      }
      case 'closeShellsForSession': {
        daemon.closeShellsForSession(
          (req.params as { sessionId: string }).sessionId,
        );
        return { id, result: null };
      }

      case 'startPlanning':
        return { id, result: daemon.startPlanning(req.params as StartPlanningParams) };
      case 'listPlanning':
        return { id, result: daemon.listPlanning() };
      case 'stopPlanning': {
        daemon.stopPlanning((req.params as { id: string }).id);
        return { id, result: null };
      }
      case 'getPlanning':
        return { id, result: daemon.getPlanning((req.params as { id: string }).id) };
      case 'attachPlanning':
        return {
          id,
          result: await daemon.attachPlanning((req.params as { id: string }).id),
        };
      case 'writePlanning': {
        const p = req.params as { id: string; data: string };
        daemon.writePlanning(p.id, p.data);
        return { id, result: null };
      }
      case 'resizePlanning': {
        const p = req.params as { id: string; cols: number; rows: number };
        daemon.resizePlanning(p.id, p.cols, p.rows);
        return { id, result: null };
      }

      case 'shutdown': {
        // Reply first, then exit on next tick so the line makes it out.
        setImmediate(() => {
          log('shutdown requested');
          daemon.killAll();
          removePidfile();
          process.exit(0);
        });
        return { id, result: null };
      }

      default:
        return {
          id,
          error: { code: 'UNKNOWN_METHOD', message: `unknown method: ${req.method}` },
        };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log('rpc handler threw', req.method, message);
    return { id, error: { code: 'HANDLER_THREW', message } };
  }
}

function sendHello(socket: net.Socket, role: 'daemon'): void {
  const hello: Hello = { hello: 'flux-daemon', protocolVersion: PROTOCOL_VERSION, role };
  socket.write(encodeLine(hello));
}

function bindSocket(
  socket: net.Socket,
  onLine: (line: string) => void,
  onClose: () => void,
): void {
  const splitter = new NdjsonSplitter();
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    for (const line of splitter.push(chunk)) onLine(line);
  });
  socket.on('close', onClose);
  socket.on('error', (err) => {
    log('socket error', err.message);
  });
}

const rpcServer = net.createServer((socket) => {
  log('rpc client connected');
  sendHello(socket, 'daemon');
  let helloSeen = false;
  /** Preserve RPC response order when handlers await (e.g. attach snapshots). */
  let rpcTail: Promise<void> = Promise.resolve();
  bindSocket(
    socket,
    (line) => {
      rpcTail = rpcTail
        .then(async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            log('rpc: bad json, ignoring');
            return;
          }
          if (!helloSeen) {
            // First frame from main must be a Hello.
            const hello = parsed as Partial<Hello>;
            if (
              hello?.hello !== 'flux-daemon' ||
              typeof hello.protocolVersion !== 'number'
            ) {
              log('rpc: expected hello, closing');
              socket.end();
              return;
            }
            if (hello.protocolVersion !== PROTOCOL_VERSION) {
              log(
                `rpc: protocol mismatch (peer=${hello.protocolVersion}, us=${PROTOCOL_VERSION})`,
              );
              socket.end();
              return;
            }
            helloSeen = true;
            return;
          }
          const req = parsed as RpcRequest;
          if (typeof req?.id !== 'number' || typeof req?.method !== 'string') {
            log('rpc: malformed request, ignoring');
            return;
          }
          const response = await handleRpc(req);
          try {
            socket.write(encodeLine(response));
          } catch (err) {
            log('rpc write failed', err);
          }
        })
        .catch((err) => {
          log('rpc line handler failed', err instanceof Error ? err.message : err);
        });
    },
    () => {
      log('rpc client disconnected');
    },
  );
});

const streamServer = net.createServer((socket) => {
  log('stream client connected');
  if (streamClient && !streamClient.destroyed) {
    // Only one stream consumer at a time; drop the old one so the new
    // Electron instance wins after a relaunch.
    try {
      streamClient.end();
    } catch {
      // ignore
    }
  }
  streamClient = socket;
  sendHello(socket, 'daemon');
  bindSocket(
    socket,
    (line) => {
      // Stream socket is server-push; any inbound line from main should
      // just be a hello. We don't act on anything else.
      try {
        const parsed = JSON.parse(line) as Partial<Hello>;
        if (parsed?.hello !== 'flux-daemon') {
          log('stream: unexpected inbound line');
        } else if (parsed.protocolVersion !== PROTOCOL_VERSION) {
          log('stream: protocol mismatch, closing');
          socket.end();
        }
      } catch {
        log('stream: bad json, ignoring');
      }
    },
    () => {
      log('stream client disconnected');
      if (streamClient === socket) streamClient = null;
    },
  );
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Detach from the controlling terminal / pipes so the child survives
  // the Electron parent closing its stdio.
  try {
    if (typeof process.disconnect === 'function') {
      try {
        process.disconnect();
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  if (socketRuntimeDir) {
    await fsp.mkdir(socketRuntimeDir, { recursive: true });
  }

  await cleanStaleSocket(rpcPath);
  await cleanStaleSocket(streamPath);

  rpcServer.listen(rpcPath);
  streamServer.listen(streamPath);
  await Promise.all([once(rpcServer, 'listening'), once(streamServer, 'listening')]);

  if (!isWin) {
    try {
      fs.chmodSync(rpcPath, 0o600);
      fs.chmodSync(streamPath, 0o600);
    } catch (err) {
      log('chmod sockets failed', err);
    }
  }

  writePidfile();
  log(`flux-daemon started pid=${process.pid} rpc=${rpcPath} stream=${streamPath}`);

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      log(`caught ${sig}, shutting down`);
      daemon.killAll();
      removePidfile();
      try {
        rpcServer.close();
        streamServer.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  }

  process.on('uncaughtException', (err) => {
    log('uncaughtException', err instanceof Error ? err.stack ?? err.message : err);
  });
  process.on('unhandledRejection', (reason) => {
    log('unhandledRejection', reason instanceof Error ? reason.stack ?? reason.message : reason);
  });
}

main().catch((err) => {
  log('fatal boot error', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
