import { describe, expect, it } from 'vitest';
import { fluxXtermTheme } from './fluxXtermTheme';

describe('fluxXtermTheme', () => {
  it('returns distinct palettes for dark and light', () => {
    const dark = fluxXtermTheme('dark', false);
    const light = fluxXtermTheme('light', false);
    expect(dark.background).not.toBe(light.background);
    expect(dark.foreground).not.toBe(light.foreground);
    expect(dark.red).toBeDefined();
    expect(light.red).toBeDefined();
  });

  it('hides cursor when requested', () => {
    const t = fluxXtermTheme('light', true);
    expect(t.cursor).toBe('rgba(0,0,0,0)');
  });
});
