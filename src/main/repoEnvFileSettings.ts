import type {
  RepoConfig,
  RepoEnvFileDetectionResult,
  RepoEnvFileEnablement,
  RepoEnvFileName,
  RepoEnvFileSourcesConfig,
} from '../types';
import { migrateLegacyCloudBinding } from '../cloudLocalBindingMigration';
import {
  detectAndBuildEnvFilesConfig,
  detectRepoRootEnvFiles,
  envFileSourcesConfigFromDetection,
  hasLegacyPastedRepoEnv,
  mergeRepoEnvFileSources,
} from '../repoEnvFiles';
import type { LocalBindingStore } from './LocalBindingStore';
import type { ProjectStore } from './ProjectStore';

export function bindingEnvFilesForRepo(
  bindingStore: LocalBindingStore,
  cloudProjectId: string,
  repoId: string,
): RepoEnvFileSourcesConfig | undefined {
  const binding = bindingStore.get(cloudProjectId);
  if (!binding) return undefined;
  const migrated = migrateLegacyCloudBinding(cloudProjectId, binding);
  return migrated.repoBindings?.[repoId]?.envFiles;
}

export async function detectRepoEnvFilesForSettings(
  repo: Pick<RepoConfig, 'rootPath' | 'env' | 'envFiles'>,
  bindingEnvFiles?: RepoEnvFileSourcesConfig,
): Promise<RepoEnvFileDetectionResult> {
  const envFiles = mergeRepoEnvFileSources(repo.envFiles, bindingEnvFiles);
  return detectRepoRootEnvFiles(repo.rootPath, {
    envFiles,
    legacyPastedEnvActive: hasLegacyPastedRepoEnv(repo),
  });
}

export async function persistRepoEnvFilesForLocalProject(params: {
  projectStore: ProjectStore;
  projectDir: string;
  repoId: string;
  envFiles: RepoEnvFileSourcesConfig;
}): Promise<RepoConfig[]> {
  return params.projectStore.updateRepoByIdAt(
    params.projectDir,
    params.repoId,
    { envFiles: params.envFiles },
  );
}

export async function persistRepoEnvFilesForCloudBinding(params: {
  bindingStore: LocalBindingStore;
  cloudProjectId: string;
  repoId: string;
  envFiles: RepoEnvFileSourcesConfig;
}): Promise<void> {
  await params.bindingStore.updateRepoMachineEnvFiles(
    params.cloudProjectId,
    params.repoId,
    params.envFiles,
  );
}

export async function detectAndPersistRepoEnvFiles(params: {
  projectKind: 'local' | 'cloud';
  projectStore: ProjectStore;
  bindingStore: LocalBindingStore;
  projectDir: string;
  cloudProjectId?: string;
  repoId: string;
  repo: Pick<RepoConfig, 'rootPath' | 'env' | 'envFiles'>;
}): Promise<{
  detection: RepoEnvFileDetectionResult;
  envFiles: RepoEnvFileSourcesConfig;
  repos: RepoConfig[];
}> {
  const bindingEnvFiles =
    params.projectKind === 'cloud' && params.cloudProjectId
      ? bindingEnvFilesForRepo(params.bindingStore, params.cloudProjectId, params.repoId)
      : undefined;
  const { detection, envFiles } = await detectAndBuildEnvFilesConfig(
    params.repo,
    bindingEnvFiles,
  );

  if (params.projectKind === 'cloud' && params.cloudProjectId) {
    await persistRepoEnvFilesForCloudBinding({
      bindingStore: params.bindingStore,
      cloudProjectId: params.cloudProjectId,
      repoId: params.repoId,
      envFiles,
    });
    const repos = await params.projectStore.getReposAt(params.projectDir);
    return { detection, envFiles, repos };
  }

  const repos = await persistRepoEnvFilesForLocalProject({
    projectStore: params.projectStore,
    projectDir: params.projectDir,
    repoId: params.repoId,
    envFiles,
  });
  return { detection, envFiles, repos };
}

export function envFilesWithEnablement(
  detection: RepoEnvFileDetectionResult,
  fileName: RepoEnvFileName,
  enablement: RepoEnvFileEnablement,
): RepoEnvFileSourcesConfig {
  return envFileSourcesConfigFromDetection({
    ...detection,
    files: detection.files.map((f) => ({
      ...f,
      enablement: f.fileName === fileName ? enablement : f.enablement,
    })),
  });
}
