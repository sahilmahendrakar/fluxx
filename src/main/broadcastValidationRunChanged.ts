import { BrowserWindow } from 'electron';

/** Notify all renderer windows that a validation run row changed. */
export function broadcastValidationRunChanged(runId: string): void {
  const id = runId.trim();
  if (!id) return;
  const payload = { runId: id };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('validationRuns:changed', payload);
  }
}
