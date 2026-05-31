import type { FluxAutomationInvokeResponse } from './AutomationHttpServer';
import { githubCliRepoService } from './githubCliRepoService';
import type {
  GithubCloneDestinationCheckInput,
  GithubRepoCloneInput,
  GithubRepoCreateInput,
  GithubRepoListInput,
  GithubRepoOnboardingAutomationOp,
} from '../githubRepoOnboarding/types';

export async function runGithubRepoOnboardingAutomation(
  op: GithubRepoOnboardingAutomationOp,
  payload: unknown,
): Promise<FluxAutomationInvokeResponse> {
  switch (op) {
    case 'repo.github.prerequisites': {
      const result = await githubCliRepoService.checkPrerequisites();
      if (!result.ok) {
        return { ok: false, error: result.message, code: result.code };
      }
      return { ok: true, data: result.prerequisites };
    }
    case 'repo.github.list': {
      const input = (payload ?? {}) as GithubRepoListInput;
      const result = await githubCliRepoService.listRepos(input);
      if (!result.ok) {
        return { ok: false, error: result.message, code: result.code };
      }
      return { ok: true, data: { repos: result.repos } };
    }
    case 'repo.github.create': {
      const input = payload as GithubRepoCreateInput | null;
      if (!input || typeof input.name !== 'string' || !input.visibility) {
        return {
          ok: false,
          error: 'repo.github.create requires { name, visibility, owner?, description? }',
        };
      }
      const result = await githubCliRepoService.createRepo(input);
      if (!result.ok) {
        return { ok: false, error: result.message, code: result.code };
      }
      return { ok: true, data: result };
    }
    case 'repo.github.clone': {
      const input = payload as GithubRepoCloneInput | null;
      if (!input || typeof input.repo !== 'string' || typeof input.destination !== 'string') {
        return {
          ok: false,
          error: 'repo.github.clone requires { repo, destination }',
        };
      }
      const result = await githubCliRepoService.cloneRepo(input);
      if (!result.ok) {
        return { ok: false, error: result.message, code: result.code };
      }
      return { ok: true, data: result };
    }
    case 'repo.github.checkCloneDestination': {
      const input = payload as GithubCloneDestinationCheckInput | null;
      if (!input || typeof input.destination !== 'string') {
        return {
          ok: false,
          error: 'repo.github.checkCloneDestination requires { destination }',
        };
      }
      const result = await githubCliRepoService.checkCloneDestination(input.destination);
      if (!result.ok) {
        return { ok: false, error: result.message, code: result.code };
      }
      return { ok: true, data: { available: true } };
    }
    default:
      return { ok: false, error: `Unknown GitHub repo onboarding op: ${String(op)}` };
  }
}

export function isGithubRepoOnboardingAutomationOp(
  op: string,
): op is GithubRepoOnboardingAutomationOp {
  return (
    op === 'repo.github.prerequisites' ||
    op === 'repo.github.list' ||
    op === 'repo.github.create' ||
    op === 'repo.github.clone' ||
    op === 'repo.github.checkCloneDestination'
  );
}
