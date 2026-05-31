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

  it('persists skip and complete to disk', async () => {
    const store = new AppStateStore({ filePath });
    await store.init();

    await store.set({
      globalOnboarding: {
        version: 1,
        status: 'skipped',
        updatedAt: '2026-05-30T12:00:00.000Z',
      },
    });
    const skippedRaw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      globalOnboarding?: { status: string };
    };
    expect(skippedRaw.globalOnboarding?.status).toBe('skipped');

    const reloaded = new AppStateStore({ filePath });
    await reloaded.init();
    expect(reloaded.get().globalOnboarding?.status).toBe('skipped');

    await reloaded.set({
      globalOnboarding: {
        version: 1,
        status: 'completed',
        selectedAgent: 'cursor',
        updatedAt: '2026-05-30T12:01:00.000Z',
      },
    });
    const completedRaw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      globalOnboarding?: { status: string; selectedAgent?: string };
    };
    expect(completedRaw.globalOnboarding?.status).toBe('completed');
    expect(completedRaw.globalOnboarding?.selectedAgent).toBe('cursor');
  });
});
