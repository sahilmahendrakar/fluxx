import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { FLUXX_DEEP_LINK_SCHEME } from './fluxxAppUrl';

let pendingDeepLinkUrl: string | null = null;

function isFluxxDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${FLUXX_DEEP_LINK_SCHEME}:`;
  } catch {
    return false;
  }
}

export function extractFluxxDeepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => isFluxxDeepLink(arg));
}

/** Registers this process as the OS handler for `fluxx://` links. */
export function registerFluxxProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(
        FLUXX_DEEP_LINK_SCHEME,
        process.execPath,
        [path.resolve(process.argv[1])],
      );
    }
    return;
  }
  app.setAsDefaultProtocolClient(FLUXX_DEEP_LINK_SCHEME);
}

function focusMainWindow(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function handleFluxxDeepLink(
  url: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  if (!isFluxxDeepLink(url)) return;
  focusMainWindow(getMainWindow);
}

function flushPendingDeepLink(getMainWindow: () => BrowserWindow | null): void {
  if (!pendingDeepLinkUrl) return;
  const url = pendingDeepLinkUrl;
  pendingDeepLinkUrl = null;
  handleFluxxDeepLink(url, getMainWindow);
}

/**
 * Routes `fluxx://` links to the main window. Pair with `app.requestSingleInstanceLock()`
 * on Windows/Linux so a second instance forwards the URL instead of starting twice.
 */
export function installFluxxDeepLinkEventHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (!isFluxxDeepLink(url)) return;
    if (app.isReady()) {
      handleFluxxDeepLink(url, getMainWindow);
    } else {
      pendingDeepLinkUrl = url;
    }
  });

  app.on('second-instance', (_event, commandLine) => {
    const url = extractFluxxDeepLinkFromArgv(commandLine);
    if (url) {
      handleFluxxDeepLink(url, getMainWindow);
      return;
    }
    focusMainWindow(getMainWindow);
  });

  app.on('ready', () => {
    const startupUrl = extractFluxxDeepLinkFromArgv(process.argv);
    if (startupUrl) {
      handleFluxxDeepLink(startupUrl, getMainWindow);
    }
    flushPendingDeepLink(getMainWindow);
  });
}
