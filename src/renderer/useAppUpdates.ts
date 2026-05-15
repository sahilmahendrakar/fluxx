import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppUpdateState } from '../appUpdateState';

export interface UseAppUpdatesResult {
  /** Preload `updates` bridge present (Electron packaged renderer). */
  api: boolean;
  /** First `getState` resolved at least once. */
  ready: boolean;
  state: AppUpdateState;
  startDownload: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
}

export function useAppUpdates(): UseAppUpdatesResult {
  const api = typeof window !== 'undefined' && !!window.electronAPI?.updates;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppUpdateState>({ status: 'unsupported' });

  useEffect(() => {
    const u = window.electronAPI?.updates;
    if (!u) return;
    void u.getState().then((s) => {
      setState(s);
      setReady(true);
    });
    return u.onStateChanged((s) => {
      setState(s);
      setReady(true);
    });
  }, []);

  const startDownload = useCallback(async () => {
    await window.electronAPI?.updates?.startDownload();
  }, []);

  const quitAndInstall = useCallback(async () => {
    await window.electronAPI?.updates?.quitAndInstall();
  }, []);

  return useMemo(
    () => ({ api, ready, state, startDownload, quitAndInstall }),
    [api, ready, state, startDownload, quitAndInstall],
  );
}
