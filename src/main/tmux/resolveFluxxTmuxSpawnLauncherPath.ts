import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves `fluxx-tmux-spawn.sh` (Run-as-Node wrapper) for dev and packaged macOS layouts.
 * Callers may inject a path in tests via {@link TerminalRuntimeManagerOptions}.
 */
export function resolveFluxxTmuxSpawnLauncherPath(appPath?: string, exePath?: string): string {
  const candidates: string[] = [];
  if (exePath) {
    candidates.push(
      path.join(path.dirname(exePath), '..', 'Resources', 'fluxx-cli', 'fluxx-tmux-spawn.sh'),
    );
  }
  if (appPath) {
    candidates.push(path.join(path.dirname(appPath), 'fluxx-cli', 'fluxx-tmux-spawn.sh'));
    candidates.push(path.join(appPath, '..', 'fluxx-cli', 'fluxx-tmux-spawn.sh'));
  }
  candidates.push(path.resolve(process.cwd(), 'scripts', 'fluxx-tmux-spawn.sh'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}
