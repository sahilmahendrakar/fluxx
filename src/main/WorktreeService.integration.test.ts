import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { WorktreeService } from './WorktreeService';
import { isWorktreeCreateError } from './worktreeCreateError';
import { worktreePathSegmentsForFluxBranch } from './fluxTaskWorkBranchNaming';

const execFile = promisify(execFileCallback);

async function initGitRepo(cwd: string): Promise<void> {
  await fs.mkdir(cwd, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd });
  await execFile('git', ['config', 'user.email', 'flux@test'], { cwd });
  await execFile('git', ['config', 'user.name', 'flux'], { cwd });
  await fs.writeFile(path.join(cwd, 'f.txt'), 'a\n', 'utf8');
  await execFile('git', ['add', 'f.txt'], { cwd });
  await execFile('git', ['commit', '-m', 'first'], { cwd });
}

async function localBranchExists(cwd: string, shortName: string): Promise<boolean> {
  try {
    await execFile('git', ['show-ref', '--verify', '--quiet', `refs/heads/${shortName}`], {
      cwd,
    });
    return true;
  } catch {
    return false;
  }
}

describe('WorktreeService.create integration', () => {
  const legacyLayout = 'legacy-flat' as const;

  it('creates missing source branch from default then worktree, and remove drops task branch', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
    const gitRoot = path.join(root, 'repo');
    const projectDir = path.join(root, 'flux-project');
    try {
      await initGitRepo(gitRoot);
      const svc = new WorktreeService(gitRoot, projectDir);
      const sourceName = 'flux-int-source';
      const primaryRepoId =
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const { worktreePath, branch } = await svc.create({
        task: { id: 'mytaskid', title: 'Source branch integration' },
        repo: {
          repoId: primaryRepoId,
          gitRootPath: gitRoot,
          baseBranch: 'main',
        },
        source: {
          sourceBranchShort: sourceName,
          createSourceBranchIfMissing: true,
        },
        layout: legacyLayout,
      });
      expect(branch.startsWith('flux/')).toBe(true);
      expect(worktreePath).toBe(
        path.join(projectDir, 'worktrees', ...worktreePathSegmentsForFluxBranch(branch)),
      );
      await expect(fs.stat(worktreePath)).resolves.toBeDefined();
      expect(await localBranchExists(gitRoot, sourceName)).toBe(true);
      expect(await localBranchExists(gitRoot, branch)).toBe(true);

      await svc.remove(worktreePath, path.resolve(gitRoot));

      expect(await localBranchExists(gitRoot, sourceName)).toBe(true);
      expect(await localBranchExists(gitRoot, branch)).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('scopes worktrees under worktrees/<repoId>/<branch-segments> for two clones with different default branches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-multi-'));
    const gitRootA = path.join(root, 'repo-a');
    const gitRootB = path.join(root, 'repo-b');
    const projectDir = path.join(root, 'flux-project');
    const repoIdA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const repoIdB = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    try {
      await initGitRepo(gitRootA);
      await initGitRepo(gitRootB);
      await execFile('git', ['branch', '-m', 'develop'], { cwd: gitRootB });

      const svc = new WorktreeService(gitRootA, projectDir);
      await fs.mkdir(projectDir, { recursive: true });

      const srcA = 'main-a-only';
      const outA = await svc.create({
        task: { id: 'task-a', title: 'Task on main clone' },
        repo: {
          repoId: repoIdA,
          gitRootPath: gitRootA,
          baseBranch: 'main',
        },
        source: {
          sourceBranchShort: srcA,
          createSourceBranchIfMissing: true,
        },
        layout: 'repo-scoped',
      });
      expect(outA.branch.startsWith('flux/')).toBe(true);
      expect(outA.worktreePath).toBe(
        path.join(projectDir, 'worktrees', repoIdA, ...worktreePathSegmentsForFluxBranch(outA.branch)),
      );

      const srcB = 'develop';
      const outB = await svc.create({
        task: { id: 'task-b', title: 'Task on develop clone' },
        repo: {
          repoId: repoIdB,
          gitRootPath: gitRootB,
          baseBranch: 'develop',
        },
        source: {
          sourceBranchShort: srcB,
          createSourceBranchIfMissing: false,
        },
        layout: 'repo-scoped',
      });
      expect(outB.branch.startsWith('flux/')).toBe(true);
      expect(outB.worktreePath).toBe(
        path.join(projectDir, 'worktrees', repoIdB, ...worktreePathSegmentsForFluxBranch(outB.branch)),
      );

      const headA = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: outA.worktreePath,
        encoding: 'utf8',
      });
      const tipSrcA = await execFile('git', ['rev-parse', srcA], {
        cwd: gitRootA,
        encoding: 'utf8',
      });
      expect(headA.stdout.trim()).toBe(tipSrcA.stdout.trim());

      const headB = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: outB.worktreePath,
        encoding: 'utf8',
      });
      const tipDevelop = await execFile('git', ['rev-parse', 'develop'], {
        cwd: gitRootB,
        encoding: 'utf8',
      });
      expect(headB.stdout.trim()).toBe(tipDevelop.stdout.trim());

      await svc.remove(outA.worktreePath, path.resolve(gitRootA));
      await svc.remove(outB.worktreePath, path.resolve(gitRootB));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('writes env contents and runs the selected repo setup script', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-env-'));
    const gitRoot = path.join(root, 'repo');
    const projectDir = path.join(root, 'flux-project');
    try {
      await initGitRepo(gitRoot);
      const svc = new WorktreeService(gitRoot, projectDir);
      const { worktreePath } = await svc.create({
        task: { id: 'task-env-setup', title: 'Env setup task' },
        repo: {
          repoId:
            '1212121212121212121212121212121212121212121212121212121212121212',
          gitRootPath: gitRoot,
          baseBranch: 'main',
          env: 'TOKEN=repo-specific\n',
          setupScript: 'printf setup-ok > setup-result.txt',
        },
        source: {
          sourceBranchShort: 'main',
          createSourceBranchIfMissing: false,
        },
        layout: 'repo-scoped',
      });

      await expect(fs.readFile(path.join(worktreePath, '.env'), 'utf8')).resolves.toBe(
        'TOKEN=repo-specific\n',
      );
      await expect(
        fs.readFile(path.join(worktreePath, 'setup-result.txt'), 'utf8'),
      ).resolves.toBe('setup-ok');

      await svc.remove(worktreePath, path.resolve(gitRoot));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('throws WORKTREE_SOURCE_BRANCH_MISSING when branch missing and creation disabled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
    const gitRoot = path.join(root, 'repo');
    const projectDir = path.join(root, 'flux-project');
    try {
      await initGitRepo(gitRoot);
      const svc = new WorktreeService(gitRoot, projectDir);
      await expect(
        svc.create({
          task: { id: 't2', title: 'Missing branch task' },
          repo: {
            repoId:
              'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            gitRootPath: gitRoot,
            baseBranch: 'main',
          },
          source: {
            sourceBranchShort: 'does-not-exist',
            createSourceBranchIfMissing: false,
          },
          layout: legacyLayout,
        }),
      ).rejects.toSatisfy(
        (e: unknown) =>
          isWorktreeCreateError(e) && e.code === 'WORKTREE_SOURCE_BRANCH_MISSING',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('bases worktree on origin/main when local main has diverged', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
    const gitRoot = path.join(root, 'repo');
    const projectDir = path.join(root, 'flux-project');
    try {
      await initGitRepo(gitRoot);
      const { stdout: originTipOut } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: gitRoot,
        encoding: 'utf8',
      });
      const originMainSha = originTipOut.trim();
      await execFile('git', ['update-ref', 'refs/remotes/origin/main', originMainSha], {
        cwd: gitRoot,
      });
      await fs.appendFile(path.join(gitRoot, 'f.txt'), 'local-only\n', 'utf8');
      await execFile('git', ['commit', '-am', 'ahead of origin'], { cwd: gitRoot });
      const { stdout: localMainOut } = await execFile('git', ['rev-parse', 'main'], {
        cwd: gitRoot,
        encoding: 'utf8',
      });
      const localMainSha = localMainOut.trim();
      expect(localMainSha).not.toBe(originMainSha);

      const svc = new WorktreeService(gitRoot, projectDir);
      const { worktreePath } = await svc.create({
        task: { id: 'task-origin-main', title: 'Origin main divergence' },
        repo: {
          repoId:
            'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          gitRootPath: gitRoot,
          baseBranch: 'main',
        },
        source: {
          sourceBranchShort: 'main',
          createSourceBranchIfMissing: false,
        },
        layout: legacyLayout,
      });
      const { stdout: wtHeadOut } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf8',
      });
      expect(wtHeadOut.trim()).toBe(originMainSha);
      expect(wtHeadOut.trim()).not.toBe(localMainSha);

      await svc.remove(worktreePath, path.resolve(gitRoot));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reuses existing flux task branch without rebasing onto a changed task source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
    const gitRoot = path.join(root, 'repo');
    const projectDir = path.join(root, 'flux-project');
    try {
      await initGitRepo(gitRoot);
      await execFile('git', ['checkout', '-b', 'first-source'], { cwd: gitRoot });
      await fs.appendFile(path.join(gitRoot, 'f.txt'), 'src1\n', 'utf8');
      await execFile('git', ['commit', '-am', 'on first'], { cwd: gitRoot });

      const svc = new WorktreeService(gitRoot, projectDir);
      const taskId = 'reuseme';
      const { branch } = await svc.create({
        task: { id: taskId, title: 'Reuse me test' },
        repo: {
          repoId:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          gitRootPath: gitRoot,
          baseBranch: 'main',
        },
        source: {
          sourceBranchShort: 'first-source',
          createSourceBranchIfMissing: false,
        },
        layout: legacyLayout,
      });
      expect(await localBranchExists(gitRoot, branch)).toBe(true);

      await execFile('git', ['checkout', 'main'], { cwd: gitRoot });
      await execFile('git', ['branch', 'second-source'], { cwd: gitRoot });
      await fs.appendFile(path.join(gitRoot, 'f.txt'), 'src2\n', 'utf8');
      await execFile('git', ['commit', '-am', 'on second'], { cwd: gitRoot });
      await execFile('git', ['checkout', 'main'], { cwd: gitRoot });

      const again = await svc.create({
        task: { id: taskId, title: 'Different title', fluxWorkBranch: branch },
        repo: {
          repoId:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          gitRootPath: gitRoot,
          baseBranch: 'main',
        },
        source: {
          sourceBranchShort: 'second-source',
          createSourceBranchIfMissing: false,
        },
        layout: legacyLayout,
      });
      const head = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: again.worktreePath,
        encoding: 'utf8',
      });
      const firstTip = await execFile('git', ['rev-parse', 'first-source'], {
        cwd: gitRoot,
        encoding: 'utf8',
      });
      const secondTip = await execFile('git', ['rev-parse', 'second-source'], {
        cwd: gitRoot,
        encoding: 'utf8',
      });
      expect(head.stdout.trim()).toBe(firstTip.stdout.trim());
      expect(head.stdout.trim()).not.toBe(secondTip.stdout.trim());

      await svc.remove(again.worktreePath, path.resolve(gitRoot));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
