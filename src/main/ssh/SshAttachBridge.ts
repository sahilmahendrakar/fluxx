import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { AttachResult, TerminalSnapshot } from '../../terminal-runtime/protocol';
import { buildPtyEnv, PTY_TERM_NAME } from '../../terminal-runtime/terminalEnv';
import { buildRehydrateSequences, captureSerializedSnapshot } from '../../terminal-runtime/terminalSnapshot';
import type { ExecutionDeviceSshConfig } from '../../types';
import { buildOpenSshAttachArgv } from './opensshRunner';

const DEFAULT_REPLAY_BYTES = 256 * 1024;
const HEADLESS_SCROLLBACK = 5000;
const ATTACH_SNAPSHOT_SERIALIZE_SCROLLBACK = 0;

export type SshAttachBridgeCallbacks = {
  onData: (data: string, seq: number) => void;
  /** Local SSH attach bridge dropped; remote tmux may still be running. */
  onBridgeDetach?: (info: { exitCode: number; signal?: number }) => void;
};

export type SshAttachBridgeSpec = {
  ssh: ExecutionDeviceSshConfig;
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
  termProgram?: string;
};

export type SshAttachBridgeCreateOpts = {
  replayCapBytes?: number;
  spawnPty?: typeof pty.spawn;
};

/**
 * Local node-pty running `ssh -tt … fluxx-remote-helper attach-terminal <id>`.
 * Detaching the bridge must not be treated as remote session exit.
 */
export class SshAttachBridge {
  private attachPty: IPty | null = null;
  readonly headless: HeadlessTerminal;
  private readonly serializeAddon: SerializeAddon;
  private snapshotChain: Promise<void> = Promise.resolve();
  private replay: string[] = [];
  private replayBytes = 0;
  private readonly replayCapBytes: number;
  private bridgeDetached = false;
  private lastStreamSeq = 0;
  private cols: number;
  private rows: number;
  private readonly callbacks: SshAttachBridgeCallbacks;
  private readonly spawnPty: typeof pty.spawn;

  private constructor(
    spec: SshAttachBridgeSpec,
    callbacks: SshAttachBridgeCallbacks,
    replayCapBytes: number,
    spawnPty: typeof pty.spawn,
  ) {
    this.callbacks = callbacks;
    this.replayCapBytes = replayCapBytes;
    this.spawnPty = spawnPty;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.headless = new HeadlessTerminal({
      cols: spec.cols,
      rows: spec.rows,
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.headless.loadAddon(this.serializeAddon);
    this.startAttachBridge(spec);
  }

  static create(
    spec: SshAttachBridgeSpec,
    callbacks: SshAttachBridgeCallbacks,
    opts: SshAttachBridgeCreateOpts = {},
  ): SshAttachBridge {
    return new SshAttachBridge(
      spec,
      callbacks,
      opts.replayCapBytes ?? DEFAULT_REPLAY_BYTES,
      opts.spawnPty ?? pty.spawn,
    );
  }

  private startAttachBridge(spec: SshAttachBridgeSpec): void {
    if (this.attachPty) return;
    const argv = buildOpenSshAttachArgv(spec.ssh, spec.terminalId);
    this.attachPty = this.spawnPty(argv[0], argv.slice(1), {
      name: PTY_TERM_NAME,
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: buildPtyEnv(process.env, { termProgram: spec.termProgram ?? 'kitty' }),
    });

    this.attachPty.onData((chunk) => {
      this.appendReplay(chunk);
      this.headless.write(chunk);
      this.lastStreamSeq += 1;
      this.callbacks.onData(chunk, this.lastStreamSeq);
    });

    this.attachPty.onExit(({ exitCode, signal }) => {
      if (this.bridgeDetached) return;
      this.bridgeDetached = true;
      this.attachPty = null;
      this.callbacks.onBridgeDetach?.({ exitCode, signal });
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

  write(data: string): void {
    if (this.bridgeDetached || !this.attachPty) return;
    this.attachPty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.bridgeDetached || !this.attachPty) return;
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

  detachForAppQuit(): void {
    if (!this.attachPty || this.bridgeDetached) return;
    this.bridgeDetached = true;
    try {
      this.attachPty.kill();
    } catch {
      /* already gone */
    }
    this.attachPty = null;
  }

  killBridge(): void {
    this.detachForAppQuit();
  }

  get isBridgeAttached(): boolean {
    return this.attachPty != null && !this.bridgeDetached;
  }

  dispose(): void {
    this.killBridge();
    try {
      this.headless.dispose();
    } catch {
      /* ignore */
    }
  }
}
