/**
 * macOS packaged auto-update surface for the renderer (via preload IPC).
 * Linux/Windows and dev builds use terminal `unsupported` / `development` states.
 */

export type AppUpdateState =
  | { status: 'unsupported' }
  | { status: 'development' }
  | { status: 'checking' }
  | { status: 'no_update'; currentVersion: string }
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
      releaseNotes?: string | null;
    }
  | {
      status: 'downloading';
      currentVersion: string;
      latestVersion: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond?: number;
    }
  | {
      status: 'downloaded';
      currentVersion: string;
      latestVersion: string;
    }
  | { status: 'error'; message: string; phase: 'check' | 'download' };
