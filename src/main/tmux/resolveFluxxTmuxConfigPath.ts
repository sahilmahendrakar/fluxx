import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves bundled `fluxx-tmux.conf` for dev and packaged macOS layouts.
 * Tests may override via {@link setFluxxTmuxConfigPathOverride}.
 */
export function resolveFluxxTmuxConfigPath(appPath?: string, exePath?: string): string {
  const candidates: string[] = [];
  if (exePath) {
    candidates.push(
      path.join(path.dirname(exePath), '..', 'Resources', 'fluxx-cli', 'fluxx-tmux.conf'),
    );
  }
  if (appPath) {
    candidates.push(path.join(path.dirname(appPath), 'fluxx-cli', 'fluxx-tmux.conf'));
    candidates.push(path.join(appPath, '..', 'fluxx-cli', 'fluxx-tmux.conf'));
  }
  candidates.push(path.resolve(process.cwd(), 'resources', 'fluxx-tmux.conf'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

let configPathOverride: string | undefined;

/** Test hook: force the config path used by {@link getFluxxTmuxConfigPath}. */
export function setFluxxTmuxConfigPathOverride(pathOverride: string | undefined): void {
  configPathOverride = pathOverride;
}

export function getFluxxTmuxConfigPath(appPath?: string, exePath?: string): string {
  return configPathOverride ?? resolveFluxxTmuxConfigPath(appPath, exePath);
}
