import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? '/tmp/flux-test-userdata' : '/tmp'),
  },
}));

import { LocalBindingStore } from './LocalBindingStore';
import { ProjectStore } from './ProjectStore';
import {
  detectAndPersistRepoEnvFiles,
  envFilesWithEnablement,
} from './repoEnvFileSettings';
import { detectRepoRootEnvFiles } from '../repoEnvFiles';
import { stableLocalProjectIdForRoot } from './projectDirLayout';

describe('repoEnvFileSettings', () => {
  let tmp: string;
  let bindingsPath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-env-settings-'));
    const bindingsDir = path.join(tmp, 'bindings');
    await fs.mkdir(bindingsDir, { recursive: true });
    bindingsPath = path.join(bindingsDir, 'localBindings.json');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function touchGitRepo(root: string): Promise<void> {
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
  }

  it('detectAndPersistRepoEnvFiles stores env metadata in cloud localBindings only', async () => {
    const cloneRoot = path.join(tmp, 'clone');
    await fs.mkdir(cloneRoot, { recursive: true });
    await touchGitRepo(cloneRoot);
    await fs.writeFile(path.join(cloneRoot, '.env'), 'X=1\n', 'utf8');
    await fs.writeFile(path.join(cloneRoot, '.env.local'), 'Y=2\n', 'utf8');

    const bindingStore = new LocalBindingStore();
    (bindingStore as unknown as { filePath: string }).filePath = bindingsPath;
    await bindingStore.init();
    await bindingStore.setRepoMachineBinding('cloud-1', 'repo-a', cloneRoot);

    const projectStore = {
      getReposAt: vi.fn(async () => [
        { id: 'repo-a', rootPath: cloneRoot, baseBranch: 'main' },
      ]),
      updateRepoByIdAt: vi.fn(),
    } as unknown as ProjectStore;

    const { detection } = await detectAndPersistRepoEnvFiles({
      projectKind: 'cloud',
      projectStore,
      bindingStore,
      projectDir: path.join(tmp, 'cloud-project'),
      cloudProjectId: 'cloud-1',
      repoId: 'repo-a',
      repo: { rootPath: cloneRoot },
    });

    expect(detection.files.filter((f) => f.presence === 'found').map((f) => f.fileName)).toEqual([
      '.env',
      '.env.local',
    ]);
    const saved = bindingStore.get('cloud-1');
    expect(saved?.repoBindings?.['repo-a']?.envFiles?.sources).toEqual(
      expect.arrayContaining([
        { fileName: '.env', enablement: 'enabled' },
        { fileName: '.env.local', enablement: 'enabled' },
      ]),
    );
    expect(JSON.stringify(saved)).not.toMatch(/X=1|Y=2/);
    expect(projectStore.updateRepoByIdAt).not.toHaveBeenCalled();
  });

  it('detectAndPersistRepoEnvFiles writes metadata to local config.json without secret bodies', async () => {
    const rootA = path.join(tmp, 'primary');
    const rootB = path.join(tmp, 'secondary');
    const projectId = stableLocalProjectIdForRoot(rootA);
    const projectDir = path.join(tmp, 'fluxx', 'projects', projectId);
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await touchGitRepo(rootA);
    await touchGitRepo(rootB);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'config.json'),
      `${JSON.stringify(
        {
          id: projectId,
          name: 'Local QA',
          rootPath: rootA,
          addedAt: '2026-05-30T00:00:00.000Z',
          planningAgent: 'claude-code',
          defaultTaskAgent: 'claude-code',
          autoStartSessionOnInProgress: false,
          autoRespondToTrustPrompts: false,
          autoStartWhenUnblocked: false,
          autoCleanupWorkspaceWhenDone: false,
          autoMarkDoneWhenPrMerged: false,
          autoMoveToReviewWhenPrOpen: false,
          validationEnabled: false,
          repos: [{ rootPath: rootA, baseBranch: 'main' }],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await fs.writeFile(path.join(rootB, '.env'), 'LOCAL_SECRET=1\n', 'utf8');
    await fs.writeFile(path.join(rootB, '.env.local'), 'LOCAL_ONLY=2\n', 'utf8');

    const fluxxHome = path.join(tmp, 'fluxx');
    const store = new ProjectStore(fluxxHome);
    await store.init(projectDir);
    const repos = await store.addRepoAt(projectDir, rootB);
    const added = repos.find((r) => path.resolve(r.rootPath) === path.resolve(rootB));
    if (!added?.id) throw new Error('expected added repo id');

    const bindingStore = new LocalBindingStore();
    (bindingStore as unknown as { filePath: string }).filePath = bindingsPath;
    await bindingStore.init();

    const { envFiles } = await detectAndPersistRepoEnvFiles({
      projectKind: 'local',
      projectStore: store,
      bindingStore,
      projectDir,
      repoId: added.id,
      repo: { rootPath: rootB },
    });

    expect(envFiles.sources).toEqual(
      expect.arrayContaining([
        { fileName: '.env', enablement: 'enabled' },
        { fileName: '.env.local', enablement: 'enabled' },
      ]),
    );

    const configRaw = await fs.readFile(path.join(projectDir, 'config.json'), 'utf8');
    expect(configRaw).not.toMatch(/LOCAL_SECRET=1|LOCAL_ONLY=2/);
    expect(configRaw).toContain('"envFiles"');

    const bindingsRaw = await fs.readFile(bindingsPath, 'utf8').catch(() => '');
    expect(bindingsRaw).not.toMatch(/LOCAL_SECRET=1|LOCAL_ONLY=2/);
    expect(bindingStore.get(projectId)).toBeNull();
  });

  it('envFilesWithEnablement updates one file without persisting secret bodies', async () => {
    const cloneRoot = path.join(tmp, 'clone-toggle');
    await fs.mkdir(cloneRoot, { recursive: true });
    await touchGitRepo(cloneRoot);
    await fs.writeFile(path.join(cloneRoot, '.env'), 'SECRET=1\n', 'utf8');
    await fs.writeFile(path.join(cloneRoot, '.env.local'), 'LOCAL=2\n', 'utf8');

    const detection = await detectRepoRootEnvFiles(cloneRoot);
    const updated = envFilesWithEnablement(detection, '.env.local', 'disabled');

    expect(updated.sources).toEqual(
      expect.arrayContaining([
        { fileName: '.env', enablement: 'enabled' },
        { fileName: '.env.local', enablement: 'disabled' },
      ]),
    );
    expect(JSON.stringify(updated)).not.toMatch(/SECRET=1|LOCAL=2/);
  });
});
