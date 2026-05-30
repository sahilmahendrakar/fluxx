import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppStateStore } from './AppStateStore';

describe('AppStateStore global onboarding migration', () => {
  let tmp: string;
  let filePath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-appstate-onboarding-'));
    filePath = path.join(tmp, 'app-state.json');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('defaults fresh installs to pending onboarding', async () => {
    const store = new AppStateStore({ filePath });
    await store.init();
    expect(store.get().globalOnboarding?.status).toBe('pending');
  });

  it('migrates legacy installs with activity to skipped', async () => {
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        lastOpenedProjectDir: '/data/p/a',
        activeProjectKey: null,
        projectTabs: {},
        projectLastOpenedAt: {},
      })}\n`,
      'utf8',
    );
    const store = new AppStateStore({ filePath });
    await store.init();
    expect(store.get().globalOnboarding?.status).toBe('skipped');
  });
});
