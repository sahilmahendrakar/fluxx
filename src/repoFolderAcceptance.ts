import fs from 'node:fs/promises';
import path from 'node:path';

export type RepoFolderBindingError = 'MISSING' | 'NOT_GIT_REPO' | 'NOT_WRITABLE';

export async function repoFolderExists(resolvedRoot: string): Promise<boolean> {
  try {
    await fs.access(resolvedRoot);
    return true;
  } catch {
    return false;
  }
}

export async function repoFolderIsWritable(resolvedRoot: string): Promise<boolean> {
  try {
    await fs.access(resolvedRoot, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function repoFolderIsGitRepository(resolvedRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(path.resolve(resolvedRoot), '.git'));
    return true;
  } catch {
    return false;
  }
}

/** Validates a folder picked or bound as a project repository root. */
export async function validateRepoFolderForBinding(
  rootPath: string,
  gitIntegrationEnabled: boolean,
): Promise<{ ok: true; resolved: string } | { ok: false; error: RepoFolderBindingError }> {
  const resolved = path.resolve(rootPath);
  if (!(await repoFolderExists(resolved))) {
    return { ok: false, error: 'MISSING' };
  }
  if (!gitIntegrationEnabled) {
    if (!(await repoFolderIsWritable(resolved))) {
      return { ok: false, error: 'NOT_WRITABLE' };
    }
    return { ok: true, resolved };
  }
  try {
    await fs.access(path.join(resolved, '.git'));
    return { ok: true, resolved };
  } catch {
    return { ok: false, error: 'NOT_GIT_REPO' };
  }
}
