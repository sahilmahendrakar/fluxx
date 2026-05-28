import type { ITheme } from '@xterm/xterm';
import type { ResolvedAppearance } from '../theme/appearance';

/** Dark PTY surface — keep aligned with `.dark` `--status-terminal` in index.css. */
export const TERMINAL_SURFACE_HEX_DARK = '#09090b';

/** Light PTY surface — keep aligned with `.light` `--status-terminal` / window background. */
export const TERMINAL_SURFACE_HEX_LIGHT = '#faf8f5';

/** @deprecated Use {@link terminalSurfaceHex} or {@link TERMINAL_SURFACE_HEX_DARK}. */
export const TERMINAL_SURFACE_HEX = TERMINAL_SURFACE_HEX_DARK;

export function terminalSurfaceHex(appearance: ResolvedAppearance): string {
  return appearance === 'light' ? TERMINAL_SURFACE_HEX_LIGHT : TERMINAL_SURFACE_HEX_DARK;
}

export const XTERM_DARK_THEME: ITheme = {
  background: TERMINAL_SURFACE_HEX_DARK,
  foreground: '#d4d4d8',
  cursor: '#a1a1aa',
  cursorAccent: TERMINAL_SURFACE_HEX_DARK,
  selectionBackground: 'rgba(255,255,255,0.12)',
  black: TERMINAL_SURFACE_HEX_DARK,
  brightBlack: '#52525b',
};

export const XTERM_LIGHT_THEME: ITheme = {
  background: TERMINAL_SURFACE_HEX_LIGHT,
  foreground: '#27272a',
  cursor: '#52525b',
  cursorAccent: TERMINAL_SURFACE_HEX_LIGHT,
  selectionBackground: 'rgba(0,0,0,0.14)',
  black: '#3f3f46',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#faf8f5',
  brightBlack: '#71717a',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

/** @deprecated Use {@link XTERM_DARK_THEME}. */
export const XTERM_FIXED_DARK_THEME = XTERM_DARK_THEME;

export function xtermThemeForAppearance(appearance: ResolvedAppearance): ITheme {
  return appearance === 'light' ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
}

/** Cursor hidden for agent-owned PTYs that draw their own prompt caret. */
export function xtermThemeForSurface(opts: {
  hideCursor: boolean;
  appearance: ResolvedAppearance;
}): ITheme {
  const base = xtermThemeForAppearance(opts.appearance);
  if (!opts.hideCursor) return base;
  return {
    ...base,
    cursor: 'rgba(0,0,0,0)',
  };
}
