import { nativeTheme, type BrowserWindow } from 'electron';
import {
  type AppearancePreference,
  resolveAppearanceWithSystemDark,
  windowBackgroundForAppearance,
} from '../theme/appearance';

/** Sync Electron native theme + window background with the user's appearance preference. */
export function syncAppearanceChrome(
  preference: AppearancePreference,
  browserWindow?: BrowserWindow | null,
): void {
  const resolved = resolveAppearanceWithSystemDark(
    preference,
    nativeTheme.shouldUseDarkColors,
  );
  if (process.platform === 'darwin' || process.platform === 'win32') {
    nativeTheme.themeSource = preference === 'system' ? 'system' : resolved;
  }
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.setBackgroundColor(windowBackgroundForAppearance(resolved));
  }
}
