import type { ITheme } from '@xterm/xterm';
import type { ThemeMode } from '../renderer/theme';

/**
 * xterm.js themes aligned with Flux dark/light UI. Full ANSI set keeps
 * agent CLIs, rg/git highlights, and TUI borders readable in both modes.
 */
export function fluxXtermTheme(mode: ThemeMode, hideCursor: boolean): ITheme {
  if (mode === 'light') {
    const bg = '#fafafa';
    const fg = '#3f3f46';
    const cursor = hideCursor ? 'rgba(0,0,0,0)' : '#27272a';
    const cursorAccent = hideCursor ? bg : bg;
    return {
      background: bg,
      foreground: fg,
      cursor,
      cursorAccent,
      selectionBackground: 'rgba(24, 24, 27, 0.14)',
      selectionInactiveBackground: 'rgba(24, 24, 27, 0.08)',
      black: '#52525b',
      red: '#b91c1c',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#1d4ed8',
      magenta: '#86198f',
      cyan: '#0e7490',
      white: '#71717a',
      brightBlack: '#a1a1aa',
      brightRed: '#dc2626',
      brightGreen: '#16a34a',
      brightYellow: '#ca8a04',
      brightBlue: '#2563eb',
      brightMagenta: '#a21caf',
      brightCyan: '#0891b2',
      brightWhite: '#18181b',
    };
  }

  const bg = '#09090b';
  const fg = '#d4d4d8';
  const cursor = hideCursor ? 'rgba(0,0,0,0)' : '#a1a1aa';
  const cursorAccent = hideCursor ? bg : bg;
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent,
    selectionBackground: 'rgba(255, 255, 255, 0.12)',
    selectionInactiveBackground: 'rgba(255, 255, 255, 0.06)',
    black: '#09090b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#e879f9',
    cyan: '#22d3ee',
    white: '#e4e4e7',
    brightBlack: '#52525b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#f0abfc',
    brightCyan: '#67e8f9',
    brightWhite: '#fafafa',
  };
}
