import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { AttachResult } from '../protocol';
import { HeadlessEmulator } from './HeadlessEmulator';
import type { TerminalSessionCallbacks, TerminalSessionSpawnSpec } from './types';

const DEFAULT_REPLAY_BYTES = 256 * 1024;
const HEADLESS_SCROLLBACK = 5000;
const ATTACH_BOUNDARY_TIMEOUT_MS = 500;

interface QueuedEmulatorWrite {
  data: string;
  seq: number;
}

interface BoundaryWaiter {
  id: number;
  targetProcessedItems: number;
  resolve: () => void;
}

export class TerminalSession {
  readonly pty: IPty;
  private readonly emulator: HeadlessEmulator;
  private replay: string[] = [];
  private replayBytes = 0;
  private readonly replayCapBytes: number;
  private exited = false;
  private lastExitCode = 0;
  private lastStreamSeq = 0;
  private emulatorProcessedStreamSeq = 0;
  private cols: number;
  private rows: number;
  private cwd: string;
  private attachChain: Promise<void> = Promise.resolve();
  private emulatorWriteQueue: QueuedEmulatorWrite[] = [];
  private emulatorWriteProcessedItems = 0;
  private emulatorWriteScheduled = false;
  private nextBoundaryWaiterId = 1;
  private boundaryWaiters: BoundaryWaiter[] = [];

  constructor(
    spec: TerminalSessionSpawnSpec,
    callbacks: TerminalSessionCallbacks,
    opts: { replayCapBytes?: number } = {},
  ) {
    this.replayCapBytes = opts.replayCapBytes ?? DEFAULT_REPLAY_BYTES;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.cwd = spec.cwd;
    this.emulator = new HeadlessEmulator({
      cols: spec.cols,
      rows: spec.rows,
      scrollback: HEADLESS_SCROLLBACK,
      cwd: spec.cwd,
    });

    this.pty = pty.spawn(spec.command, spec.args, {
      name: 'xterm-color',
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: spec.env ?? { ...process.env },
    });

    this.emulator.onData((data) => {
      if (!this.exited) this.pty.write(data);
    });

    this.pty.onData((chunk) => {
      this.appendReplay(chunk);
      this.lastStreamSeq += 1;
      const seq = this.lastStreamSeq;
      this.enqueueEmulatorWrite(chunk, seq);
      callbacks.onData(chunk, seq);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.lastExitCode = exitCode;
      this.resolveAllBoundaryWaiters();
      callbacks.onExit({ exitCode, signal });
    });
  }

  attach(): Promise<AttachResult> {
    const run = async (): Promise<AttachResult> => {
      await this.flushToSnapshotBoundary(ATTACH_BOUNDARY_TIMEOUT_MS);
      await this.emulator.flush();
      const snapshot = this.emulator.getSnapshot();
      const streamSeq = this.emulatorProcessedStreamSeq;
      return {
        replay: this.replay.join(''),
        cols: snapshot.cols,
        rows: snapshot.rows,
        streamSeq,
        snapshot,
      };
    };

    const next = this.attachChain.then(run);
    this.attachChain = next.then(() => undefined).catch(() => undefined);
    return next;
  }

  write(data: string): void {
    if (this.exited) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    if (cols <= 0 || rows <= 0) return;
    this.cols = cols;
    this.rows = rows;
    try {
      this.pty.resize(cols, rows);
    } catch {
      // Child may have just exited between the check and the call.
    }
    try {
      this.emulator.resize(cols, rows);
    } catch {
      // Ignore resize failures on the headless mirror.
    }
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.pty.kill();
    } catch {
      // PTY already gone.
    }
  }

  dispose(): void {
    this.emulator.dispose();
    this.emulatorWriteQueue = [];
    this.resolveAllBoundaryWaiters();
  }

  get isExited(): boolean {
    return this.exited;
  }

  get exitCode(): number {
    return this.lastExitCode;
  }

  get currentCwd(): string {
    return this.emulator.getCwd() ?? this.cwd;
  }

  private appendReplay(chunk: string): void {
    const bytes = Buffer.byteLength(chunk, 'utf8');
    this.replay.push(chunk);
    this.replayBytes += bytes;
    while (this.replayBytes > this.replayCapBytes && this.replay.length > 1) {
      const dropped = this.replay.shift();
      if (dropped !== undefined) {
        this.replayBytes -= Buffer.byteLength(dropped, 'utf8');
      }
    }
  }

  private enqueueEmulatorWrite(data: string, seq: number): void {
    this.emulatorWriteQueue.push({ data, seq });
    this.scheduleEmulatorWrite();
  }

  private scheduleEmulatorWrite(): void {
    if (this.emulatorWriteScheduled) return;
    this.emulatorWriteScheduled = true;
    setImmediate(() => this.processEmulatorWriteQueue());
  }

  private processEmulatorWriteQueue(): void {
    this.emulatorWriteScheduled = false;
    while (this.emulatorWriteQueue.length > 0) {
      const item = this.emulatorWriteQueue.shift();
      if (!item) break;
      this.emulator.write(item.data);
      this.emulatorProcessedStreamSeq = item.seq;
      this.emulatorWriteProcessedItems += 1;
      this.resolveReachedBoundaryWaiters();
    }
  }

  private async flushToSnapshotBoundary(timeoutMs: number): Promise<boolean> {
    const targetProcessedItems =
      this.emulatorWriteProcessedItems + this.emulatorWriteQueue.length;
    if (this.emulatorWriteProcessedItems >= targetProcessedItems) {
      return true;
    }

    const waiterId = this.nextBoundaryWaiterId++;
    let reachedBoundary = false;
    const boundary = new Promise<void>((resolve) => {
      this.boundaryWaiters.push({
        id: waiterId,
        targetProcessedItems,
        resolve: () => {
          reachedBoundary = true;
          resolve();
        },
      });
      this.scheduleEmulatorWrite();
      this.resolveReachedBoundaryWaiters();
    });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    await Promise.race([boundary, timeout]);
    if (!reachedBoundary) {
      this.boundaryWaiters = this.boundaryWaiters.filter((w) => w.id !== waiterId);
    }
    return reachedBoundary;
  }

  private resolveReachedBoundaryWaiters(): void {
    if (this.boundaryWaiters.length === 0) return;
    const pending: BoundaryWaiter[] = [];
    for (const waiter of this.boundaryWaiters) {
      if (this.emulatorWriteProcessedItems >= waiter.targetProcessedItems) {
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }
    this.boundaryWaiters = pending;
  }

  private resolveAllBoundaryWaiters(): void {
    const waiters = this.boundaryWaiters;
    this.boundaryWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }
}
