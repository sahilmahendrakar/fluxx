import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { collectRepoBranchDiscovery } from './repoGit';
import {
  classifyGitBranchPresence,
  planTaskSourceBranchFieldsForCreate,
} from '../taskBranches';
import type { RepoConfig } from '../types';
import { resolveRepoForBranchDiscovery } from '../repoIdentity';

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

describe('repo-scoped branch discovery (multi-repo2)', () => {
  it('defaults planned source branch from each repo baseBranch / discovery', async () => {
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-rs-a-'));
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-rs-b-'));
    try {
      await initGitRepo(dirA);
      await initGitRepo(dirB);
      const discA = await collectRepoBranchDiscovery(dirA, '');
      const discB = await collectRepoBranchDiscovery(dirB, 'develop');
      const planA = planTaskSourceBranchFieldsForCreate(discA, {});
      const planB = planTaskSourceBranchFieldsForCreate(discB, {});
      expect(planA.sourceBranch).toBe(discA.defaultBranchShort);
      expect(discB.defaultBranchShort).toBe('develop');
      expect(planB.sourceBranch).toBe('develop');

      const classifyOnB = classifyGitBranchPresence(
        'totally-absent-branch-xyz',
        discB.localBranches,
        discB.remoteBranches,
      );
      expect(classifyOnB.presence).toBe('missing');
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });

  it('resolveRepoForBranchDiscovery selects non-primary repo by id', () => {
    const repos: RepoConfig[] = [
      {
        id: 'primary-id',
        rootPath: '/abs/primary',
        baseBranch: 'main',
      },
      {
        id: 'secondary-id',
        name: 'Backend',
        rootPath: '/abs/backend',
        baseBranch: 'develop',
      },
    ];
    expect(resolveRepoForBranchDiscovery(repos, 'secondary-id')?.baseBranch).toBe('develop');
    expect(resolveRepoForBranchDiscovery(repos, undefined)?.id).toBe('primary-id');
  });
});
