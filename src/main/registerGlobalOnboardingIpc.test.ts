import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateStore } from './AppStateStore';
import { GLOBAL_ONBOARDING_STATE_VERSION } from '../globalOnboarding/types';

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: () => '/unused',
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn);
    },
  },
}));

const probeAllGlobalOnboardingClis = vi.fn(async () => [
  { command: 'claude' as const, status: 'found' as const, path: '/bin/claude' },
  { command: 'agent' as const, status: 'missing' as const },
  { command: 'codex' as const, status: 'missing' as const },
  { command: 'gh' as const, status: 'found' as const, path: '/bin/gh' },
]);

vi.mock('./globalOnboardingCliProbe', () => ({
  probeAllGlobalOnboardingClis: (...args: unknown[]) => probeAllGlobalOnboardingClis(...args),
}));

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return (await handler(...args)) as T;
}

describe('registerGlobalOnboardingIpc', () => {
  let tmp: string;
  let filePath: string;
  let store: AppStateStore;
  const originalForce = process.env.FLUXX_FORCE_GLOBAL_ONBOARDING;

  beforeEach(async () => {
    ipcHandlers.clear();
    probeAllGlobalOnboardingClis.mockClear();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-global-onboarding-ipc-'));
    filePath = path.join(tmp, 'app-state.json');
    store = new AppStateStore({ filePath });
    await store.init();
    const { registerGlobalOnboardingIpc } = await import('./registerGlobalOnboardingIpc');
    registerGlobalOnboardingIpc(store);
  });

  afterEach(async () => {
    if (originalForce === undefined) {
      delete process.env.FLUXX_FORCE_GLOBAL_ONBOARDING;
    } else {
      process.env.FLUXX_FORCE_GLOBAL_ONBOARDING = originalForce;
    }
    await fs.rm(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it('registers renderer-facing IPC channels', () => {
    expect(ipcHandlers.has('globalOnboarding:getState')).toBe(true);
    expect(ipcHandlers.has('globalOnboarding:probeClis')).toBe(true);
    expect(ipcHandlers.has('globalOnboarding:skip')).toBe(true);
    expect(ipcHandlers.has('globalOnboarding:complete')).toBe(true);
    expect(ipcHandlers.has('globalOnboarding:selectAgent')).toBe(true);
  });

  it('getState returns resolved onboarding snapshot', async () => {
    await store.set({
      globalOnboarding: {
        version: GLOBAL_ONBOARDING_STATE_VERSION,
        status: 'completed',
        selectedAgent: 'cursor',
      },
    });
    await expect(invokeIpc('globalOnboarding:getState')).resolves.toEqual({
      status: 'completed',
      forced: false,
      selectedAgent: 'cursor',
    });
  });

  it('getState honors FLUXX_FORCE_GLOBAL_ONBOARDING without mutating disk', async () => {
    await store.set({
      globalOnboarding: {
        version: GLOBAL_ONBOARDING_STATE_VERSION,
        status: 'skipped',
      },
    });
    process.env.FLUXX_FORCE_GLOBAL_ONBOARDING = '1';
    await expect(invokeIpc('globalOnboarding:getState')).resolves.toEqual({
      status: 'pending',
      forced: true,
    });
    expect(store.get().globalOnboarding?.status).toBe('skipped');
  });

  it('probeClis returns stable CLI probe payloads', async () => {
    const results = await invokeIpc<
      Array<{ command: string; status: string; path?: string }>
    >('globalOnboarding:probeClis');
    expect(probeAllGlobalOnboardingClis).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { command: 'claude', status: 'found', path: '/bin/claude' },
      { command: 'agent', status: 'missing' },
      { command: 'codex', status: 'missing' },
      { command: 'gh', status: 'found', path: '/bin/gh' },
    ]);
  });

  it('skip and complete persist status to app state', async () => {
    await expect(invokeIpc('globalOnboarding:skip')).resolves.toEqual({ ok: true });
    expect(store.get().globalOnboarding?.status).toBe('skipped');
    expect(store.get().globalOnboarding?.updatedAt).toMatch(/^\d{4}-/);

    await expect(invokeIpc('globalOnboarding:complete', null, false)).resolves.toEqual({
      ok: true,
    });
    expect(store.get().globalOnboarding?.status).toBe('completed');
    expect(store.get().globalOnboarding?.githubFeaturesEnabled).toBe(false);
  });

  it('selectAgent rejects invalid agents and syncs valid selections', async () => {
    await expect(
      invokeIpc('globalOnboarding:selectAgent', null, 'not-an-agent'),
    ).resolves.toEqual({ error: 'INVALID_AGENT' });

    const syncProjectAgents = vi.fn().mockResolvedValue({ ok: true });
    ipcHandlers.clear();
    const { registerGlobalOnboardingIpc } = await import('./registerGlobalOnboardingIpc');
    registerGlobalOnboardingIpc(store, syncProjectAgents);

    await expect(
      invokeIpc('globalOnboarding:selectAgent', null, 'claude-code'),
    ).resolves.toEqual({ ok: true });
    expect(store.get().globalOnboarding?.selectedAgent).toBe('claude-code');
    expect(syncProjectAgents).toHaveBeenCalledWith('claude-code');
  });
});
