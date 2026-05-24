import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoConfig } from '../../types';
import {
  clearRemoteSshSyncMetadata,
  persistRemoteSshSyncMetadata,
  readRemoteSshSyncMetadata,
  removeLocalSyncedWorktreeForTask,
} from './remoteSshSyncMetadata';

describe('remoteSshSyncMetadata cleanup', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function makeProjectDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-ssh-sync-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('removeLocalSyncedWorktreeForTask removes metadata path and clears sync file', async () => {
    const projectDir = await makeProjectDir();
    const taskId = 'task-abc';
    const localPath = path.join(projectDir, 'worktrees', 'repo-1', 'jane', 'feature');
    await fs.mkdir(localPath, { recursive: true });
    await persistRemoteSshSyncMetadata(projectDir, taskId, {
      lastSyncedAt: new Date().toISOString(),
      lastSyncedCommit: 'deadbeef',
      deviceId: 'ssh-dev',
      remoteBranch: 'jane/feature',
      remoteHasUnsyncedChanges: false,
      localWorktreePath: localPath,
    });

    const removed: string[] = [];
    const worktreeService = {
      remove: vi.fn(async (wtPath: string) => {
        removed.push(wtPath);
        await fs.rm(wtPath, { recursive: true, force: true });
      }),
    };
    const repos: RepoConfig[] = [
      { id: 'repo-1', rootPath: '/tmp/git-root', baseBranch: 'main' },
    ];

    const errors = await removeLocalSyncedWorktreeForTask(worktreeService as never, repos, {
      projectDir,
      taskId,
      repoId: 'repo-1',
      fluxxWorkBranch: 'jane/feature',
    });

    expect(errors).toEqual([]);
    expect(removed).toContain(path.resolve(localPath));
    await expect(fs.stat(localPath)).rejects.toThrow();
    expect(await readRemoteSshSyncMetadata(projectDir, taskId)).toBeNull();
  });

  it('clearRemoteSshSyncMetadata is a no-op when task has no row', async () => {
    const projectDir = await makeProjectDir();
    await clearRemoteSshSyncMetadata(projectDir, 'missing-task');
    await expect(fs.access(path.join(projectDir, 'remote-ssh-sync.json'))).rejects.toThrow();
  });
});
