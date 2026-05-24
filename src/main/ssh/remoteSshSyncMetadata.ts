import fs from 'node:fs/promises';
import path from 'node:path';
import type { RemoteSshSyncMetadata } from '../../types';
import { worktreePathSegmentsForFluxxBranch } from '../fluxxTaskWorkBranchNaming';

const FILE_NAME = 'remote-ssh-sync.json';

type RemoteSshSyncFileV1 = {
  version: 1;
  byTaskId: Record<string, RemoteSshSyncMetadata>;
};

function syncFilePath(projectDir: string): string {
  return path.join(projectDir, FILE_NAME);
}

export async function readRemoteSshSyncMetadata(
  projectDir: string,
  taskId: string,
): Promise<RemoteSshSyncMetadata | null> {
  const file = await readRemoteSshSyncFile(projectDir);
  return file.byTaskId[taskId.trim()] ?? null;
}

/** Resolves the local synced worktree path for an SSH task, if present on disk. */
export async function resolveSshLocalWorktreePath(input: {
  projectDir: string;
  taskId: string;
  repoId?: string | null;
  fluxxWorkBranch?: string | null;
}): Promise<string | null> {
  const projectDir = input.projectDir?.trim();
  const taskId = input.taskId?.trim();
  if (!projectDir || !taskId) return null;

  const meta = await readRemoteSshSyncMetadata(projectDir, taskId);
  const fromMeta = meta?.localWorktreePath?.trim();
  if (fromMeta && (await pathExistsAsDirectory(fromMeta))) {
    return path.resolve(fromMeta);
  }

  const repoId = input.repoId?.trim();
  const branch = input.fluxxWorkBranch?.trim();
  if (repoId && branch) {
    const inferred = path.join(
      projectDir,
      'worktrees',
      repoId,
      ...worktreePathSegmentsForFluxxBranch(branch),
    );
    if (await pathExistsAsDirectory(inferred)) {
      return inferred;
    }
  }
  return null;
}

async function pathExistsAsDirectory(absPath: string): Promise<boolean> {
  try {
    const st = await fs.stat(absPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function uniqueExistingPaths(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export async function listLocalSyncedWorktreeCandidatePaths(input: {
  projectDir: string;
  taskId: string;
  repoId?: string | null;
  fluxxWorkBranch?: string | null;
}): Promise<string[]> {
  const projectDir = input.projectDir?.trim();
  const taskId = input.taskId?.trim();
  if (!projectDir || !taskId) return [];

  const candidates: string[] = [];
  const meta = await readRemoteSshSyncMetadata(projectDir, taskId);
  if (meta?.localWorktreePath?.trim()) {
    candidates.push(meta.localWorktreePath.trim());
  }

  const repoId = input.repoId?.trim();
  const branch = input.fluxxWorkBranch?.trim();
  if (repoId && branch) {
    candidates.push(
      path.join(projectDir, 'worktrees', repoId, ...worktreePathSegmentsForFluxxBranch(branch)),
    );
  }

  const existing: string[] = [];
  for (const candidate of uniqueExistingPaths(candidates)) {
    if (await pathExistsAsDirectory(candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

export async function clearRemoteSshSyncMetadata(
  projectDir: string,
  taskId: string,
): Promise<void> {
  const tid = taskId.trim();
  if (!tid) return;
  const file = await readRemoteSshSyncFile(projectDir);
  if (!file.byTaskId[tid]) return;
  delete file.byTaskId[tid];
  await fs.writeFile(syncFilePath(projectDir), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/**
 * Removes local worktree(s) created by SSH "Sync to local" and clears sync metadata.
 * Safe to call when no local copy exists.
 */
export async function removeLocalSyncedWorktreeForTask(
  worktreeService: import('../WorktreeService').WorktreeService,
  repos: readonly import('../../types').RepoConfig[],
  input: {
    projectDir: string;
    taskId: string;
    repoId?: string | null;
    fluxxWorkBranch?: string | null;
  },
): Promise<string[]> {
  const errors: string[] = [];
  const paths = await listLocalSyncedWorktreeCandidatePaths(input);
  const repoId = input.repoId?.trim();
  const cfg = repoId ? repos.find((r) => r.id === repoId) : repos[0];
  const gitRoot = cfg?.rootPath?.trim() ? path.resolve(cfg.rootPath) : null;

  for (const worktreePath of paths) {
    try {
      await worktreeService.remove(worktreePath, gitRoot);
    } catch (err) {
      errors.push(
        `Local synced worktree cleanup (${worktreePath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  try {
    await clearRemoteSshSyncMetadata(input.projectDir, input.taskId);
  } catch (err) {
    errors.push(
      `Local sync metadata cleanup: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return errors;
}

export async function persistRemoteSshSyncMetadata(
  projectDir: string,
  taskId: string,
  metadata: RemoteSshSyncMetadata,
): Promise<void> {
  const tid = taskId.trim();
  if (!tid) return;
  const file = await readRemoteSshSyncFile(projectDir);
  file.byTaskId[tid] = metadata;
  await fs.writeFile(syncFilePath(projectDir), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

async function readRemoteSshSyncFile(projectDir: string): Promise<RemoteSshSyncFileV1> {
  const filePath = syncFilePath(projectDir);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RemoteSshSyncFileV1>;
    if (parsed.version === 1 && parsed.byTaskId && typeof parsed.byTaskId === 'object') {
      return { version: 1, byTaskId: parsed.byTaskId };
    }
  } catch {
    /* missing or invalid */
  }
  return { version: 1, byTaskId: {} };
}
