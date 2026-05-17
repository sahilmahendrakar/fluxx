import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FLUXX_HOME_DIRNAME = '.fluxx';
export const LEGACY_FLUX_HOME_DIRNAME = '.flux';

/** Written into `~/.fluxx` after a successful rename or copy from `~/.flux`. */
export const FLUXX_HOME_MIGRATION_SENTINEL = '.fluxx-migrated-from-flux';

export function fluxxBaseDirPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, FLUXX_HOME_DIRNAME);
}

export function legacyFluxBaseDirPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, LEGACY_FLUX_HOME_DIRNAME);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

/**
 * Ensures the Flux home directory exists at `~/.fluxx`. On first launch when only
 * `~/.flux` exists, renames it atomically (or copies + sentinel on cross-device failure).
 */
export async function ensureFluxxBaseDirMigrated(homeDir: string = os.homedir()): Promise<string> {
  const fluxxDir = fluxxBaseDirPath(homeDir);
  const legacyDir = legacyFluxBaseDirPath(homeDir);

  if (await pathExists(fluxxDir)) {
    return fluxxDir;
  }

  if (!(await pathExists(legacyDir))) {
    await fs.mkdir(fluxxDir, { recursive: true });
    return fluxxDir;
  }

  try {
    await fs.rename(legacyDir, fluxxDir);
    await fs.writeFile(
      path.join(fluxxDir, FLUXX_HOME_MIGRATION_SENTINEL),
      `renamed:${legacyDir}\n${new Date().toISOString()}\n`,
      'utf8',
    );
    return fluxxDir;
  } catch (err: unknown) {
    const code = errnoCode(err);
    if (code !== 'EXDEV' && code !== 'ENOTEMPTY' && code !== 'EPERM' && code !== 'EACCES') {
      throw err;
    }
  }

  await fs.cp(legacyDir, fluxxDir, { recursive: true });
  await fs.writeFile(
    path.join(fluxxDir, FLUXX_HOME_MIGRATION_SENTINEL),
    `copied-from:${legacyDir}\n${new Date().toISOString()}\n`,
    'utf8',
  );
  return fluxxDir;
}
