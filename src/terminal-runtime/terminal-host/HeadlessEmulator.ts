import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { TerminalModes, TerminalSnapshot } from '../protocol';
import { DEFAULT_TERMINAL_MODES } from './types';

const ESC = '\x1b';
const BEL = '\x07';
const MAX_ESCAPE_BUFFER_SIZE = 1024;

const MODE_MAP: Record<number, keyof TerminalModes> = {
  1: 'applicationCursorKeys',
  6: 'originMode',
  7: 'autoWrap',
  9: 'mouseX10',
  25: 'cursorVisible',
  47: 'alternateScreen',
  1000: 'mouseVT200',
  1001: 'mouseHighlight',
  1002: 'mouseCellMotion',
  1003: 'mouseAllMotion',
  1004: 'focusReporting',
  1005: 'mouseUTF8',
  1006: 'mouseSGR',
  1049: 'alternateScreen',
  2004: 'bracketedPaste',
};

export interface HeadlessEmulatorOptions {
  cols: number;
  rows: number;
  scrollback: number;
  cwd?: string;
}

export class HeadlessEmulator {
  private readonly terminal: HeadlessTerminal;
  private readonly serializeAddon: SerializeAddon;
  private modes: TerminalModes = { ...DEFAULT_TERMINAL_MODES };
  private cwd?: string;
  private escapeSequenceBuffer = '';
  private disposed = false;
  private pendingOutput: string[] = [];
  private onDataCallback?: (data: string) => void;

  constructor({ cols, rows, scrollback, cwd }: HeadlessEmulatorOptions) {
    this.cwd = cwd;
    this.terminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.onData((data) => {
      this.pendingOutput.push(data);
      this.onDataCallback?.(data);
    });
  }

  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback;
  }

  flushPendingOutput(): string[] {
    const output = this.pendingOutput;
    this.pendingOutput = [];
    return output;
  }

  write(data: string): void {
    if (this.disposed) return;
    this.parseTrackedEscapeSequences(data);
    this.terminal.write(data);
  }

  writeSync(data: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.parseTrackedEscapeSequences(data);
    return new Promise((resolve) => {
      this.terminal.write(data, () => resolve());
    });
  }

  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      this.terminal.write('', () => resolve());
    });
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    if (cols <= 0 || rows <= 0) return;
    this.terminal.resize(cols, rows);
  }

  getSnapshot(): TerminalSnapshot {
    const snapshotAnsi = this.serializeAddon.serialize({
      scrollback: this.terminal.options.scrollback ?? 0,
    });
    const xtermBufferType = this.terminal.buffer.active.type;
    const altBufferDebug = this.getAlternateBufferDebug();
    return {
      snapshotAnsi,
      rehydrateSequences: buildRehydrateSequences(this.modes),
      modes: { ...this.modes },
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      cwd: this.cwd,
      scrollbackLines: this.terminal.buffer.active.length,
      debug: {
        xtermBufferType,
        hasAltScreenEntry: snapshotAnsi.includes('\x1b[?1049h'),
        altBuffer: altBufferDebug,
        normalBufferLines: this.terminal.buffer.normal.length,
      },
    };
  }

  getDimensions(): { cols: number; rows: number } {
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  getModes(): TerminalModes {
    return { ...this.modes };
  }

  getCwd(): string | undefined {
    return this.cwd;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  getScrollbackLines(): number {
    return this.terminal.buffer.active.length;
  }

  clear(): void {
    if (this.disposed) return;
    this.terminal.clear();
  }

  reset(): void {
    if (this.disposed) return;
    this.terminal.reset();
    this.modes = { ...DEFAULT_TERMINAL_MODES };
    this.escapeSequenceBuffer = '';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
  }

  private parseTrackedEscapeSequences(data: string): void {
    const fullData = this.escapeSequenceBuffer + data;
    this.escapeSequenceBuffer = '';

    this.parseModeChanges(fullData);
    this.parseOsc7(fullData);

    const incomplete = findIncompleteTrackedSequence(fullData);
    if (incomplete && incomplete.length <= MAX_ESCAPE_BUFFER_SIZE) {
      this.escapeSequenceBuffer = incomplete;
    }
  }

  private parseModeChanges(data: string): void {
    const modeRegex = new RegExp(`${escapeRegex(ESC)}\\[\\?([0-9;]+)([hl])`, 'g');
    for (const match of data.matchAll(modeRegex)) {
      const enable = match[2] === 'h';
      for (const part of match[1].split(';')) {
        const modeName = MODE_MAP[Number.parseInt(part, 10)];
        if (modeName) {
          this.modes[modeName] = enable;
        }
      }
    }
  }

  private parseOsc7(data: string): void {
    const osc7Regex = new RegExp(
      `${escapeRegex(ESC)}\\]7;file://[^/]*(/.+?)(?:${escapeRegex(BEL)}|${escapeRegex(ESC)}\\\\)`,
      'g',
    );
    for (const match of data.matchAll(osc7Regex)) {
      if (!match[1]) continue;
      try {
        this.cwd = decodeURIComponent(match[1]);
      } catch {
        this.cwd = match[1];
      }
    }
  }

  private getAlternateBufferDebug():
    | {
        lines: number;
        nonEmptyLines: number;
        totalChars: number;
        cursorX: number;
        cursorY: number;
        sampleLines: string[];
      }
    | undefined {
    if (!this.modes.alternateScreen && this.terminal.buffer.active.type !== 'alternate') {
      return undefined;
    }

    const altBuffer = this.terminal.buffer.alternate;
    let nonEmptyLines = 0;
    let totalChars = 0;
    const sampleLines: string[] = [];

    for (let i = 0; i < altBuffer.length; i += 1) {
      const line = altBuffer.getLine(i);
      if (!line) continue;
      const lineText = line.translateToString(true);
      if (lineText.trim().length === 0) continue;
      nonEmptyLines += 1;
      totalChars += lineText.length;
      if (sampleLines.length < 3) {
        sampleLines.push(lineText.slice(0, 80));
      }
    }

    return {
      lines: altBuffer.length,
      nonEmptyLines,
      totalChars,
      cursorX: altBuffer.cursorX,
      cursorY: altBuffer.cursorY,
      sampleLines,
    };
  }
}

export function buildRehydrateSequences(modes: TerminalModes): string {
  const sequences: string[] = [];
  const addMode = (modeNum: number, enabled: boolean, defaultEnabled: boolean) => {
    if (enabled !== defaultEnabled) {
      sequences.push(`${ESC}[?${modeNum}${enabled ? 'h' : 'l'}`);
    }
  };

  addMode(1, modes.applicationCursorKeys, DEFAULT_TERMINAL_MODES.applicationCursorKeys);
  addMode(6, modes.originMode, DEFAULT_TERMINAL_MODES.originMode);
  addMode(7, modes.autoWrap, DEFAULT_TERMINAL_MODES.autoWrap);
  addMode(25, modes.cursorVisible, DEFAULT_TERMINAL_MODES.cursorVisible);
  addMode(9, modes.mouseX10, DEFAULT_TERMINAL_MODES.mouseX10);
  addMode(1000, modes.mouseVT200, DEFAULT_TERMINAL_MODES.mouseVT200);
  addMode(1001, modes.mouseHighlight, DEFAULT_TERMINAL_MODES.mouseHighlight);
  addMode(1002, modes.mouseCellMotion, DEFAULT_TERMINAL_MODES.mouseCellMotion);
  addMode(1003, modes.mouseAllMotion, DEFAULT_TERMINAL_MODES.mouseAllMotion);
  addMode(1005, modes.mouseUTF8, DEFAULT_TERMINAL_MODES.mouseUTF8);
  addMode(1006, modes.mouseSGR, DEFAULT_TERMINAL_MODES.mouseSGR);
  addMode(1004, modes.focusReporting, DEFAULT_TERMINAL_MODES.focusReporting);
  addMode(2004, modes.bracketedPaste, DEFAULT_TERMINAL_MODES.bracketedPaste);

  return sequences.join('');
}

function findIncompleteTrackedSequence(data: string): string | null {
  const lastEscIndex = data.lastIndexOf(ESC);
  if (lastEscIndex === -1) return null;

  const tail = data.slice(lastEscIndex);
  if (tail.startsWith(`${ESC}[?`)) {
    if (new RegExp(`^${escapeRegex(ESC)}\\[\\?[0-9;]+[hl]`).test(tail)) {
      return null;
    }
    return tail;
  }
  if (tail.startsWith(`${ESC}]7;`)) {
    if (tail.includes(BEL) || tail.includes(`${ESC}\\`)) return null;
    return tail;
  }
  if (
    tail === ESC ||
    tail === `${ESC}[` ||
    tail === `${ESC}]` ||
    tail === `${ESC}]7` ||
    new RegExp(`^${escapeRegex(ESC)}\\[\\?[0-9;]*$`).test(tail)
  ) {
    return tail;
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
