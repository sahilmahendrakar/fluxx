import type { CloudProjectCreateRepoInput } from '../../cloudProjectCreate';
import type { ProjectCreateRepoInput } from '../../projectCreate';
import { repoRootBasename } from '../../repoIdentity';

export type WizardRepoRow = ProjectCreateRepoInput & { key: string };

export function suggestProjectNameFromRepo(rootPath: string): string {
  return repoRootBasename(rootPath) || '';
}

export function wizardReposToCreateInput(
  repos: WizardRepoRow[],
): ProjectCreateRepoInput[] {
  return repos.map(({ rootPath, name, baseBranch }) => ({
    rootPath,
    ...(name ? { name } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  }));
}

export function wizardReposToCloudCreateInput(
  repos: WizardRepoRow[],
): CloudProjectCreateRepoInput[] {
  return wizardReposToCreateInput(repos);
}

export function resolvePrimaryRootPath(
  repos: WizardRepoRow[],
  primaryRootPath: string | undefined,
): string | undefined {
  if (repos.length === 0) return undefined;
  if (repos.length === 1) return repos[0].rootPath;
  return primaryRootPath ?? repos[0]?.rootPath;
}
