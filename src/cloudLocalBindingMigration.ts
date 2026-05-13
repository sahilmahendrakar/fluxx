import type {
  CloudProjectLocalBinding,
  CloudRepoMachineBinding,
  CloudSharedRepo,
} from './types';
import { deriveStablePrimaryRepoIdForProject } from './repoIdentity';

/**
 * Parses `repoBindings` objects loaded from `localBindings.json`.
 */
export function parseRepoBindingsRecord(
  raw: unknown,
): Record<string, CloudRepoMachineBinding> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, CloudRepoMachineBinding> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    if (typeof v.rootPath !== 'string' || typeof v.lastOpenedAt !== 'string') continue;
    out[key] = { rootPath: v.rootPath, lastOpenedAt: v.lastOpenedAt };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Ensures legacy top-level `rootPath` is represented in `repoBindings` under the
 * deterministic primary id. Idempotent when `repoBindings` is already populated.
 */
export function migrateLegacyCloudBinding(
  projectId: string,
  binding: CloudProjectLocalBinding,
): CloudProjectLocalBinding {
  const rb =
    binding.repoBindings && Object.keys(binding.repoBindings).length > 0
      ? binding.repoBindings
      : undefined;
  if (rb) {
    let primaryRepoId = binding.primaryRepoId;
    if (!primaryRepoId && Object.keys(rb).length === 1) {
      primaryRepoId = Object.keys(rb)[0];
    }
    if (primaryRepoId !== binding.primaryRepoId) {
      return { ...binding, primaryRepoId };
    }
    return binding;
  }
  if (typeof binding.rootPath === 'string' && binding.rootPath.length > 0) {
    const id = deriveStablePrimaryRepoIdForProject({
      projectId,
      rootPath: binding.rootPath,
    });
    return {
      ...binding,
      repoBindings: {
        [id]: {
          rootPath: binding.rootPath,
          lastOpenedAt: binding.lastOpenedAt,
        },
      },
      primaryRepoId: id,
    };
  }
  return binding;
}

/** Drops deprecated `rootPath` once `repoBindings` carries the same clone (cleaner JSON). */
export function stripLegacyRootPathForPersistence(
  binding: CloudProjectLocalBinding,
): CloudProjectLocalBinding {
  if (!binding.repoBindings || Object.keys(binding.repoBindings).length === 0) {
    return binding;
  }
  if (binding.rootPath === undefined) return binding;
  const rest = { ...binding };
  delete rest.rootPath;
  return rest;
}

/**
 * Resolves the primary workspace clone for runtime paths (`CloudProject.rootPath`, etc.).
 */
export function primaryMachineBinding(
  projectId: string,
  binding: CloudProjectLocalBinding,
  sharedRepos?: readonly CloudSharedRepo[],
): CloudRepoMachineBinding | undefined {
  const n = migrateLegacyCloudBinding(projectId, binding);
  const rb = n.repoBindings;
  if (!rb || Object.keys(rb).length === 0) {
    return typeof n.rootPath === 'string' && n.rootPath
      ? { rootPath: n.rootPath, lastOpenedAt: n.lastOpenedAt }
      : undefined;
  }
  let primaryId = n.primaryRepoId;
  if (!primaryId && sharedRepos?.length) {
    const hit = sharedRepos.find((r) => rb[r.id]);
    if (hit) primaryId = hit.id;
  }
  if (!primaryId && Object.keys(rb).length === 1) {
    primaryId = Object.keys(rb)[0];
  }
  if (primaryId && rb[primaryId]) return rb[primaryId];
  const sorted = Object.keys(rb).sort();
  const first = sorted[0];
  return first ? rb[first] : undefined;
}

export function primaryRootPathFromCloudBinding(
  projectId: string,
  binding: CloudProjectLocalBinding,
  sharedRepos?: readonly CloudSharedRepo[],
): string | undefined {
  return primaryMachineBinding(projectId, binding, sharedRepos)?.rootPath;
}
