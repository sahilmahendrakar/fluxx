import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createRemoteWorktreePrep } = require('../../../scripts/lib/remoteWorktreePrep.js');

function gitRun(args: string[], opts: { cwd?: string } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd: opts.cwd,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return { ok: true as const, stdout: (result.stdout || '').trim() };
}

async function initRepo(dir: string): Promise<void> {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  await fsp.writeFile(path.join(dir, 'README.md'), '# t\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

describe('remoteWorktreePrep', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('reclaims a task worktree directory on the wrong branch', async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'flux-remote-wt-'));
    const repoPath = path.join(root, 'repo');
    await fsp.mkdir(repoPath);
    await initRepo(repoPath);

    const worktreePath = path.join(root, 'worktrees', 'proj', 'repo', 'task-1');
    const oldBranch = 'fluxx-user/say-hi-test';
    const newBranch = 'fluxx-user/say-hi-test-2';

    execFileSync('git', ['branch', oldBranch, 'main'], { cwd: repoPath });
    await fsp.mkdir(path.dirname(worktreePath), { recursive: true });
    execFileSync('git', ['worktree', 'add', worktreePath, oldBranch], { cwd: repoPath });

    const prep = createRemoteWorktreePrep({ gitRun, fs, path });
    expect(prep.prepareWorktreePath(worktreePath, repoPath, oldBranch)).toBe('healthy');

    const reclaimed = prep.prepareWorktreePath(worktreePath, repoPath, newBranch);
    expect(reclaimed).toBe('absent');
    expect(fs.existsSync(worktreePath)).toBe(false);

    execFileSync('git', ['worktree', 'add', worktreePath, '-b', newBranch, 'main'], {
      cwd: repoPath,
    });
    const head = gitRun(['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath });
    expect(head.stdout).toBe(newBranch);
  });
});
