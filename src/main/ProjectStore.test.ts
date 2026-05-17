import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backfillRepoIdentities,
  ensurePlanningAssistantMarkdownFiles,
  ProjectStore,
} from './ProjectStore';
import { planningAssistantMarkdown, PLANNING_ASSISTANT_TEMPLATE_VERSION, wrapPlanningInstructionsManagedBlock } from './planningAssistantInstructions';
import { stripFluxPlanningTemplateVersionComment } from '../planningDocs/cloudPlanningDocsMigration';
import {
  FLUX_PLANNING_INSTRUCTIONS_BEGIN,
  PLANNING_INSTRUCTIONS_STATE_BASENAME,
} from '../planningDocs/planningInstructionMarkers';
import { deriveStablePrimaryRepoIdForProject } from '../repoIdentity';
import { stableLocalProjectIdForRoot, legacyCloudProjectDir, assertSafeToDeleteLegacyFlatProjectsRoot } from './projectDirLayout';
import { PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME } from '../planningDocs/planningUserDocsLegacyMigration';

const TEST_PROJECT_ID = 'p1';

async function writeLegacyConfig(
  projectDir: string,
  rootPath: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  const id =
    typeof body.id === 'string'
      ? body.id
      : stableLocalProjectIdForRoot(rootPath);
  // Legacy single-repo config: `repos[0]` lacks `id` and `name`.
  const config = {
    id,
    name: 'Demo',
    rootPath,
    addedAt: '2025-01-01T00:00:00.000Z',
    planningAgent: 'claude-code',
    defaultTaskAgent: 'claude-code',
    autoStartSessionOnInProgress: false,
    autoRespondToTrustPrompts: false,
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
      projectId: TEST_PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: [
        { rootPath: '/abs/repo', baseBranch: 'main', setupScript: 'pnpm i', env: 'X=1' },
      ],
    });
    expect(out.mutated).toBe(true);
    expect(out.repos).toHaveLength(1);
    expect(out.repos[0].id).toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId: TEST_PROJECT_ID,
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
      projectId: TEST_PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: [{ rootPath: '/abs/repo', baseBranch: 'main' }],
    });
    const second = backfillRepoIdentities({
      projectId: TEST_PROJECT_ID,
      primaryRootPath: '/abs/repo',
      repos: seeded.repos,
    });
    expect(second.mutated).toBe(false);
    expect(second.repos).toEqual(seeded.repos);
  });

  it('disambiguates duplicate ids across repos', () => {
    const out = backfillRepoIdentities({
      projectId: TEST_PROJECT_ID,
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
    const projectId = stableLocalProjectIdForRoot(rootPath);
    expect(project.id).toBe(projectId);
    expect(project.repos).toHaveLength(1);
    const repo = project.repos[0];
    expect(repo.id).toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId,
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

  it('applyCloudRepoBindings preserves local setup script and env by repo id', async () => {
    const rootA = path.join(tmp, 'repo-a');
    const rootB = path.join(tmp, 'repo-b');
    const projectDir = path.join(tmp, 'project');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    await writeLegacyConfig(projectDir, rootA);

    const store = new ProjectStore(tmp);
    await store.init(projectDir);
    const id = store.get()?.repos[0].id;
    if (!id) throw new Error('expected repo id');
    await store.updateRepoByIdAt(projectDir, id, {
      setupScript: 'pnpm install',
      env: 'API_KEY=local',
    });

    await store.applyCloudRepoBindings(projectDir, rootB, [
      {
        id,
        name: 'Cloud repo',
        rootPath: rootB,
        baseBranch: 'release',
      },
    ]);

    const repos = await store.getReposAt(projectDir);
    expect(repos[0]).toMatchObject({
      id,
      name: 'Cloud repo',
      rootPath: path.resolve(rootB),
      baseBranch: 'release',
      setupScript: 'pnpm install',
      env: 'API_KEY=local',
    });
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
    expect(localDir).toBe(path.join(tmp, 'projects', stableLocalProjectIdForRoot(rootA)));

    const cloud = new ProjectStore(tmp);
    const { projectDir: cloudDir } = await cloud.ensureCloudLayoutForRoot('cloud-123', rootA);
    expect(cloudDir).not.toBe(localDir);
    expect(cloudDir).toBe(path.join(tmp, 'projects', 'cloud-123'));
    const cloudConfig = JSON.parse(
      await fs.readFile(path.join(cloudDir, 'config.json'), 'utf8'),
    ) as { id: string };
    expect(cloudConfig.id).toBe('cloud-123');
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

  it('migrates legacy basename Flux dir to ~/.flux/projects/<id>/ on create', async () => {
    const rootA = path.join(tmp, 'w', 'repo-name');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const legacyFluxDir = path.join(tmp, 'repo-name');
    await writeLegacyConfig(legacyFluxDir, rootA);
    const expectedId = stableLocalProjectIdForRoot(rootA);

    const store = new ProjectStore(tmp);
    const { projectDir } = await store.create(rootA);
    expect(path.resolve(projectDir)).toBe(
      path.resolve(path.join(tmp, 'projects', expectedId)),
    );
    await expect(fs.stat(legacyFluxDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('defers local basename migration when legacy worktrees exist', async () => {
    const rootA = path.join(tmp, 'w', 'active-repo');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const legacyFluxDir = path.join(tmp, 'active-repo');
    await writeLegacyConfig(legacyFluxDir, rootA);
    await fs.mkdir(path.join(legacyFluxDir, 'worktrees', 'active-task'), { recursive: true });

    const store = new ProjectStore(tmp);
    const { projectDir } = await store.create(rootA);
    expect(path.resolve(projectDir)).toBe(path.resolve(legacyFluxDir));
    await expect(fs.stat(path.join(legacyFluxDir, 'config.json'))).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tmp, 'projects', stableLocalProjectIdForRoot(rootA), 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('migrates cloud-projects/<id> into projects/<id> when canonical is empty', async () => {
    const rootA = path.join(tmp, 'r1');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const legacyCloud = path.join(tmp, 'cloud-projects', 'acme');
    await fs.mkdir(legacyCloud, { recursive: true });
    await writeLegacyConfig(legacyCloud, rootA, { id: stableLocalProjectIdForRoot(rootA) });

    const cloud = new ProjectStore(tmp);
    const { projectDir } = await cloud.ensureCloudLayoutForRoot('acme', rootA);
    expect(path.resolve(projectDir)).toBe(path.resolve(path.join(tmp, 'projects', 'acme')));
    const migratedConfig = JSON.parse(
      await fs.readFile(path.join(projectDir, 'config.json'), 'utf8'),
    ) as { id: string };
    expect(migratedConfig.id).toBe('acme');
  });

  it('defers cloud legacy migration when legacy worktrees exist', async () => {
    const rootA = path.join(tmp, 'r1-active');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const legacyCloud = path.join(tmp, 'cloud-projects', 'acme-active');
    await fs.mkdir(path.join(legacyCloud, 'worktrees', 'active-task'), { recursive: true });
    await writeLegacyConfig(legacyCloud, rootA, { id: stableLocalProjectIdForRoot(rootA) });

    const cloud = new ProjectStore(tmp);
    const { projectDir, project } = await cloud.ensureCloudLayoutForRoot('acme-active', rootA);
    expect(path.resolve(projectDir)).toBe(path.resolve(legacyCloud));
    expect(project.id).toBe('acme-active');
    await expect(
      fs.stat(path.join(tmp, 'projects', 'acme-active', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('adopts existing canonical cloud configs to the cloud project id', async () => {
    const rootA = path.join(tmp, 'r2');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const canonicalCloud = path.join(tmp, 'projects', 'cloud-existing');
    await writeLegacyConfig(canonicalCloud, rootA, { id: stableLocalProjectIdForRoot(rootA) });

    const cloud = new ProjectStore(tmp);
    const { projectDir } = await cloud.ensureCloudLayoutForRoot('cloud-existing', rootA);
    expect(path.resolve(projectDir)).toBe(path.resolve(canonicalCloud));
    const adoptedConfig = JSON.parse(
      await fs.readFile(path.join(projectDir, 'config.json'), 'utf8'),
    ) as { id: string };
    expect(adoptedConfig.id).toBe('cloud-existing');
  });

  it('marks matching legacy cloud dirs superseded when canonical already exists', async () => {
    const rootA = path.join(tmp, 'r3');
    await fs.mkdir(rootA, { recursive: true });
    await touchGitRepo(rootA);
    const canonicalCloud = path.join(tmp, 'projects', 'cloud-retire');
    const legacyCloud = path.join(tmp, 'cloud-projects', 'cloud-retire');
    await writeLegacyConfig(canonicalCloud, rootA, { id: 'cloud-retire' });
    await writeLegacyConfig(legacyCloud, rootA, { id: stableLocalProjectIdForRoot(rootA) });

    const cloud = new ProjectStore(tmp);
    await cloud.ensureCloudLayoutForRoot('cloud-retire', rootA);

    await expect(fs.readFile(path.join(legacyCloud, '.flux-superseded-by'), 'utf8')).resolves.toBe(
      `${canonicalCloud}\n`,
    );
  });

  it('writes a conflict artifact when legacy cloud dir does not match canonical', async () => {
    const rootA = path.join(tmp, 'r4-a');
    const rootB = path.join(tmp, 'r4-b');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    const canonicalCloud = path.join(tmp, 'projects', 'cloud-conflict');
    const legacyCloud = path.join(tmp, 'cloud-projects', 'cloud-conflict');
    await writeLegacyConfig(canonicalCloud, rootA, { id: 'cloud-conflict' });
    await writeLegacyConfig(legacyCloud, rootB, { id: stableLocalProjectIdForRoot(rootB) });

    const cloud = new ProjectStore(tmp);
    await expect(cloud.ensureCloudLayoutForRoot('cloud-conflict', rootA)).rejects.toThrow(
      /migration conflict/,
    );
    const conflict = JSON.parse(
      await fs.readFile(path.join(legacyCloud, '.flux-migration-conflict.json'), 'utf8'),
    ) as { legacyDir: string; canonicalDir: string; reason: string };
    expect(conflict.legacyDir).toBe(legacyCloud);
    expect(conflict.canonicalDir).toBe(canonicalCloud);
    expect(conflict.reason).toContain('do not describe the same project');
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

describe('ProjectStore.listMaterializationDirsForProjectId', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-materialization-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns only directories whose config id matches, across canonical and legacy cloud paths', async () => {
    const rootLocal = path.join(tmp, 'repo-local');
    await fs.mkdir(rootLocal, { recursive: true });
    const localId = stableLocalProjectIdForRoot(rootLocal);
    const canonical = path.join(tmp, 'projects', localId);
    await writeLegacyConfig(canonical, rootLocal, { id: localId });

    const otherRoot = path.join(tmp, 'repo-other');
    await fs.mkdir(otherRoot, { recursive: true });
    const otherId = stableLocalProjectIdForRoot(otherRoot);
    await writeLegacyConfig(path.join(tmp, 'projects', otherId), otherRoot, { id: otherId });

    const cloudId = 'cloudProj_1';
    const legacyCloud = legacyCloudProjectDir(tmp, cloudId);
    await writeLegacyConfig(legacyCloud, rootLocal, { id: cloudId, name: 'Team' });

    const store = new ProjectStore(tmp);
    const localDirs = await store.listMaterializationDirsForProjectId(localId);
    expect(localDirs.map((p) => path.resolve(p))).toEqual([path.resolve(canonical)]);

    const cloudDirs = await store.listMaterializationDirsForProjectId(cloudId);
    expect(cloudDirs.map((p) => path.resolve(p))).toEqual([path.resolve(legacyCloud)]);
  });

  it('refuses unsafe legacy flat ~/.flux/projects root deletion when nested projects exist', async () => {
    const projectsRoot = path.join(tmp, 'projects');
    const nested = path.join(projectsRoot, 'nested');
    await writeLegacyConfig(nested, path.join(tmp, 'r2'), { id: 'nested-proj' });
    await writeLegacyConfig(projectsRoot, path.join(tmp, 'r1'), { id: 'flat-proj' });

    await expect(assertSafeToDeleteLegacyFlatProjectsRoot(tmp, projectsRoot)).rejects.toThrow(
      /Refusing to delete/,
    );
  });

  it('allows legacy flat ~/.flux/projects root deletion when no nested project dirs exist', async () => {
    const projectsRoot = path.join(tmp, 'projects');
    await writeLegacyConfig(projectsRoot, path.join(tmp, 'r1'), { id: 'flat-only' });
    await expect(assertSafeToDeleteLegacyFlatProjectsRoot(tmp, projectsRoot)).resolves.toBeUndefined();
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

  it('writes repo-aware CLI guidance when multiRepoGuide is true', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'MyApp', '/tmp/primary', {
      multiRepoGuide: true,
    });
    expect((await fs.stat(path.join(dir, 'docs'))).isDirectory()).toBe(true);
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('<!-- flux-planning-template 3 -->');
    expect(claude).toContain('## Multi-task features (required)');
    expect(claude).toContain('flux project info --json');
    expect(claude).toContain('repos[]');
    expect(claude).toContain('--repo-id');
    expect(claude).toContain('do **not** create a `FLUX_BIN` variable');
    expect(claude).not.toContain('flux__');
  });

  it('migrates legacy top-level markdown into docs/ when present', async () => {
    await fs.writeFile(path.join(dir, 'preseed.md'), 'body', 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'M', '/tmp/p', { multiRepoGuide: true });
    await expect(fs.readFile(path.join(dir, 'docs', 'preseed.md'), 'utf8')).resolves.toBe('body');
    await expect(fs.access(path.join(dir, PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME))).resolves.toBeUndefined();
  });

  it('uses single-repo CLI copy when multiRepoGuide is false', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'Solo', '/tmp/one', {
      multiRepoGuide: false,
    });
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('flux project info --json');
    expect(claude).not.toContain('repos[]');
    expect(claude).not.toContain('--repo-id');
    expect(claude).not.toContain('flux__');
  });

  it('upgrades generated CLI assistant files missing the current version marker', async () => {
    const v1Cli = `# Planning workspace — Old

## Flux CLI

Planning sessions inject bridge env.
`;
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), v1Cli, 'utf8');

    await ensurePlanningAssistantMarkdownFiles(dir, 'Upgraded', '/tmp/repo', {
      multiRepoGuide: false,
    });

    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('<!-- flux-planning-template 3 -->');
    expect(claude).toContain('## Multi-task features (required)');
    expect(claude).toContain('--depends-on-task-id');
  });

  it('migrates generated MCP-era assistant files to CLI guidance', async () => {
    const legacy = `# Planning workspace — Old

You have access to the following Flux tools for task management:
- \`flux__get_project_info\`
- \`flux__create_task\`
`;
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), legacy, 'utf8');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), legacy, 'utf8');

    await ensurePlanningAssistantMarkdownFiles(dir, 'Migrated', '/tmp/repo', {
      multiRepoGuide: false,
    });

    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(claude).toContain('flux project info --json');
    expect(agents).toContain('flux tasks create --json');
    expect(claude).not.toContain('flux__');
    expect(agents).not.toContain('flux__');
  });

  it('preserves non-generated assistant files', async () => {
    const custom = '# Custom project instructions\n\nKeep this hand-written note.\n';
    await fs.writeFile(path.join(dir, 'AGENTS.md'), custom, 'utf8');

    await ensurePlanningAssistantMarkdownFiles(dir, 'Custom', '/tmp/repo', {
      multiRepoGuide: false,
    });

    await expect(fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8')).resolves.toBe(custom);
  });

  it('wraps new seeds with Flux markers and persists instruction state', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'N', '/tmp/root', { multiRepoGuide: true });
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain(FLUX_PLANNING_INSTRUCTIONS_BEGIN);
    expect(claude).toContain('<!-- flux-planning-template');
    const st = JSON.parse(
      await fs.readFile(path.join(dir, PLANNING_INSTRUCTIONS_STATE_BASENAME), 'utf8'),
    ) as { schemaVersion: number; files: Record<string, unknown> };
    expect(st.schemaVersion).toBe(1);
    expect(st.files['CLAUDE.md']).toBeDefined();
    expect(st.files['AGENTS.md']).toBeDefined();
  });

  it('is idempotent when files already match the current template', async () => {
    await ensurePlanningAssistantMarkdownFiles(dir, 'N', '/tmp/root', { multiRepoGuide: true });
    const first = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'N', '/tmp/root', { multiRepoGuide: true });
    const second = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('upgrades legacy unwrapped templates to wrapped managed blocks', async () => {
    const legacy = stripFluxPlanningTemplateVersionComment(
      planningAssistantMarkdown('Legacy', '/other/root', true),
    );
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), legacy, 'utf8');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), legacy, 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'Legacy', '/other/root', { multiRepoGuide: true });
    const upgraded = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(upgraded).toContain(FLUX_PLANNING_INSTRUCTIONS_BEGIN);
    expect(upgraded).toContain('flux project info --json');
  });

  it('preserves manual instruction files that are not Flux templates', async () => {
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Custom only\n\nhello', 'utf8');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Custom only\n\nhello', 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'N', '/tmp/r', { multiRepoGuide: true });
    expect(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain('Custom only');
  });

  it('preserves user prefix outside managed marker blocks when upgrading managed inner', async () => {
    const innerOld = '<!-- flux-planning-template 0 -->\n\n# Planning workspace — X\n\nold `/p`';
    const wrappedOld = `# My notes\n\n${wrapPlanningInstructionsManagedBlock(innerOld).trimEnd()}\n`;
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), wrappedOld, 'utf8');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), wrappedOld, 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'Up', '/tmp/u', { multiRepoGuide: true });
    const next = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(next).toContain('# My notes');
    expect(next).toContain(FLUX_PLANNING_INSTRUCTIONS_BEGIN);
    expect(next).toContain(`flux-planning-template ${PLANNING_ASSISTANT_TEMPLATE_VERSION}`);
  });

  it('upgrades only the Flux template file when CLAUDE is manual and AGENTS is legacy', async () => {
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'manual-only', 'utf8');
    const legacyAgents = stripFluxPlanningTemplateVersionComment(
      planningAssistantMarkdown('Split', '/tmp/s', true),
    );
    await fs.writeFile(path.join(dir, 'AGENTS.md'), legacyAgents, 'utf8');
    await ensurePlanningAssistantMarkdownFiles(dir, 'Split', '/tmp/s', { multiRepoGuide: true });
    expect(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('manual-only');
    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(FLUX_PLANNING_INSTRUCTIONS_BEGIN);
  });
});
