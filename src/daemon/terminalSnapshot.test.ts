import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import {
  buildRehydrateSequences,
  captureSerializedSnapshot,
  readTerminalModes,
} from './terminalSnapshot';

function mkTerm(rows = 5, scrollback = 100) {
  const t = new HeadlessTerminal({
    cols: 40,
    rows,
    scrollback,
    allowProposedApi: true,
  });
  const s = new SerializeAddon();
  t.loadAddon(s);
  return { t, s };
}

function flush(t: HeadlessTerminal): Promise<void> {
  return new Promise((resolve) => {
    t.write('', () => resolve());
  });
}

describe('terminalSnapshot', () => {
  it('readTerminalModes matches xterm defaults', async () => {
    const { t } = mkTerm();
    await flush(t);
    const m = readTerminalModes(t);
    expect(m.applicationCursorKeys).toBe(false);
    expect(m.bracketedPaste).toBe(false);
    expect(m.alternateScreen).toBe(false);
    expect(m.autoWrap).toBe(true);
    expect(m.cursorVisible).toBe(true);
  });

  it('detects bracketed paste and emits rehydrate', async () => {
    const { t } = mkTerm();
    await new Promise<void>((r) => t.write('\x1b[?2004h', r));
    const m = readTerminalModes(t);
    expect(m.bracketedPaste).toBe(true);
    expect(buildRehydrateSequences(m)).toContain('\x1b[?2004h');
  });

  it('detects application cursor keys', async () => {
    const { t } = mkTerm();
    await new Promise<void>((r) => t.write('\x1b[?1h', r));
    const m = readTerminalModes(t);
    expect(m.applicationCursorKeys).toBe(true);
    expect(buildRehydrateSequences(m)).toContain('\x1b[?1h');
  });

  it('serialized snapshot is final screen state after clear', async () => {
    const { t, s } = mkTerm();
    await new Promise<void>((r) => t.write('\x1b[HHELLO\x1b[2J\x1b[HBYE', r));
    const { snapshotAnsi } = captureSerializedSnapshot(t, s, 100);
    expect(snapshotAnsi).toContain('BYE');
    expect(snapshotAnsi).not.toContain('HELLO');
  });

  it('alternate buffer: snapshot includes 1049 entry; rehydrate omits alternate', async () => {
    const { t, s } = mkTerm();
    await new Promise<void>((r) => t.write('\x1b[?1049h\x1b[HALTSCR', r));
    const { snapshotAnsi, modes } = captureSerializedSnapshot(t, s, 100);
    expect(modes.alternateScreen).toBe(true);
    expect(snapshotAnsi).toContain('\x1b[?1049h');
    const re = buildRehydrateSequences(modes);
    expect(re).not.toMatch(/1049/);
    expect(re).not.toMatch(/\?47/);
  });

  it('resize keeps dimensions in sync for serialize', async () => {
    const { t, s } = mkTerm(3, 20);
    await new Promise<void>((r) => t.write('wide', r));
    t.resize(50, 8);
    await flush(t);
    const { snapshotAnsi } = captureSerializedSnapshot(t, s, 20);
    expect(snapshotAnsi).toContain('wide');
    expect(t.cols).toBe(50);
    expect(t.rows).toBe(8);
  });

  it('serialized line layout differs with terminal width (geometry-sensitive warm restore)', async () => {
    const longLine = 'A'.repeat(30);
    const t20 = new HeadlessTerminal({ cols: 20, rows: 5, scrollback: 50, allowProposedApi: true });
    const s20 = new SerializeAddon();
    t20.loadAddon(s20);
    await new Promise<void>((r) => t20.write(`\r${longLine}\r\n`, r));
    await flush(t20);
    const a20 = captureSerializedSnapshot(t20, s20, 50).snapshotAnsi;
    t20.dispose();

    const t40 = new HeadlessTerminal({ cols: 40, rows: 5, scrollback: 50, allowProposedApi: true });
    const s40 = new SerializeAddon();
    t40.loadAddon(s40);
    await new Promise<void>((r) => t40.write(`\r${longLine}\r\n`, r));
    await flush(t40);
    const a40 = captureSerializedSnapshot(t40, s40, 50).snapshotAnsi;
    t40.dispose();

    expect(a20).not.toBe(a40);
  });
});
