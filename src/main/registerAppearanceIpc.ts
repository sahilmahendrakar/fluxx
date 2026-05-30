import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import type { AppStateStore } from './AppStateStore';
import { syncAppearanceChrome } from './appearanceChrome';
import {
  type AppearanceBootstrap,
  type AppearancePreference,
  DEFAULT_APPEARANCE_PREFERENCE,
  normalizeAppearancePreference,
  type ResolvedAppearance,
  resolveAppearanceWithSystemDark,
} from '../theme/appearance';

export type AppearanceSideEffects = {
  onResolvedChange?: (resolved: ResolvedAppearance) => void;
};

function bootstrapFromStore(appStateStore: AppStateStore): AppearanceBootstrap {
  const preference =
    appStateStore.get().appearance ?? DEFAULT_APPEARANCE_PREFERENCE;
  return {
    preference,
    resolved: resolveAppearanceWithSystemDark(
      preference,
      nativeTheme.shouldUseDarkColors,
    ),
  };
}

export function registerAppearanceIpc(
  appStateStore: AppStateStore,
  getMainWindow: () => BrowserWindow | null,
  sideEffects: AppearanceSideEffects = {},
): void {
  ipcMain.on('appearance:getBootstrap', (event) => {
    event.returnValue = bootstrapFromStore(appStateStore);
  });

  ipcMain.handle('appearance:getPreference', () => {
    return appStateStore.get().appearance ?? DEFAULT_APPEARANCE_PREFERENCE;
  });

  ipcMain.handle(
    'appearance:setPreference',
    async (_event, raw: unknown): Promise<{ ok: true; preference: AppearancePreference }> => {
      const preference = normalizeAppearancePreference(raw);
      await appStateStore.set({ appearance: preference });
      const resolved = resolveAppearanceWithSystemDark(
        preference,
        nativeTheme.shouldUseDarkColors,
      );
      syncAppearanceChrome(preference, getMainWindow());
      sideEffects.onResolvedChange?.(resolved);
      return { ok: true, preference };
    },
  );
}

export function applyInitialAppearanceChrome(
  appStateStore: AppStateStore,
  browserWindow: BrowserWindow,
): void {
  const preference = appStateStore.get().appearance ?? DEFAULT_APPEARANCE_PREFERENCE;
  syncAppearanceChrome(preference, browserWindow);
}
