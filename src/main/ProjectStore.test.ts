import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backfillRepoIdentities,
  ensurePlanningAssistantMarkdownFiles,
  ProjectStore,
} from './ProjectStore';
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

describe('ProjectStore repo-id operations', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-projectstore-repos-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function touchGitRepo(dir: string): Promise<void> {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  }

  it('updateRepoByIdAt updates fields by stable id', async () => {
    const rootPath = path.join(tmp, 'repo-a');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootPath, { recursive: true });
    await touchGitRepo(rootPath);
    await writeLegacyConfig(projectDir, rootPath);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    const id = store.get()?.repos[0].id;
    if (!id) throw new Error('expected repo id');

    const repos = await store.updateRepoByIdAt(projectDir, id, {
      baseBranch: 'release',
      name: 'Core',
    });
    expect(repos[0].baseBranch).toBe('release');
    expect(repos[0].name).toBe('Core');
  });

  it('addRepoAt appends a git repo and rejects duplicates', async () => {
    const rootA = path.join(tmp, 'a');
    const rootB = path.join(tmp, 'b');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    await writeLegacyConfig(projectDir, rootA);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);

    const repos = await store.addRepoAt(projectDir, rootB);
    expect(repos).toHaveLength(2);
    await expect(store.addRepoAt(projectDir, rootB)).rejects.toThrow(/already part of this project/);
  });

  it('preserves added repos after reopening the local project root', async () => {
    const rootA = path.join(tmp, 'a');
    const rootB = path.join(tmp, 'b');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);

    const store = new ProjectStore(tmp);
    const { projectDir } = await store.create(rootA);
    await store.addRepoAt(projectDir, rootB);

    const reopened = new ProjectStore(tmp);
    await reopened.create(rootA);

    const repos = reopened.get()?.repos ?? [];
    expect(repos.map((r) => path.resolve(r.rootPath))).toEqual([
      path.resolve(rootA),
      path.resolve(rootB),
    ]);
  });

  it('keeps cloud materialized config separate from a local project with the same root basename', async () => {
    const rootA = path.join(tmp, 'same-name');
    const cloudExtra = path.join(tmp, 'cloud-extra');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(cloudExtra, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(cloudExtra);

    const local = new ProjectStore(tmp);
    const { projectDir: localDir } = await local.create(rootA);

    const cloud = new ProjectStore(tmp);
    const { projectDir: cloudDir } = await cloud.ensureCloudLayoutForRoot('cloud-123', rootA);
    expect(cloudDir).not.toBe(localDir);
    await cloud.addRepoAt(cloudDir, cloudExtra);

    const reopened = new ProjectStore(tmp);
    await reopened.create(rootA);
    const localRepos = reopened.get()?.repos ?? [];
    expect(localRepos.map((r) => path.resolve(r.rootPath))).toEqual([path.resolve(rootA)]);

    const cloudRepos = await cloud.getReposAt(cloudDir);
    expect(cloudRepos.map((r) => path.resolve(r.rootPath))).toEqual([
      path.resolve(rootA),
      path.resolve(cloudExtra),
    ]);
  });

  it('setPrimaryRepoAt moves repo to index 0 and syncs project rootPath', async () => {
    const rootA = path.join(tmp, 'a');
    const rootB = path.join(tmp, 'b');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    await writeLegacyConfig(projectDir, rootA);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    await store.addRepoAt(projectDir, rootB);
    const loaded = store.get();
    const secondId = loaded?.repos[1]?.id;
    if (!secondId) throw new Error('expected second repo');

    const repos = await store.setPrimaryRepoAt(projectDir, secondId);
    expect(repos[0].rootPath).toBe(path.resolve(rootB));
    expect(store.get()?.rootPath).toBe(path.resolve(rootB));
  });

  it('removeRepoAt drops a secondary repo', async () => {
    const rootA = path.join(tmp, 'a');
    const rootB = path.join(tmp, 'b');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    await writeLegacyConfig(projectDir, rootA);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    await store.addRepoAt(projectDir, rootB);
    const rid = store.get()?.repos[1]?.id;
    if (!rid) throw new Error('expected second repo');

    const repos = await store.removeRepoAt(projectDir, rid);
    expect(repos).toHaveLength(1);
    expect(repos[0].rootPath).toBe(path.resolve(rootA));
  });
});

describe('ensurePlanningAssistantMarkdownFiles (multi-repo2 planning copy)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-md-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes repo-aware MCP guidance when multiRepoGuide is true', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'MyApp', '/tmp/primary', {
      multiRepoGuide: true,
    });
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('flux__get_project_info');
    expect(claude).toContain('repos[]');
    expect(claude).toContain('repoId');
  });

  it('uses single-repo tool copy when multiRepoGuide is false', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'Solo', '/tmp/one', {
      multiRepoGuide: false,
    });
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('flux__get_project_info');
    expect(claude).not.toContain('repos[]');
    expect(claude).not.toContain('repoId');
  });
});
