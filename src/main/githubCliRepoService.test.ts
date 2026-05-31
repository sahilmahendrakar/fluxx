import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GH_REPO_LIST_JSON_FIELDS,
  GithubCliRepoService,
  parseGhRepoListJson,
  type GhExecFile,
} from './githubCliRepoService';

function makeExecFile(
  impl: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>,
): GhExecFile {
  return (file, args, _options) => impl(file, [...args]);
}

function enoentError(): NodeJS.ErrnoException {
  const err = new Error('spawn gh ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function execError(stderr: string): Error & { stderr: string } {
  const err = new Error('Command failed') as Error & { stderr: string };
  err.stderr = stderr;
  return err;
}

describe('GithubCliRepoService', () => {
  describe('checkPrerequisites', () => {
    it('reports missing gh without side effects beyond version probe', async () => {
      const execFile = vi.fn(makeExecFile(async () => {
        throw enoentError();
      }));
      const service = new GithubCliRepoService(execFile);

      const result = await service.checkPrerequisites();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.prerequisites.installed).toBe(false);
      expect(result.prerequisites.authenticated).toBe(false);
      expect(result.prerequisites.message).toMatch(/not found/i);
      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile).toHaveBeenCalledWith('gh', ['--version'], expect.any(Object));
    });

    it('reports authenticated when version and auth status succeed', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0 (2024-01-01)\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'github.com\n  ✓ Logged in\n', stderr: '' };
          }
          throw new Error(`unexpected: ${args.join(' ')}`);
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.checkPrerequisites();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.prerequisites).toEqual({
        installed: true,
        version: 'gh version 2.40.0 (2024-01-01)',
        authenticated: true,
      });
      expect(execFile).toHaveBeenCalledWith(
        'gh',
        ['auth', 'status', '--hostname', 'github.com'],
        expect.any(Object),
      );
    });

    it('reports unauthenticated when auth status fails', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          throw execError('You are not logged into any GitHub hosts');
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.checkPrerequisites();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.prerequisites.installed).toBe(true);
      expect(result.prerequisites.authenticated).toBe(false);
      expect(result.prerequisites.message).toMatch(/not logged/i);
    });
  });

  describe('listRepos', () => {
    it('builds gh repo list with minimal json fields', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          if (args[1] === 'list') {
            expect(args).toContain('--json');
            const jsonIdx = args.indexOf('--json');
            expect(args[jsonIdx + 1]).toBe(GH_REPO_LIST_JSON_FIELDS.join(','));
            return {
              stdout: JSON.stringify([
                { nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets' },
              ]),
              stderr: '',
            };
          }
          throw new Error(`unexpected: ${args.join(' ')}`);
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.listRepos({ owner: 'acme', limit: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.repos).toEqual([
        { nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets' },
      ]);
      expect(execFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['repo', 'list', 'acme', '--limit', '25']),
        expect.any(Object),
      );
    });

    it('maps missing gh to GH_NOT_INSTALLED', async () => {
      const execFile = vi.fn(makeExecFile(async () => {
        throw enoentError();
      }));
      const service = new GithubCliRepoService(execFile);

      const result = await service.listRepos();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('GH_NOT_INSTALLED');
      expect(result.message).toMatch(/not found|not installed/i);
    });

    it('maps unauthenticated gh to GH_NOT_AUTHENTICATED', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          throw execError('You are not logged into any GitHub hosts');
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.listRepos();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('GH_NOT_AUTHENTICATED');
    });
  });

  describe('createRepo', () => {
    it('runs gh repo create with visibility and owner slug', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          if (args[1] === 'create') {
            expect(args).toEqual([
              'repo',
              'create',
              'acme/new-repo',
              '--private',
              '--confirm',
              '--description',
              'hello',
            ]);
            return { stdout: 'https://github.com/acme/new-repo\n', stderr: '' };
          }
          throw new Error(`unexpected: ${args.join(' ')}`);
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.createRepo({
        name: 'new-repo',
        owner: 'acme',
        visibility: 'private',
        description: 'hello',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.nameWithOwner).toBe('acme/new-repo');
      expect(result.url).toBe('https://github.com/acme/new-repo');
    });

    it('maps create failures to GH_REPO_CREATE_FAILED', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          throw execError('repository already exists');
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.createRepo({
        name: 'dupe',
        visibility: 'public',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('GH_REPO_CREATE_FAILED');
      expect(result.message).toMatch(/already exists/i);
    });

    it('maps permission errors to GH_PERMISSION_DENIED', async () => {
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          throw execError('HTTP 403: Resource not accessible by integration');
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.createRepo({
        name: 'org/repo',
        visibility: 'private',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('GH_PERMISSION_DENIED');
    });
  });

  describe('cloneRepo', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('clones into a new destination with gh repo clone', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-gh-clone-'));
      const destination = path.join(tmpDir, 'widgets');
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          if (args[1] === 'clone') {
            expect(args).toEqual(['repo', 'clone', 'acme/widgets', destination]);
            await fs.mkdir(destination, { recursive: true });
            return { stdout: '', stderr: '' };
          }
          throw new Error(`unexpected: ${args.join(' ')}`);
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.cloneRepo({
        repo: 'acme/widgets',
        destination,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.destination).toBe(destination);
      expect(result.nameWithOwner).toBe('acme/widgets');
    });

    it('rejects an existing destination before invoking gh', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-gh-clone-conflict-'));
      const destination = path.join(tmpDir, 'existing');
      await fs.mkdir(destination);
      const execFile = vi.fn(makeExecFile(async () => ({ stdout: 'ok\n', stderr: '' })));
      const service = new GithubCliRepoService(execFile);

      const result = await service.cloneRepo({
        repo: 'acme/widgets',
        destination,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('CLONE_DESTINATION_EXISTS');
      const cloneCalls = execFile.mock.calls.filter((c) => c[1]?.[1] === 'clone');
      expect(cloneCalls).toHaveLength(0);
    });

    it('maps clone failures to GH_REPO_CLONE_FAILED', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-gh-clone-fail-'));
      const destination = path.join(tmpDir, 'widgets');
      const execFile = vi.fn(
        makeExecFile(async (_file, args) => {
          if (args[0] === '--version') {
            return { stdout: 'gh version 2.40.0\n', stderr: '' };
          }
          if (args[0] === 'auth') {
            return { stdout: 'ok\n', stderr: '' };
          }
          throw execError('fatal: repository not found');
        }),
      );
      const service = new GithubCliRepoService(execFile);

      const result = await service.cloneRepo({
        repo: 'acme/missing',
        destination,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('GH_REPO_CLONE_FAILED');
    });
  });
});

describe('parseGhRepoListJson', () => {
  it('keeps rows with nameWithOwner and ignores invalid entries', () => {
    const repos = parseGhRepoListJson(
      JSON.stringify([
        { nameWithOwner: 'a/b', url: 'https://github.com/a/b' },
        { url: 'https://github.com/orphan' },
        'not-an-object',
      ]),
    );
    expect(repos).toEqual([{ nameWithOwner: 'a/b', url: 'https://github.com/a/b' }]);
  });
});
