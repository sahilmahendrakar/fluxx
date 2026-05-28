import { describe, expect, it } from 'vitest';
import {
  normalizeAppearancePreference,
  resolveAppearanceWithSystemDark,
  windowBackgroundForAppearance,
} from './appearance';

describe('appearance', () => {
  it('normalizes invalid preferences to dark', () => {
    expect(normalizeAppearancePreference('light')).toBe('light');
    expect(normalizeAppearancePreference('system')).toBe('system');
    expect(normalizeAppearancePreference('nope')).toBe('dark');
  });

  it('resolves system preference from OS hint', () => {
    expect(resolveAppearanceWithSystemDark('system', true)).toBe('dark');
    expect(resolveAppearanceWithSystemDark('system', false)).toBe('light');
    expect(resolveAppearanceWithSystemDark('dark', false)).toBe('dark');
  });

  it('maps window backgrounds for Electron chrome', () => {
    expect(windowBackgroundForAppearance('dark')).toBe('#09090b');
    expect(windowBackgroundForAppearance('light')).toBe('#faf8f5');
  });
});
