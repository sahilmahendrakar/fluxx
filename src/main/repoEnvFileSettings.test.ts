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
import type { ProjectStore } from './ProjectStore';
import { detectAndPersistRepoEnvFiles } from './repoEnvFileSettings';

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
});
