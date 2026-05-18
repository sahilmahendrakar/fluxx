import { BrowserWindow, ipcMain } from 'electron';

const GET_FULLSCREEN_CHANNEL = 'window:getFullscreen' as const;
export const WINDOW_FULLSCREEN_CHANGED_CHANNEL = 'window:fullscreenChanged' as const;

function sendFullscreenState(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, win.isFullScreen());
}

export function registerWindowChromeIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(GET_FULLSCREEN_CHANNEL, (): boolean => {
    if (process.platform !== 'darwin') return false;
    const win = getWindow();
    return win?.isFullScreen() ?? false;
  });
}

export function attachWindowChromeListeners(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;

  const notify = (): void => sendFullscreenState(win);

  win.on('enter-full-screen', notify);
  win.on('leave-full-screen', notify);
  win.webContents.on('did-finish-load', notify);
}
