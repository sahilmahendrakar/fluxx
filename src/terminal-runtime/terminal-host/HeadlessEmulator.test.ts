import { describe, expect, it } from 'vitest';
import { HeadlessEmulator } from './HeadlessEmulator';

function mkEmulator(cols = 40, rows = 5): HeadlessEmulator {
  return new HeadlessEmulator({ cols, rows, scrollback: 100, cwd: '/tmp' });
}

describe('HeadlessEmulator', () => {
  it('tracks default modes without reading xterm internals', async () => {
    const emulator = mkEmulator();
    await emulator.flush();
    expect(emulator.getModes()).toMatchObject({
      applicationCursorKeys: false,
      bracketedPaste: false,
      alternateScreen: false,
      autoWrap: true,
      cursorVisible: true,
    });
    expect(emulator.getSnapshot().rehydrateSequences).toBe('');
    emulator.dispose();
  });

  it('tracks DECSET/DECRST modes across split chunks', async () => {
    const emulator = mkEmulator();
    emulator.write('\x1b[?20');
    emulator.write('04h\x1b[?1');
    emulator.write('h\x1b[?25l');
    await emulator.flush();
    expect(emulator.getModes().bracketedPaste).toBe(true);
    expect(emulator.getModes().applicationCursorKeys).toBe(true);
    expect(emulator.getModes().cursorVisible).toBe(false);
    const snapshot = emulator.getSnapshot();
    expect(snapshot.rehydrateSequences).toContain('\x1b[?2004h');
    expect(snapshot.rehydrateSequences).toContain('\x1b[?1h');
    expect(snapshot.rehydrateSequences).toContain('\x1b[?25l');
    emulator.dispose();
  });

  it('tracks OSC-7 cwd across split chunks', async () => {
    const emulator = mkEmulator();
    emulator.write('\x1b]7;file://localhost/Users/sahil');
    emulator.write('%20Mahendrakar/project\x07');
    await emulator.flush();
    expect(emulator.getSnapshot().cwd).toBe('/Users/sahil Mahendrakar/project');
    emulator.dispose();
  });

  it('serializes final screen state after redraw-heavy output', async () => {
    const emulator = mkEmulator();
    await emulator.writeSync('\x1b[HHELLO\x1b[2J\x1b[HBYE');
    const snapshot = emulator.getSnapshot();
    expect(snapshot.snapshotAnsi).toContain('BYE');
    expect(snapshot.snapshotAnsi).not.toContain('HELLO');
    expect(snapshot.debug).toMatchObject({
      xtermBufferType: 'normal',
      hasAltScreenEntry: false,
    });
    emulator.dispose();
  });

  it('does not serialize terminal history cleared with ED3', async () => {
    const emulator = new HeadlessEmulator({ cols: 20, rows: 3, scrollback: 100 });
    await emulator.writeSync('old thinking 1\r\nold thinking 2\r\nold thinking 3\r\n');
    await emulator.writeSync('\x1b[3J\x1b[H\x1b[2Jfinal answer');
    const snapshot = emulator.getSnapshot();
    expect(snapshot.snapshotAnsi).toContain('final answer');
    expect(snapshot.snapshotAnsi).not.toContain('old thinking');
    emulator.dispose();
  });

  it('preserves alternate screen in the snapshot but does not re-enter it in rehydrate', async () => {
    const emulator = mkEmulator();
    await emulator.writeSync('\x1b[?1049h\x1b[HALTSCR');
    const snapshot = emulator.getSnapshot();
    expect(snapshot.modes.alternateScreen).toBe(true);
    expect(snapshot.snapshotAnsi).toContain('\x1b[?1049h');
    expect(snapshot.debug?.hasAltScreenEntry).toBe(true);
    expect(snapshot.debug?.altBuffer?.nonEmptyLines).toBeGreaterThan(0);
    expect(snapshot.rehydrateSequences).not.toMatch(/1049/);
    expect(snapshot.rehydrateSequences).not.toMatch(/\?47/);
    emulator.dispose();
  });

  it('captures geometry-sensitive snapshots at the emulator grid size', async () => {
    const longLine = 'A'.repeat(30);
    const narrow = new HeadlessEmulator({ cols: 20, rows: 5, scrollback: 50 });
    await narrow.writeSync(`\r${longLine}\r\n`);
    const narrowSnapshot = narrow.getSnapshot();
    narrow.dispose();

    const wide = new HeadlessEmulator({ cols: 40, rows: 5, scrollback: 50 });
    await wide.writeSync(`\r${longLine}\r\n`);
    const wideSnapshot = wide.getSnapshot();
    wide.dispose();

    expect(narrowSnapshot.snapshotAnsi).not.toBe(wideSnapshot.snapshotAnsi);
    expect(narrowSnapshot.cols).toBe(20);
    expect(wideSnapshot.cols).toBe(40);
  });

  it('restores cursor position so subsequent input appends at the prompt', async () => {
    const source = new HeadlessEmulator({ cols: 20, rows: 5, scrollback: 50 });
    await source.writeSync('history 1\r\nhistory 2\r\nprompt> ');
    const snapshot = source.getSnapshot();
    source.dispose();

    const restored = new HeadlessEmulator({ cols: 20, rows: 5, scrollback: 50 });
    await restored.writeSync(snapshot.snapshotAnsi);
    await restored.writeSync(snapshot.rehydrateSequences);
    await restored.writeSync('abc');
    const afterInput = restored.getSnapshot().snapshotAnsi;

    expect(afterInput).toContain('prompt> abc');
    restored.dispose();
  });
});
