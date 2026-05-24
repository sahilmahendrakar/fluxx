import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir;
      throw new Error(`unexpected getPath: ${name}`);
    },
  },
}));

describe('LocalBindingStore persistTerminalsWithTmux', () => {
  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-bindings-'));
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it('set() preserves persistTerminalsWithTmux across cloud re-activation', async () => {
    const { LocalBindingStore } = await import('./LocalBindingStore');
    const store = new LocalBindingStore();
    const projectId = 'cloud-proj-1';
    const rootPath = path.join(userDataDir, 'clone');

    await store.set(projectId, rootPath);
    await store.setPrefs(projectId, { persistTerminalsWithTmux: true });
    expect(store.getPrefs(projectId).persistTerminalsWithTmux).toBe(true);

    await store.set(projectId, rootPath);
    expect(store.getPrefs(projectId).persistTerminalsWithTmux).toBe(true);

    const raw = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'localBindings.json'), 'utf8'),
    ) as { bindings: Record<string, { persistTerminalsWithTmux?: boolean }> };
    expect(raw.bindings[projectId]?.persistTerminalsWithTmux).toBe(true);
  });

  it('setRepoMachineBinding preserves persistTerminalsWithTmux', async () => {
    const { LocalBindingStore } = await import('./LocalBindingStore');
    const store = new LocalBindingStore();
    const projectId = 'cloud-proj-2';
    const rootPath = path.join(userDataDir, 'repo-a');

    await store.set(projectId, rootPath);
    await store.setPrefs(projectId, { persistTerminalsWithTmux: true });

    const binding = await store.get(projectId);
    const repoId = binding?.primaryRepoId ?? Object.keys(binding?.repoBindings ?? {})[0];
    expect(repoId).toBeTruthy();

    await store.setRepoMachineBinding(projectId, repoId!, rootPath);
    expect(store.getPrefs(projectId).persistTerminalsWithTmux).toBe(true);
  });
});
