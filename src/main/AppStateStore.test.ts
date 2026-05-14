import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppStateStore } from './AppStateStore';

describe('AppStateStore.clearProjectFluxState', () => {
  let tmp: string;
  let filePath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-appstate-'));
    filePath = path.join(tmp, 'app-state.json');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('removes tab state for one project and preserves active navigation when that project was not active', async () => {
    const store = new AppStateStore({ filePath });
    await store.set({
      activeProjectKey: { kind: 'local', id: 'a' },
      lastOpenedProjectDir: '/data/p/a',
      projectTabs: {
        'local:a': { openTaskIds: ['1'], activeTaskId: null },
        'local:b': { openTaskIds: ['2'], activeTaskId: '2' },
      },
    });
    await store.clearProjectFluxState({ kind: 'local', id: 'b' }, { clearActiveNavigation: false });
    const g = store.get();
    expect(g.activeProjectKey).toEqual({ kind: 'local', id: 'a' });
    expect(g.lastOpenedProjectDir).toBe('/data/p/a');
    expect(g.projectTabs['local:b']).toBeUndefined();
    expect(g.projectTabs['local:a']?.openTaskIds).toEqual(['1']);
  });

  it('clears active navigation when the removed project was active', async () => {
    const store = new AppStateStore({ filePath });
    await store.set({
      activeProjectKey: { kind: 'cloud', id: 'c1' },
      lastOpenedProjectDir: '/flux/p/c1',
      projectTabs: {
        'cloud:c1': { openTaskIds: [], activeTaskId: null },
      },
    });
    await store.clearProjectFluxState({ kind: 'cloud', id: 'c1' }, { clearActiveNavigation: true });
    const g = store.get();
    expect(g.activeProjectKey).toBeNull();
    expect(g.lastOpenedProjectDir).toBeNull();
    expect(g.projectTabs['cloud:c1']).toBeUndefined();
  });
});
