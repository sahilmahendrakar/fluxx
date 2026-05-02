import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLUX_THEME_STORAGE_KEY,
  applyThemeToDocument,
  normalizeThemeMode,
  readStoredTheme,
  writeStoredTheme,
} from './theme';

describe('normalizeThemeMode', () => {
  it('defaults unknown values to dark', () => {
    expect(normalizeThemeMode(null)).toBe('dark');
    expect(normalizeThemeMode('')).toBe('dark');
    expect(normalizeThemeMode('system')).toBe('dark');
  });

  it('accepts light with trimming and case', () => {
    expect(normalizeThemeMode(' LIGHT ')).toBe('light');
  });
});

describe('readStoredTheme / writeStoredTheme', () => {
  const store: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('returns dark when unset', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    } as Storage);
    expect(readStoredTheme()).toBe('dark');
  });

  it('round-trips light', () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    } as Storage);
    writeStoredTheme('light');
    expect(store[FLUX_THEME_STORAGE_KEY]).toBe('light');
    expect(readStoredTheme()).toBe('light');
  });
});

describe('applyThemeToDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets data-theme on documentElement', () => {
    const dataset: { theme?: string } = {};
    vi.stubGlobal('document', {
      documentElement: { dataset },
    } as unknown as Document);

    applyThemeToDocument('light');
    expect(dataset.theme).toBe('light');
    applyThemeToDocument('dark');
    expect(dataset.theme).toBe('dark');
  });
});
