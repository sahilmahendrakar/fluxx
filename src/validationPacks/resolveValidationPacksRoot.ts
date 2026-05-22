import fs from 'node:fs';
import path from 'node:path';

let rootOverride: string | undefined;

/** Test hook: force validation-packs root resolution. */
export function setValidationPacksRootOverride(dir: string | undefined): void {
  rootOverride = dir;
}

/**
 * Resolves the repo `validation-packs/` directory for dev and packaged layouts.
 * Packaged builds copy the tree next to `fluxx-tmux.conf` under `fluxx-cli/validation-packs/`.
 */
export function resolveValidationPacksRoot(appPath?: string, exePath?: string): string {
  if (rootOverride) return rootOverride;
  const candidates: string[] = [];
  if (exePath) {
    candidates.push(
      path.join(path.dirname(exePath), '..', 'Resources', 'fluxx-cli', 'validation-packs'),
    );
  }
  if (appPath) {
    candidates.push(path.join(path.dirname(appPath), 'fluxx-cli', 'validation-packs'));
    candidates.push(path.join(appPath, '..', 'fluxx-cli', 'validation-packs'));
  }
  candidates.push(path.resolve(process.cwd(), 'validation-packs'));
  candidates.push(path.resolve(process.cwd(), 'resources', 'validation-packs'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}
