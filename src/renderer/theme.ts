/**
 * App-wide appearance (localStorage). Applies to the renderer document via `data-theme`
 * on `<html>`; components should use `flux-*` Tailwind tokens or CSS variables — not this module
 * for styling, except when changing the mode.
 */

export type ThemeMode = 'dark' | 'light';

export const FLUX_THEME_STORAGE_KEY = 'flux.theme';

export function normalizeThemeMode(raw: string | null | undefined): ThemeMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'light' ? 'light' : 'dark';
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

/** Read persisted theme without throwing (SSR-safe pattern for tests). */
export function readStoredTheme(): ThemeMode {
  try {
    if (typeof localStorage === 'undefined') return 'dark';
    return normalizeThemeMode(localStorage.getItem(FLUX_THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function writeStoredTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(FLUX_THEME_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

/** Sync `<html data-theme>` with the given mode (idempotent). */
export function applyThemeToDocument(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
}
