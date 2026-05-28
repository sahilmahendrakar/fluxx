import { ipcMain, type BrowserWindow } from 'electron';

export const WINDOW_FULLSCREEN_CHANGED_CHANNEL = 'window:fullscreenChanged';

export function registerWindowChromeIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('window:isFullscreen', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    return win.isFullScreen();
  });
}

export function attachWindowFullscreenListeners(win: BrowserWindow): void {
  const notify = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, win.isFullScreen());
  };
  win.on('enter-full-screen', notify);
  win.on('leave-full-screen', notify);
}
