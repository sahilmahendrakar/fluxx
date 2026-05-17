import path from 'node:path';
import type {
  CloudProjectLocalBinding,
  CloudSharedRepo,
  RepoConfig,
} from './types';
import {
  migrateLegacyCloudBinding,
  primaryRootPathFromCloudBinding,
} from './cloudLocalBindingMigration';

/**
 * Builds `repos[]` + primary root for `~/.fluxx/.../config.json` from Firestore
 * shared repo rows and the local machine binding map (multi-repo2 cloud).
 */
export function repoConfigsFromCloudSharedAndBinding(
  cloudProjectId: string,
  sharedRepos: CloudSharedRepo[],
  binding: CloudProjectLocalBinding,
): { primaryRootPath: string; repos: RepoConfig[] } | null {
  const migrated = migrateLegacyCloudBinding(cloudProjectId, binding);
  const rb = migrated.repoBindings ?? {};
  const primaryRootPath = primaryRootPathFromCloudBinding(
    cloudProjectId,
    migrated,
    sharedRepos,
  );
  if (!primaryRootPath) return null;

  const primaryResolved = path.resolve(primaryRootPath);

  if (sharedRepos.length === 0) {
    const keys = Object.keys(rb);
    if (keys.length === 0) return null;
    const singleId =
      migrated.primaryRepoId ?? (keys.length === 1 ? keys[0] : keys.sort()[0]);
    const entry = rb[singleId];
    if (!entry?.rootPath) return null;
    return {
      primaryRootPath,
      repos: [
        {
          id: singleId,
          name: path.basename(path.resolve(entry.rootPath)),
          rootPath: path.resolve(entry.rootPath),
          baseBranch: 'main',
        },
      ],
    };
  }

  const withBindings: RepoConfig[] = [];
  for (const sr of sharedRepos) {
    const machine = rb[sr.id];
    if (!machine?.rootPath) continue;
    withBindings.push({
      id: sr.id,
      name: sr.name,
      rootPath: path.resolve(machine.rootPath),
      baseBranch: sr.baseBranch,
    });
  }
  if (withBindings.length === 0) {
    return null;
  }

  let primaryId = migrated.primaryRepoId;
  if (!primaryId) {
    const hit = withBindings.find((r) => r.rootPath === primaryResolved);
    primaryId = hit?.id;
  }
  if (!primaryId && withBindings.length === 1) {
    primaryId = withBindings[0].id;
  }
  if (!primaryId) {
    primaryId = withBindings[0].id;
  }

  const repos = [...withBindings].sort((a, b) => {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
    return 0;
  });

  return { primaryRootPath, repos };
}
