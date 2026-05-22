import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { AttachResult, TerminalSnapshot } from './protocol';
import { buildFluxxTmuxSessionName } from '../main/tmux/tmuxSessionName';
import { spawnFluxxTmuxSession, type FluxxTmuxSpawnSpec } from '../main/tmux/tmuxSpawn';
import { tmuxKillSession } from '../main/tmux/tmuxCommands';
import { buildPtyEnv, PTY_TERM_NAME } from './terminalEnv';
import { collapsedBottomScreenText } from './renderedScreenText';
import { buildRehydrateSequences, captureSerializedSnapshot } from './terminalSnapshot';
import type {
  SessionRuntimeCallbacks,
  SessionRuntimeSpawnSpec,
} from './SessionRuntime';

const DEFAULT_REPLAY_BYTES = 256 * 1024;
const HEADLESS_SCROLLBACK = 5000;
const ATTACH_SNAPSHOT_SERIALIZE_SCROLLBACK = 0;

export interface TmuxTerminalRuntimeSpawnSpec extends SessionRuntimeSpawnSpec {
  kind: import('../types').TerminalKind;
  terminalId: string;
  projectSlugSource: string;
  launcherPath: string;
}

/**
 * One Fluxx-owned tmux session plus a single node-pty attach bridge. Renderer
 * warm attach reuses this bridge — no duplicate tmux clients per tab remount.
 */
export class TmuxTerminalRuntime {
  readonly isTmuxBacked = true as const;
  readonly tmuxSessionName: string;
  private attachPty: IPty | null = null;
  readonly headless: HeadlessTerminal;
  private readonly serializeAddon: SerializeAddon;
  private snapshotChain: Promise<void> = Promise.resolve();
  private replay: string[] = [];
  private replayBytes = 0;
  private readonly replayCapBytes: number;
  private exited = false;
  private lastExitCode = 0;
  private lastStreamSeq = 0;
  private cols: number;
  private rows: number;
  private cwd: string;
  private readonly callbacks: SessionRuntimeCallbacks;
  private bridgeDetached = false;

  private constructor(
    tmuxSessionName: string,
    spec: SessionRuntimeSpawnSpec,
    callbacks: SessionRuntimeCallbacks,
    replayCapBytes: number,
  ) {
    this.tmuxSessionName = tmuxSessionName;
    this.callbacks = callbacks;
    this.replayCapBytes = replayCapBytes;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.cwd = spec.cwd;

    this.headless = new HeadlessTerminal({
      cols: spec.cols,
      rows: spec.rows,
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.headless.loadAddon(this.serializeAddon);
  }

  static async create(
    spec: TmuxTerminalRuntimeSpawnSpec,
    callbacks: SessionRuntimeCallbacks,
    opts: { replayCapBytes?: number } = {},
  ): Promise<TmuxTerminalRuntime> {
    const tmuxSessionName = buildFluxxTmuxSessionName({
      kind: spec.kind,
      projectSlugSource: spec.projectSlugSource,
      terminalId: spec.terminalId,
    });

    const spawnSpec: FluxxTmuxSpawnSpec = {
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: buildPtyEnv(spec.env ?? process.env, {
        termProgram: spec.termProgram,
      }) as Record<string, string | undefined>,
    };

    await spawnFluxxTmuxSession({
      sessionName: tmuxSessionName,
      spec: spawnSpec,
      terminalId: spec.terminalId,
      cols: spec.cols,
      rows: spec.rows,
      spawnWrapperPath: spec.launcherPath,
      electronExe: process.execPath,
    });

    const runtime = new TmuxTerminalRuntime(
      tmuxSessionName,
      spec,
      callbacks,
      opts.replayCapBytes ?? DEFAULT_REPLAY_BYTES,
    );
    runtime.startAttachBridge(spec);
    return runtime;
  }

  /**
   * Reattach to an existing Fluxx-owned tmux session on app relaunch (no `new-session`).
   */
  static async attachExisting(
    spec: {
      tmuxSessionName: string;
      cwd: string;
      cols: number;
      rows: number;
      env?: NodeJS.ProcessEnv;
      termProgram?: string;
    },
    callbacks: SessionRuntimeCallbacks,
    opts: { replayCapBytes?: number } = {},
  ): Promise<TmuxTerminalRuntime> {
    const bridgeSpec: SessionRuntimeSpawnSpec = {
      command: '',
      args: [],
      cwd: spec.cwd,
      cols: spec.cols,
      rows: spec.rows,
      env: spec.env,
      termProgram: spec.termProgram,
    };
    const runtime = new TmuxTerminalRuntime(
      spec.tmuxSessionName,
      bridgeSpec,
      callbacks,
      opts.replayCapBytes ?? DEFAULT_REPLAY_BYTES,
    );
    runtime.startAttachBridge(bridgeSpec);
    return runtime;
  }

  private startAttachBridge(spec: SessionRuntimeSpawnSpec): void {
    if (this.attachPty) return;
    this.attachPty = pty.spawn('tmux', ['attach-session', '-t', this.tmuxSessionName], {
      name: PTY_TERM_NAME,
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: buildPtyEnv(spec.env ?? process.env, {
        termProgram: spec.termProgram,
      }),
    });

    this.attachPty.onData((chunk) => {
      this.appendReplay(chunk);
      this.headless.write(chunk);
      this.lastStreamSeq += 1;
      this.callbacks.onData(chunk, this.lastStreamSeq);
    });

    this.attachPty.onExit(({ exitCode, signal }) => {
      if (this.bridgeDetached) return;
      this.exited = true;
      this.lastExitCode = exitCode;
      this.callbacks.onExit({ exitCode, signal });
    });
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

  snapshot(): Promise<AttachResult> {
    const run = async (): Promise<AttachResult> => {
      await this.flushHeadlessWrites();
      const { snapshotAnsi, modes } = captureSerializedSnapshot(
        this.headless,
        this.serializeAddon,
        ATTACH_SNAPSHOT_SERIALIZE_SCROLLBACK,
      );
      const snapshot: TerminalSnapshot = {
        snapshotAnsi,
        rehydrateSequences: buildRehydrateSequences(modes),
        modes,
        cols: this.cols,
        rows: this.rows,
      };
      return {
        replay: this.replay.join(''),
        cols: this.cols,
        rows: this.rows,
        streamSeq: this.lastStreamSeq,
        snapshot,
      };
    };
    const next = this.snapshotChain.then(run);
    this.snapshotChain = next.then(() => undefined).catch(() => undefined);
    return next;
  }

  private flushHeadlessWrites(): Promise<void> {
    return new Promise((resolve) => {
      this.headless.write('', () => resolve());
    });
  }

  flushHeadlessParser(): Promise<void> {
    return this.flushHeadlessWrites();
  }

  getCollapsedBottomScreenText(maxLines = 40): string {
    return collapsedBottomScreenText(this.headless, maxLines);
  }

  write(data: string): void {
    if (this.exited || !this.attachPty) return;
    this.attachPty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited || !this.attachPty) return;
    if (cols <= 0 || rows <= 0) return;
    this.cols = cols;
    this.rows = rows;
    try {
      this.attachPty.resize(cols, rows);
    } catch {
      /* child may have exited */
    }
    try {
      this.headless.resize(cols, rows);
    } catch {
      /* ignore */
    }
  }

  interrupt(): void {
    this.write('\x03');
  }

  /**
   * App quit: drop the attach bridge only; leave the tmux session running.
   */
  detachAttachBridgeForAppQuit(): void {
    if (!this.attachPty || this.bridgeDetached) return;
    this.bridgeDetached = true;
    try {
      this.attachPty.kill();
    } catch {
      /* already gone */
    }
    this.attachPty = null;
  }

  /** Explicit stop/delete: kill tmux session and dispose attach bridge. */
  kill(signal?: string): void {
    if (this.exited && this.bridgeDetached) return;
    this.bridgeDetached = true;
    if (this.attachPty) {
      try {
        if (signal) this.attachPty.kill(signal);
        else this.attachPty.kill();
      } catch {
        /* ignore */
      }
      this.attachPty = null;
    }
    void tmuxKillSession(this.tmuxSessionName);
    this.exited = true;
  }

  dispose(): void {
    try {
      this.headless.dispose();
    } catch {
      /* ignore */
    }
  }

  get isExited(): boolean {
    return this.exited;
  }

  get exitCode(): number {
    return this.lastExitCode;
  }

  get currentCwd(): string {
    return this.cwd;
  }
}
