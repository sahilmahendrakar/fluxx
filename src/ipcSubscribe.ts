import type { IpcRenderer } from 'electron';

/**
 * Subscribe with an unsubscribe that removes only this listener.
 * Multiple renderer views often share one IPC channel (e.g. session PTY mirrors);
 * never use removeAllListeners for per-view subscriptions.
 */
export function ipcSubscribe(
  ipc: Pick<IpcRenderer, 'on' | 'removeListener'>,
  channel: string,
  listener: Parameters<IpcRenderer['on']>[1],
): () => void {
  ipc.on(channel, listener);
  return () => ipc.removeListener(channel, listener);
}
