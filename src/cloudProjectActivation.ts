import path from 'node:path';
import type { CloudProjectLocalBinding, CloudSharedRepo } from './types';
import {
  migrateLegacyCloudBinding,
  primaryMachineBinding,
} from './cloudLocalBindingMigration';
import { canonicalCloudProjectDir } from './projectDirPaths';
import { resolvePrimaryRepoIdFromList } from './repoIdentity';

/** Canonical `~/.fluxx/projects/<cloudProjectId>/` workspace for shell-only opens. */
export function cloudMaterializationDir(
  fluxxBaseDir: string,
  cloudProjectId: string,
): string {
  return path.resolve(canonicalCloudProjectDir(fluxxBaseDir, cloudProjectId));
}

export function isCloudShellRootPath(
  fluxxBaseDir: string,
  cloudProjectId: string,
  rootPath: string,
): boolean {
  return path.resolve(rootPath) === cloudMaterializationDir(fluxxBaseDir, cloudProjectId);
}

/**
 * True when the team project lists shared repos but this machine has no bound clone
 * for the primary shared repo (picker should offer per-repo bind, not a generic folder).
 */
export function cloudProjectNeedsRepoBinding(
  projectId: string,
  sharedRepos: CloudSharedRepo[] | undefined,
  binding: CloudProjectLocalBinding | null | undefined,
): boolean {
  if (!sharedRepos || sharedRepos.length === 0) return false;
  if (!binding) return true;
  const migrated = migrateLegacyCloudBinding(projectId, binding);
  const rb = migrated.repoBindings ?? {};
  const sharedPrimaryId = resolvePrimaryRepoIdFromList(sharedRepos);
  if (!sharedPrimaryId) return true;
  const machine = rb[sharedPrimaryId];
  return !machine?.rootPath;
}

/** Whether opening should use the generic legacy folder picker (no shared `repos` metadata). */
export function cloudProjectUsesLegacyFolderPicker(
  sharedRepos: CloudSharedRepo[] | undefined,
): boolean {
  return !sharedRepos || sharedRepos.length === 0;
}

/**
 * Minimal binding for a cloud project opened without any local clone yet.
 */
export function shellCloudBinding(lastOpenedAt: string): CloudProjectLocalBinding {
  return { lastOpenedAt };
}

export function hasCloudRepoMachineBinding(
  projectId: string,
  binding: CloudProjectLocalBinding,
  sharedRepos?: readonly CloudSharedRepo[],
): boolean {
  return primaryMachineBinding(projectId, binding, sharedRepos) != null;
}
