import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const PLANNING_DOCS_CHANGED_CHANNEL = 'planningDocs:changed';

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 2500;

function broadcastPlanningDocsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(PLANNING_DOCS_CHANGED_CHANNEL);
    }
  }
}

/**
 * Watches the active Flux `planning/` directory and notifies all renderer windows
 * when markdown or other files change. Uses debounced emits and a light poll
 * so project-dir switches are picked up without wiring every activation path.
 */
export function createPlanningDocsWatcher(
  getPlanningDir: () => string | null,
): { sync: () => void; dispose: () => void } {
  let watcher: fs.FSWatcher | null = null;
  let watchingPath: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function scheduleNotify(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastPlanningDocsChanged();
    }, DEBOUNCE_MS);
  }

  function stopWatcher(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watchingPath = null;
  }

  function attachWatcher(resolvedDir: string): void {
    stopWatcher();
    const onFsEvent = (): void => {
      scheduleNotify();
    };
    try {
      watcher = fs.watch(resolvedDir, { recursive: true }, onFsEvent);
      watchingPath = resolvedDir;
    } catch {
      try {
        watcher = fs.watch(resolvedDir, onFsEvent);
        watchingPath = resolvedDir;
      } catch {
        watchingPath = null;
      }
    }
  }

  function sync(): void {
    const dir = getPlanningDir();
    if (!dir) {
      stopWatcher();
      return;
    }
    const resolved = path.resolve(dir);
    if (watchingPath === resolved && watcher) {
      return;
    }
    void fsp
      .mkdir(resolved, { recursive: true })
      .then(() => {
        const current = getPlanningDir();
        if (!current || path.resolve(current) !== resolved) return;
        attachWatcher(resolved);
      })
      .catch(() => {
        stopWatcher();
      });
  }

  pollTimer = setInterval(() => {
    sync();
  }, POLL_INTERVAL_MS);

  return {
    sync,
    dispose: () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      stopWatcher();
    },
  };
}
