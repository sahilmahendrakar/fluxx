import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { AppUpdateState } from '../appUpdateState';

const GH_UPDATES_OWNER = 'sahilmahendrakar';
const GH_UPDATES_REPO = 'fluxx-web';

/** Background metadata checks (no download) — 4 hours */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const STATE_CHANNEL = 'app:updates:stateChanged' as const;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function macGithubUpdatesEligible(): boolean {
  return (
    process.platform === 'darwin' &&
    app.isPackaged &&
    process.env.FLUX_DISABLE_GITHUB_UPDATES !== '1'
  );
}

function createInitialUpdateState(): AppUpdateState {
  if (process.platform !== 'darwin') {
    return { status: 'unsupported' };
  }
  if (!app.isPackaged) {
    return { status: 'development' };
  }
  if (process.env.FLUX_DISABLE_GITHUB_UPDATES === '1') {
    return { status: 'unsupported' };
  }
  return { status: 'checking' };
}

function releaseNotesFromUpdateInfo(info: {
  releaseNotes?: string | string[] | null | unknown;
}): string | null | undefined {
  const n = info.releaseNotes;
  if (n == null) return undefined;
  if (typeof n === 'string') return n || undefined;
  if (Array.isArray(n)) {
    const text = n.map((x) => (typeof x === 'string' ? x : '')).join('\n');
    return text || undefined;
  }
  return undefined;
}

/**
 * Registers IPC and starts periodic checks on eligible macOS builds.
 * Safe on all platforms; ineligible builds stay in static unsupported/development states.
 */
export function registerAppUpdater(): void {
  let state: AppUpdateState = createInitialUpdateState();

  let feedConfigured = false;
  let listenersAttached = false;
  let checkInFlight = false;
  /** Latest version from the last `update-available` (or check result); drives download-progress labeling. */
  let advertisedLatestVersion: string | null = null;
  /** User-initiated download once per `available` cycle; reset when a new update is advertised or download errors. */
  let userDownloadCommitted = false;

  let intervalId: ReturnType<typeof setInterval> | undefined;

  function broadcast(): void {
    const payload = state;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(STATE_CHANNEL, payload);
      }
    }
  }

  function setState(next: AppUpdateState): void {
    state = next;
    broadcast();
  }

  function configureFeed(): void {
    if (feedConfigured || !macGithubUpdatesEligible()) return;
    feedConfigured = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GH_UPDATES_OWNER,
      repo: GH_UPDATES_REPO,
    });
  }

  function attachListeners(): void {
    if (listenersAttached || !macGithubUpdatesEligible()) return;
    listenersAttached = true;

    autoUpdater.on('update-available', (info) => {
      if (!macGithubUpdatesEligible()) return;
      userDownloadCommitted = false;
      const currentVersion = autoUpdater.currentVersion.version;
      const latestVersion = info?.version ?? currentVersion;
      advertisedLatestVersion = latestVersion;
      setState({
        status: 'available',
        currentVersion,
        latestVersion,
        releaseNotes: releaseNotesFromUpdateInfo(info ?? {}),
      });
    });

    autoUpdater.on('update-not-available', () => {
      if (!macGithubUpdatesEligible()) return;
      userDownloadCommitted = false;
      advertisedLatestVersion = null;
      setState({
        status: 'no_update',
        currentVersion: autoUpdater.currentVersion.version,
      });
    });

    autoUpdater.on('download-progress', (p) => {
      if (!macGithubUpdatesEligible()) return;
      const currentVersion = autoUpdater.currentVersion.version;
      const latestVersion = advertisedLatestVersion ?? currentVersion;
      setState({
        status: 'downloading',
        currentVersion,
        latestVersion,
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (!macGithubUpdatesEligible()) return;
      const currentVersion = autoUpdater.currentVersion.version;
      const latestVersion = info?.version ?? advertisedLatestVersion ?? currentVersion;
      advertisedLatestVersion = latestVersion;
      setState({
        status: 'downloaded',
        currentVersion,
        latestVersion,
      });
    });

    autoUpdater.on('error', (err) => {
      if (!macGithubUpdatesEligible()) return;
      if (state.status === 'checking') {
        setState({
          status: 'error',
          message: errMessage(err),
          phase: 'check',
        });
        return;
      }
      if (state.status === 'downloading') {
        userDownloadCommitted = false;
        setState({
          status: 'error',
          message: errMessage(err),
          phase: 'download',
        });
      }
    });
  }

  async function runCheck(): Promise<void> {
    if (!macGithubUpdatesEligible()) return;
    if (checkInFlight) return;
    if (state.status === 'downloading' || state.status === 'downloaded') return;

    checkInFlight = true;
    setState({ status: 'checking' });
    try {
      configureFeed();
      attachListeners();
      const result = await autoUpdater.checkForUpdates();
      if (!macGithubUpdatesEligible()) return;

      if (state.status === 'checking') {
        const cur = autoUpdater.currentVersion.version;
        if (result == null || !result.isUpdateAvailable) {
          userDownloadCommitted = false;
          advertisedLatestVersion = null;
          setState({ status: 'no_update', currentVersion: cur });
        } else {
          userDownloadCommitted = false;
          const info = result.updateInfo;
          const latestVersion = info.version ?? cur;
          advertisedLatestVersion = latestVersion;
          setState({
            status: 'available',
            currentVersion: cur,
            latestVersion,
            releaseNotes: releaseNotesFromUpdateInfo(info),
          });
        }
      }
    } catch (err: unknown) {
      if (macGithubUpdatesEligible()) {
        setState({
          status: 'error',
          message: errMessage(err),
          phase: 'check',
        });
      }
    } finally {
      checkInFlight = false;
    }
  }

  function startInterval(): void {
    if (!macGithubUpdatesEligible() || intervalId !== undefined) return;
    intervalId = setInterval(() => {
      void runCheck();
    }, CHECK_INTERVAL_MS);
    if (typeof intervalId.unref === 'function') {
      intervalId.unref();
    }
  }

  ipcMain.handle('app:updates:getState', (): AppUpdateState => state);

  ipcMain.handle('app:updates:check', async (): Promise<void> => {
    if (!macGithubUpdatesEligible()) return;
    await runCheck();
  });

  ipcMain.handle(
    'app:updates:startDownload',
    async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (!macGithubUpdatesEligible()) {
        return { ok: false, reason: 'NOT_SUPPORTED' };
      }
      const canRetryAfterDownloadError =
        state.status === 'error' &&
        state.phase === 'download' &&
        advertisedLatestVersion != null;
      if (state.status !== 'available' && !canRetryAfterDownloadError) {
        return { ok: false, reason: 'NO_UPDATE_AVAILABLE' };
      }
      if (userDownloadCommitted && state.status !== 'error') {
        return { ok: false, reason: 'DOWNLOAD_ALREADY_STARTED' };
      }
      userDownloadCommitted = true;
      try {
        configureFeed();
        attachListeners();
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (err: unknown) {
        userDownloadCommitted = false;
        setState({
          status: 'error',
          message: errMessage(err),
          phase: 'download',
        });
        return { ok: false, reason: errMessage(err) };
      }
    },
  );

  ipcMain.handle('app:updates:quitAndInstall', async (): Promise<void> => {
    if (!macGithubUpdatesEligible()) return;
    if (state.status !== 'downloaded') return;
    configureFeed();
    attachListeners();
    await Promise.resolve();
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err: unknown) {
      setState({
        status: 'error',
        message: errMessage(err),
        phase: 'download',
      });
    }
  });

  if (macGithubUpdatesEligible()) {
    configureFeed();
    attachListeners();
    void runCheck().finally(() => {
      startInterval();
    });
  }
}
