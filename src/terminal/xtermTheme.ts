import type { ITheme } from '@xterm/xterm';

/**
 * Embedded xterm grids stay on a fixed dark palette in both app themes.
 *
 * Light-mode app chrome uses shadcn `status-terminal` (`240 10% 4%` in index.css);
 * the PTY buffer uses this same surface hex so gutters and grid read as one plane.
 *
 * @see src/components/dev/ShadcnThemeSmoke.tsx (terminal tab)
 * @see planning/docs/shadcn-visual-refresh-plan.md — Open Questions
 */
export const TERMINAL_SURFACE_HEX = '#09090b';

export const XTERM_FIXED_DARK_THEME: ITheme = {
  background: TERMINAL_SURFACE_HEX,
  foreground: '#d4d4d8',
  cursor: '#a1a1aa',
  cursorAccent: TERMINAL_SURFACE_HEX,
  selectionBackground: 'rgba(255,255,255,0.12)',
  black: TERMINAL_SURFACE_HEX,
  brightBlack: '#52525b',
};

/** Cursor hidden for agent-owned PTYs that draw their own prompt caret. */
export function xtermThemeForSurface(opts: { hideCursor: boolean }): ITheme {
  return {
    ...XTERM_FIXED_DARK_THEME,
    cursor: opts.hideCursor ? 'rgba(0,0,0,0)' : XTERM_FIXED_DARK_THEME.cursor,
  };
}
