import { describe, expect, it } from 'vitest';
import {
  TERMINAL_SURFACE_HEX_DARK,
  TERMINAL_SURFACE_HEX_LIGHT,
  terminalSurfaceHex,
  xtermThemeForAppearance,
  xtermThemeForSurface,
} from './xtermTheme';

describe('xtermTheme', () => {
  it('maps appearance to terminal surface hex', () => {
    expect(terminalSurfaceHex('light')).toBe(TERMINAL_SURFACE_HEX_LIGHT);
    expect(terminalSurfaceHex('dark')).toBe(TERMINAL_SURFACE_HEX_DARK);
  });

  it('uses light background and dark foreground in light mode', () => {
    const theme = xtermThemeForAppearance('light');
    expect(theme.background).toBe(TERMINAL_SURFACE_HEX_LIGHT);
    expect(theme.foreground).toMatch(/^#/);
    expect(theme.foreground).not.toBe('#d4d4d8');
  });

  it('uses dark background and light foreground in dark mode', () => {
    const theme = xtermThemeForAppearance('dark');
    expect(theme.background).toBe(TERMINAL_SURFACE_HEX_DARK);
    expect(theme.foreground).toBe('#d4d4d8');
  });

  it('hides cursor when requested', () => {
    const theme = xtermThemeForSurface({ hideCursor: true, appearance: 'dark' });
    expect(theme.cursor).toBe('rgba(0,0,0,0)');
  });
});
