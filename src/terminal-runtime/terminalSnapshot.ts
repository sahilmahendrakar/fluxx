import { SerializeAddon } from '@xterm/addon-serialize';
import type { Terminal } from '@xterm/headless';
import type { TerminalModes } from './protocol';

/** Narrow view of xterm internals used only for snapshot metadata. */
interface CoreMouseService {
  activeProtocol: string;
  activeEncoding: string;
}

interface CoreService {
  isCursorHidden: boolean;
}

interface XtermCore {
  coreService: CoreService;
  coreMouseService: CoreMouseService;
}

function getCore(term: Terminal): XtermCore {
  return (term as unknown as { _core: XtermCore })._core;
}

/**
 * Maps the live headless xterm into the wire `TerminalModes` contract.
 * Mouse highlight (CSI ?1001) is not surfaced separately by xterm.js v6.
 */
export function readTerminalModes(terminal: Terminal): TerminalModes {
  const m = terminal.modes;
  const core = getCore(terminal);
  // @xterm/headless 6+ may omit `coreMouseService` on the private `_core` shim
  // used in Vitest; treat as “no mouse tracking” instead of crashing snapshots.
  const mouse = core.coreMouseService;
  const mouseProto = mouse?.activeProtocol ?? '';
  const enc = mouse?.activeEncoding ?? '';

  return {
    applicationCursorKeys: m.applicationCursorKeysMode,
    originMode: m.originMode,
    autoWrap: m.wraparoundMode,
    cursorVisible: !core.coreService.isCursorHidden,
    alternateScreen: terminal.buffer.active.type === 'alternate',
    mouseX10: mouseProto === 'X10',
    mouseVT200: mouseProto === 'VT200',
    mouseHighlight: false,
    mouseCellMotion: mouseProto === 'DRAG',
    mouseAllMotion: mouseProto === 'ANY',
    mouseUTF8: false,
    mouseSGR: enc === 'SGR' || enc === 'SGR_PIXELS',
    focusReporting: m.sendFocusMode,
    bracketedPaste: m.bracketedPasteMode,
  };
}

/**
 * DECSET/DECRST sequences to run after `snapshotAnsi` on a fresh renderer
 * terminal (see `AttachResult` / planning doc). Omits alternate-screen
 * entry (`CSI ?47` / `CSI ?1049`) because `SerializeAddon.serialize` already
 * emits `CSI ?1049h` + home when the active buffer is the alternate screen.
 */
export function buildRehydrateSequences(modes: TerminalModes): string {
  let s = '';
  s += '\x1b[?1006l\x1b[?1005l\x1b[?1003l\x1b[?1002l\x1b[?1001l\x1b[?1000l\x1b[?9l';
  if (modes.mouseAllMotion) s += '\x1b[?1003h';
  else if (modes.mouseCellMotion) s += '\x1b[?1002h';
  else if (modes.mouseVT200) s += '\x1b[?1000h';
  else if (modes.mouseX10) s += '\x1b[?9h';
  if (modes.mouseHighlight) s += '\x1b[?1001h';
  if (modes.mouseUTF8) s += '\x1b[?1005h';
  if (modes.mouseSGR) s += '\x1b[?1006h';
  if (modes.focusReporting) s += '\x1b[?1004h';
  else s += '\x1b[?1004l';
  if (modes.bracketedPaste) s += '\x1b[?2004h';
  else s += '\x1b[?2004l';
  if (modes.applicationCursorKeys) s += '\x1b[?1h';
  else s += '\x1b[?1l';
  if (modes.originMode) s += '\x1b[?6h';
  else s += '\x1b[?6l';
  if (modes.autoWrap) s += '\x1b[?7h';
  else s += '\x1b[?7l';
  if (modes.cursorVisible) s += '\x1b[?25h';
  else s += '\x1b[?25l';
  return s;
}

export function captureSerializedSnapshot(
  terminal: Terminal,
  serializeAddon: InstanceType<typeof SerializeAddon>,
  scrollback: number,
): { snapshotAnsi: string; modes: TerminalModes } {
  const snapshotAnsi = serializeAddon.serialize({
    excludeModes: true,
    scrollback,
  });
  return { snapshotAnsi, modes: readTerminalModes(terminal) };
}
