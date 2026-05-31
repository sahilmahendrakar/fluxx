import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGithubRepoOnboardingIpc } from './githubRepoOnboardingIpc';
import type { GithubCliRepoService } from './githubCliRepoService';

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn);
    },
  },
}));

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return (await handler({}, ...args)) as T;
}

describe('registerGithubRepoOnboardingIpc', () => {
  const checkPrerequisites = vi.fn();
  const listRepos = vi.fn();
  const createRepo = vi.fn();
  const cloneRepo = vi.fn();
  const checkCloneDestination = vi.fn();

  const service = {
    checkPrerequisites,
    listRepos,
    createRepo,
    cloneRepo,
    checkCloneDestination,
  } as unknown as GithubCliRepoService;

  beforeEach(() => {
    ipcHandlers.clear();
    vi.clearAllMocks();
    registerGithubRepoOnboardingIpc(service);
  });

  it('registers github repo onboarding channels', () => {
    expect(ipcHandlers.has('githubRepoOnboarding:checkPrerequisites')).toBe(true);
    expect(ipcHandlers.has('githubRepoOnboarding:listRepos')).toBe(true);
    expect(ipcHandlers.has('githubRepoOnboarding:createRepo')).toBe(true);
    expect(ipcHandlers.has('githubRepoOnboarding:cloneRepo')).toBe(true);
    expect(ipcHandlers.has('githubRepoOnboarding:checkCloneDestination')).toBe(true);
  });

  it('delegates createRepo to the service', async () => {
    createRepo.mockResolvedValue({ ok: true, nameWithOwner: 'acme/r' });
    const result = await invokeIpc('githubRepoOnboarding:createRepo', {
      name: 'r',
      owner: 'acme',
      visibility: 'private',
    });
    expect(createRepo).toHaveBeenCalledWith({
      name: 'r',
      owner: 'acme',
      visibility: 'private',
    });
    expect(result).toEqual({ ok: true, nameWithOwner: 'acme/r' });
  });

  it('returns INVALID_INPUT for malformed create payloads', async () => {
    const result = await invokeIpc<{ ok: false; code: string; message: string }>(
      'githubRepoOnboarding:createRepo',
      { name: 'r' },
    );
    expect(result.code).toBe('INVALID_INPUT');
    expect(createRepo).not.toHaveBeenCalled();
  });
});
