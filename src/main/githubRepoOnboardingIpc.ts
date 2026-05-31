import { ipcMain } from 'electron';
import type {
  GithubCloneDestinationCheckInput,
  GithubRepoCloneInput,
  GithubRepoCreateInput,
  GithubRepoListInput,
} from '../githubRepoOnboarding/types';
import { githubCliRepoService, type GithubCliRepoService } from './githubCliRepoService';

function parseListInput(raw: unknown): GithubRepoListInput {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    ...(typeof o.owner === 'string' ? { owner: o.owner } : {}),
    ...(typeof o.limit === 'number' ? { limit: o.limit } : {}),
  };
}

function parseCreateInput(raw: unknown): GithubRepoCreateInput | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'createRepo requires { name, visibility }' };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.trim() === '') {
    return { error: 'createRepo requires a non-empty name' };
  }
  const visibility = o.visibility;
  if (visibility !== 'public' && visibility !== 'private' && visibility !== 'internal') {
    return { error: 'createRepo requires visibility public, private, or internal' };
  }
  return {
    name: o.name,
    ...(typeof o.owner === 'string' ? { owner: o.owner } : {}),
    visibility,
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
  };
}

function parseCloneInput(raw: unknown): GithubRepoCloneInput | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'cloneRepo requires { repo, destination }' };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.repo !== 'string' || o.repo.trim() === '') {
    return { error: 'cloneRepo requires repo (owner/name)' };
  }
  if (typeof o.destination !== 'string' || o.destination.trim() === '') {
    return { error: 'cloneRepo requires destination' };
  }
  return { repo: o.repo, destination: o.destination };
}

function parseDestinationCheckInput(
  raw: unknown,
): GithubCloneDestinationCheckInput | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'checkCloneDestination requires { destination }' };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.destination !== 'string' || o.destination.trim() === '') {
    return { error: 'checkCloneDestination requires destination' };
  }
  return { destination: o.destination };
}

export function registerGithubRepoOnboardingIpc(
  service: GithubCliRepoService = githubCliRepoService,
): void {
  ipcMain.handle('githubRepoOnboarding:checkPrerequisites', async () =>
    service.checkPrerequisites(),
  );

  ipcMain.handle('githubRepoOnboarding:listRepos', async (_e, payload: unknown) =>
    service.listRepos(parseListInput(payload)),
  );

  ipcMain.handle('githubRepoOnboarding:createRepo', async (_e, payload: unknown) => {
    const parsed = parseCreateInput(payload);
    if ('error' in parsed) return { ok: false, code: 'INVALID_INPUT', message: parsed.error };
    return service.createRepo(parsed);
  });

  ipcMain.handle('githubRepoOnboarding:cloneRepo', async (_e, payload: unknown) => {
    const parsed = parseCloneInput(payload);
    if ('error' in parsed) return { ok: false, code: 'INVALID_INPUT', message: parsed.error };
    return service.cloneRepo(parsed);
  });

  ipcMain.handle('githubRepoOnboarding:checkCloneDestination', async (_e, payload: unknown) => {
    const parsed = parseDestinationCheckInput(payload);
    if ('error' in parsed) return { ok: false, code: 'INVALID_INPUT', message: parsed.error };
    return service.checkCloneDestination(parsed.destination);
  });
}
