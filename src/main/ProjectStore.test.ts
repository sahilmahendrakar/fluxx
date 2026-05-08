import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backfillRepoIdentities, ProjectStore } from './ProjectStore';
import { deriveStablePrimaryRepoIdForProject } from '../repoIdentity';

const PROJECT_ID = 'p1';

async function writeLegacyConfig(
  projectDir: string,
  rootPath: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  // Legacy single-repo config: `repos[0]` lacks `id` and `name`.
  const config = {
    id: PROJECT_ID,
    name: 'Demo',
    rootPath,
    addedAt: '2025-01-01T00:00:00.000Z',
    planningAgent: 'claude-code',
    defaultTaskAgent: 'claude-code',
    autoStartSessionOnInProgress: false,
    autoStartWhenUnblocked: false,
    autoCleanupWorkspaceWhenDone: false,
    autoMarkDoneWhenPrMerged: false,
    autoMoveToReviewWhenPrOpen: false,
    repos: [{ rootPath, baseBranch: 'develop', setupScript: 'echo hi', env: 'X=1' }],
    ...body,
  };
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}

describe('backfillRepoIdentities (multi-repo2)', () => {
  it('fills missing id/name deterministically and preserves baseBranch / setupScript / env', () => {
    const out = backfillRepoIdentities({
      projectId: PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: [
        { rootPath: '/abs/repo', baseBranch: 'main', setupScript: 'pnpm i', env: 'X=1' },
      ],
    });
    expect(out.mutated).toBe(true);
    expect(out.repos).toHaveLength(1);
    expect(out.repos[0].id).toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId: PROJECT_ID,
        rootPath: '/abs/repo',
      }),
    );
    expect(out.repos[0].name).toBe('repo');
    expect(out.repos[0].baseBranch).toBe('main');
    expect(out.repos[0].setupScript).toBe('pnpm i');
    expect(out.repos[0].env).toBe('X=1');
  });

  it('is idempotent on already-migrated configs', () => {
    const seeded = backfillRepoIdentities({
      projectId: PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: [{ rootPath: '/abs/repo', baseBranch: 'main' }],
    });
    const second = backfillRepoIdentities({
      projectId: PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: seeded.repos,
    });
    expect(second.mutated).toBe(false);
    expect(second.repos).toEqual(seeded.repos);
  });

  it('disambiguates duplicate ids across repos', () => {
    const out = backfillRepoIdentities({
      projectId: PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: [
        { id: 'shared', rootPath: '/abs/repo', baseBranch: 'main' },
        { id: 'shared', rootPath: '/abs/other', baseBranch: 'main' },
      ],
    });
    expect(out.repos[0].id).toBe('shared');
    expect(out.repos[1].id).not.toBe('shared');
  });
});

describe('ProjectStore.init multi-repo2 migration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-projectstore-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('a current single-repo project loads with exactly one repo carrying a deterministic id', async () => {
    const rootPath = path.join(tmp, 'src-root');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootPath, { recursive: true });
    await writeLegacyConfig(projectDir, rootPath);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    const project = store.get();
    if (!project) throw new Error('expected loaded project');
    expect(project.repos).toHaveLength(1);
    const repo = project.repos[0];
    expect(repo.id).toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId: PROJECT_ID,
        rootPath,
      }),
    );
    expect(repo.name).toBe('src-root');
    // baseBranch / setupScript / env preserved through the migration.
    expect(repo.baseBranch).toBe('develop');
    expect(repo.setupScript).toBe('echo hi');
    expect(repo.env).toBe('X=1');

    // Migration is persisted: the second load should not need to rewrite.
    const onDisk = JSON.parse(
      await fs.readFile(path.join(projectDir, 'config.json'), 'utf8'),
    ) as { repos: Array<{ id?: string; name?: string }> };
    expect(onDisk.repos[0].id).toBe(repo.id);
    expect(onDisk.repos[0].name).toBe('src-root');
  });

  it('rootPath is NOT used as identity — moving the clone keeps the id stable across reloads', async () => {
    const rootPathA = path.join(tmp, 'src-a');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootPathA, { recursive: true });
    await writeLegacyConfig(projectDir, rootPathA);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    const projectA = store.get();
    if (!projectA) throw new Error('expected loaded project');
    const idA = projectA.repos[0].id;

    // Reloading the same project (without changing rootPath) must yield the same id.
    const store2 = new ProjectStore(tmp);
    await store2.init(projectDir);
    const projectA2 = store2.get();
    if (!projectA2) throw new Error('expected loaded project');
    expect(projectA2.repos[0].id).toBe(idA);
    // A repo with a different rootPath in a different project gets a different id.
    const otherProjectDir = path.join(tmp, 'project-other');
    await writeLegacyConfig(otherProjectDir, path.join(tmp, 'src-b'), {
      id: 'p2',
    });
    const store3 = new ProjectStore(tmp);
    await store3.init(otherProjectDir);
    const projectB = store3.get();
    if (!projectB) throw new Error('expected loaded project');
    expect(projectB.repos[0].id).not.toBe(idA);
  });
});
