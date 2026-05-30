import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  copyEnabledEnvFilesIntoWorktree,
  resolveEnabledEnvFileCopySources,
  writeLegacyPastedEnvToWorktree,
} from './worktreeEnvFiles';

describe('resolveEnabledEnvFileCopySources', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('returns enabled files with absolute source paths', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-env-resolve-'));
    await fs.writeFile(path.join(tmp, '.env'), 'A=1\n', 'utf8');
    await fs.writeFile(path.join(tmp, '.env.local'), 'B=2\n', 'utf8');

    const sources = await resolveEnabledEnvFileCopySources(tmp, {
      envFiles: {
        sources: [
          { fileName: '.env', enablement: 'enabled' },
          { fileName: '.env.local', enablement: 'enabled' },
        ],
      },
    });

    expect(sources).toEqual([
      { fileName: '.env', sourcePath: path.join(tmp, '.env') },
      { fileName: '.env.local', sourcePath: path.join(tmp, '.env.local') },
    ]);
  });
});

describe('copyEnabledEnvFilesIntoWorktree', () => {
  let tmp = '';

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('copies files with restrictive permissions and warns when source is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-env-copy-'));
    const repoRoot = path.join(tmp, 'repo');
    const worktree = path.join(tmp, 'worktree');
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.mkdir(worktree, { recursive: true });
    await fs.writeFile(path.join(repoRoot, '.env'), 'SECRET=1\n', 'utf8');

    await copyEnabledEnvFilesIntoWorktree(worktree, [
      { fileName: '.env', sourcePath: path.join(repoRoot, '.env') },
      { fileName: '.env.local', sourcePath: path.join(repoRoot, '.env.local') },
    ]);

    await expect(fs.readFile(path.join(worktree, '.env'), 'utf8')).resolves.toBe('SECRET=1\n');
    await expect(fs.stat(path.join(worktree, '.env'))).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    const mode = (await fs.stat(path.join(worktree, '.env'))).mode & 0o777;
    expect(mode).toBe(0o600);

    await expect(fs.access(path.join(worktree, '.env.local'))).rejects.toThrow();
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('enabled env file missing at source'),
      ),
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('.env.local')),
    ).toBe(true);
  });
});

describe('writeLegacyPastedEnvToWorktree', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('writes pasted contents to .env', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-env-legacy-'));
    const worktree = path.join(tmp, 'worktree');
    await fs.mkdir(worktree, { recursive: true });

    await writeLegacyPastedEnvToWorktree(worktree, 'LEGACY=1\n');
    await expect(fs.readFile(path.join(worktree, '.env'), 'utf8')).resolves.toBe('LEGACY=1\n');
  });
});
