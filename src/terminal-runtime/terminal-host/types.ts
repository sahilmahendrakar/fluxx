import type { TerminalModes } from '../protocol';

export type { TerminalModes, TerminalSnapshot, AttachResult } from '../protocol';

export const DEFAULT_TERMINAL_MODES: TerminalModes = {
  applicationCursorKeys: false,
  originMode: false,
  autoWrap: true,
  cursorVisible: true,
  alternateScreen: false,
  mouseX10: false,
  mouseVT200: false,
  mouseHighlight: false,
  mouseCellMotion: false,
  mouseAllMotion: false,
  mouseUTF8: false,
  mouseSGR: false,
  focusReporting: false,
  bracketedPaste: false,
};

export interface TerminalSessionSpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: NodeJS.ProcessEnv;
}

export interface TerminalSessionCallbacks {
  onData: (data: string, seq: number) => void;
  onExit: (info: { exitCode: number; signal?: number }) => void;
}
