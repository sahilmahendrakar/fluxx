import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveLocalOrOriginRefWithAmbiguity } from './repoGit';

const execFile = promisify(execFileCallback);

async function initGitRepo(cwd: string): Promise<void> {
  await fs.mkdir(cwd, { recursive: true });
  await execFile('git', ['init'], { cwd });
  await execFile('git', ['config', 'user.email', 'flux@test'], { cwd });
  await execFile('git', ['config', 'user.name', 'flux'], { cwd });
  await fs.writeFile(path.join(cwd, 'f.txt'), 'a\n', 'utf8');
  await execFile('git', ['add', 'f.txt'], { cwd });
  await execFile('git', ['commit', '-m', 'first'], { cwd });
}

describe('resolveLocalOrOriginRefWithAmbiguity', () => {
  it('returns ok for local branch only', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-git-'));
    try {
      await initGitRepo(cwd);
      await execFile('git', ['branch', 'feature'], { cwd });
      const r = await resolveLocalOrOriginRefWithAmbiguity(cwd, 'feature');
      expect(r).toEqual({ kind: 'ok', ref: 'feature' });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns ok for remote-only ref', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-git-'));
    try {
      await initGitRepo(cwd);
      const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
      const sha = stdout.trim();
      await execFile('git', ['update-ref', `refs/remotes/origin/remote-only`, sha], { cwd });
      const r = await resolveLocalOrOriginRefWithAmbiguity(cwd, 'remote-only');
      expect(r).toEqual({ kind: 'ok', ref: 'origin/remote-only' });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns ambiguous when local and origin differ', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-git-'));
    try {
      await initGitRepo(cwd);
      const { stdout: baseOut } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
      });
      const baseSha = baseOut.trim();
      await execFile('git', ['checkout', '-b', 'diverge'], { cwd });
      await fs.appendFile(path.join(cwd, 'f.txt'), 'b\n', 'utf8');
      await execFile('git', ['commit', '-am', 'second'], { cwd });
      const { stdout: localOut } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
      });
      const localSha = localOut.trim();
      await execFile('git', ['checkout', 'main'], { cwd });
      await execFile('git', ['branch', '-D', 'diverge'], { cwd });
      await execFile('git', ['update-ref', `refs/remotes/origin/diverge`, baseSha], { cwd });
      await execFile('git', ['branch', 'diverge', localSha], { cwd });
      const r = await resolveLocalOrOriginRefWithAmbiguity(cwd, 'diverge');
      expect(r.kind).toBe('ambiguous');
      if (r.kind === 'ambiguous') {
        expect(r.localSha).toBe(localSha);
        expect(r.remoteSha).toBe(baseSha);
      }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns ok when local and origin match', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-git-'));
    try {
      await initGitRepo(cwd);
      const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
      const sha = stdout.trim();
      await execFile('git', ['branch', 'aligned', sha], { cwd });
      await execFile('git', ['update-ref', `refs/remotes/origin/aligned`, sha], { cwd });
      const r = await resolveLocalOrOriginRefWithAmbiguity(cwd, 'aligned');
      expect(r).toEqual({ kind: 'ok', ref: 'aligned' });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns missing when branch does not exist', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-git-'));
    try {
      await initGitRepo(cwd);
      const r = await resolveLocalOrOriginRefWithAmbiguity(cwd, 'nope');
      expect(r).toEqual({ kind: 'missing' });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
