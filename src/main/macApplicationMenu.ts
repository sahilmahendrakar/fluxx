import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron';
import type { AppUpdateState } from '../appUpdateState';
import type { AppUpdaterHandle } from './AppUpdater';

const CHECK_FOR_UPDATES_ID = 'check-for-updates';

const CHECK_LABEL = 'Check for Updates…';
const CHECKING_LABEL = 'Checking for Updates…';

export function isCheckForUpdatesMenuEnabled(state: AppUpdateState): boolean {
  return (
    state.status !== 'checking' &&
    state.status !== 'downloading' &&
    state.status !== 'downloaded'
  );
}

export function checkForUpdatesMenuLabel(state: AppUpdateState): string {
  return state.status === 'checking' ? CHECKING_LABEL : CHECK_LABEL;
}

/** User-visible feedback after a manual menu check (sidebar hides check-phase errors). */
export async function showManualUpdateCheckFeedback(state: AppUpdateState): Promise<void> {
  const focused = BrowserWindow.getFocusedWindow();
  const parent = focused && !focused.isDestroyed() ? focused : undefined;

  if (state.status === 'no_update') {
    const detail = `Fluxx ${state.currentVersion} is up to date.`;
    const opts = {
      type: 'info' as const,
      buttons: ['OK'],
      defaultId: 0,
      title: 'No Updates Available',
      message: 'You have the latest version.',
      detail,
    };
    if (parent) {
      await dialog.showMessageBox(parent, opts);
    } else {
      await dialog.showMessageBox(opts);
    }
    return;
  }

  if (state.status === 'error' && state.phase === 'check') {
    const opts = {
      type: 'error' as const,
      buttons: ['OK'],
      defaultId: 0,
      title: 'Update Check Failed',
      message: 'Could not check for updates.',
      detail: state.message,
    };
    if (parent) {
      await dialog.showMessageBox(parent, opts);
    } else {
      await dialog.showMessageBox(opts);
    }
  }
}

function buildDarwinAppSubmenu(updater: AppUpdaterHandle): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
  ];

  if (updater.isEligible()) {
    submenu.push(
      { type: 'separator' },
      {
        id: CHECK_FOR_UPDATES_ID,
        label: checkForUpdatesMenuLabel(updater.getState()),
        enabled: isCheckForUpdatesMenuEnabled(updater.getState()),
        click: () => {
          void (async () => {
            await updater.triggerCheck();
            await showManualUpdateCheckFeedback(updater.getState());
          })();
        },
      },
    );
  }

  submenu.push({ type: 'separator' }, { role: 'quit' });
  return submenu;
}

/**
 * Replaces Electron's default menu on macOS with a template that includes
 * **Fluxx → Check for Updates…** when GitHub updates are eligible.
 */
export function installMacApplicationMenu(updater: AppUpdaterHandle): void {
  if (process.platform !== 'darwin') return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: buildDarwinAppSubmenu(updater),
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'helpMenu' },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  if (!updater.isEligible()) return;

  const checkItem = menu.getMenuItemById(CHECK_FOR_UPDATES_ID);
  if (!checkItem) return;

  updater.subscribe((state) => {
    checkItem.label = checkForUpdatesMenuLabel(state);
    checkItem.enabled = isCheckForUpdatesMenuEnabled(state);
  });
}
