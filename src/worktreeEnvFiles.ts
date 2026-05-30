import fs from 'node:fs/promises';
import path from 'node:path';
import {
  detectRepoRootEnvFiles,
  type DetectRepoRootEnvFilesOptions,
} from './repoEnvFiles';
import type { RepoEnvFileName } from './types';

/** One enabled root env file to copy into a new task worktree. */
export type WorktreeEnvFileCopySource = {
  fileName: RepoEnvFileName;
  /** Absolute path to the source file on the bound repo clone. */
  sourcePath: string;
};

const RESTRICTIVE_ENV_FILE_MODE = 0o600;

/**
 * Resolves enabled env file rows for worktree seeding (no file contents in the result).
 */
export async function resolveEnabledEnvFileCopySources(
  repoRoot: string,
  options: Pick<DetectRepoRootEnvFilesOptions, 'envFiles' | 'legacyPastedEnvActive'> = {},
): Promise<WorktreeEnvFileCopySource[]> {
  const detection = await detectRepoRootEnvFiles(repoRoot, options);
  return detection.files
    .filter((f) => f.enablement === 'enabled')
    .map((f) => ({ fileName: f.fileName, sourcePath: f.sourcePath }));
}

/**
 * Copies enabled env sources into `worktreePath` using the same filenames (never symlinks).
 * Missing sources are skipped with a clear warning; copy failures are warned, not thrown.
 */
export async function copyEnabledEnvFilesIntoWorktree(
  worktreePath: string,
  sources: readonly WorktreeEnvFileCopySource[],
  logPrefix = '[WorktreeService.create]',
): Promise<void> {
  for (const { fileName, sourcePath } of sources) {
    const destPath = path.join(worktreePath, fileName);
    try {
      await fs.access(sourcePath);
    } catch {
      console.warn(
        `${logPrefix} enabled env file missing at source; skipping copy to worktree: ${fileName} (${sourcePath})`,
      );
      continue;
    }
    try {
      await fs.copyFile(sourcePath, destPath);
      try {
        await fs.chmod(destPath, RESTRICTIVE_ENV_FILE_MODE);
      } catch {
        // chmod unsupported or restricted on some platforms; copy still succeeded.
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `${logPrefix} failed to copy env file ${fileName} to ${destPath}: ${message}`,
      );
    }
  }
}

/** Writes legacy pasted env contents to `<worktree>/.env` with restrictive permissions when supported. */
export async function writeLegacyPastedEnvToWorktree(
  worktreePath: string,
  envContents: string,
  logPrefix = '[WorktreeService.create]',
): Promise<void> {
  const destPath = path.join(worktreePath, '.env');
  try {
    await fs.writeFile(destPath, envContents, 'utf8');
    try {
      await fs.chmod(destPath, RESTRICTIVE_ENV_FILE_MODE);
    } catch {
      // best-effort
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} failed to write .env at ${worktreePath}: ${message}`);
  }
}
