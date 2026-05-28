/** User-facing appearance preference (persisted in app state). */
export type AppearancePreference = 'light' | 'dark' | 'system';

/** Resolved paint theme applied to the renderer and native chrome. */
export type ResolvedAppearance = 'light' | 'dark';

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'dark';

export interface AppearanceBootstrap {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return DEFAULT_APPEARANCE_PREFERENCE;
}

export function resolveAppearanceWithSystemDark(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

export function resolveAppearance(preference: AppearancePreference): ResolvedAppearance {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return resolveAppearanceWithSystemDark(
      preference,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
  }
  return 'dark';
}

/** Window `backgroundColor` for Electron (no alpha). */
export function windowBackgroundForAppearance(resolved: ResolvedAppearance): string {
  return resolved === 'light' ? '#faf8f5' : '#09090b';
}

const APPEARANCE_CLASS = new Set<ResolvedAppearance>(['light', 'dark']);

export function applyResolvedAppearanceToDocument(resolved: ResolvedAppearance): void {
  const root = document.documentElement;
  for (const cls of APPEARANCE_CLASS) {
    root.classList.toggle(cls, cls === resolved);
  }
  root.style.colorScheme = resolved;
}

export function readAppearanceBootstrapFromWindow(): AppearanceBootstrap | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as Window & { __FLUXX_APPEARANCE_BOOTSTRAP__?: AppearanceBootstrap })
    .__FLUXX_APPEARANCE_BOOTSTRAP__;
  if (!raw || typeof raw !== 'object') return null;
  const preference = normalizeAppearancePreference(
    (raw as AppearanceBootstrap).preference,
  );
  const resolvedRaw = (raw as AppearanceBootstrap).resolved;
  const resolved: ResolvedAppearance =
    resolvedRaw === 'light' || resolvedRaw === 'dark'
      ? resolvedRaw
      : resolveAppearance(preference);
  return { preference, resolved };
}
