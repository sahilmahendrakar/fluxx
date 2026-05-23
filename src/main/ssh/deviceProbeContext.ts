import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActiveProjectKey, CloudProject, CloudSharedRepo, LocalProject } from '../../types';
import type { LocalBindingStore } from '../LocalBindingStore';
import type { ProjectStore } from '../ProjectStore';
import type { DeviceProbeProjectContext, DeviceProbeRepoRequest } from './agentCliCommands';

const execFile = promisify(execFileCallback);

export type DeviceProbeContextResolver = {
  projectStore: ProjectStore;
  bindingStore: LocalBindingStore;
  activeKey: ActiveProjectKey | null;
  cloudProject?: CloudProject | null;
};

export async function resolveDeviceProbeProjectContext(
  ctx: DeviceProbeContextResolver,
): Promise<DeviceProbeProjectContext> {
  const key = ctx.activeKey;
  if (!key) {
    return { repos: [] };
  }
  if (key.kind === 'local') {
    const project = ctx.projectStore.get();
    if (!project || project.kind !== 'local' || project.id !== key.id) {
      return { repos: [] };
    }
    return {
      repos: await reposFromLocalProject(project),
    };
  }

  const cloud = ctx.cloudProject;
  const binding = ctx.bindingStore.get(key.id);
  if (!cloud || cloud.id !== key.id) {
    return {
      repos: binding?.repoBindings
        ? await reposFromCloudBinding(binding.repoBindings, cloud?.sharedRepos)
        : [],
    };
  }
  return {
    repos: await reposFromCloudProject(cloud, binding?.repoBindings),
  };
}

async function reposFromLocalProject(project: LocalProject): Promise<DeviceProbeRepoRequest[]> {
  const out: DeviceProbeRepoRequest[] = [];
  for (const repo of project.repos) {
    const remoteUrl = await readOriginUrl(repo.rootPath);
    if (!remoteUrl) continue;
    out.push({
      repoId: repo.id,
      label: repo.name ?? repo.id,
      remoteUrl,
    });
  }
  return out;
}

async function reposFromCloudBinding(
  repoBindings: Record<string, { rootPath: string }>,
  sharedRepos?: CloudSharedRepo[],
): Promise<DeviceProbeRepoRequest[]> {
  const out: DeviceProbeRepoRequest[] = [];
  for (const [repoId, binding] of Object.entries(repoBindings)) {
    if (!binding?.rootPath) continue;
    const shared = sharedRepos?.find((r) => r.id === repoId);
    const remoteUrl =
      (await readOriginUrl(binding.rootPath)) ?? shared?.remoteUrl?.trim() ?? null;
    if (!remoteUrl) continue;
    out.push({
      repoId,
      label: shared?.name ?? repoId,
      remoteUrl,
    });
  }
  return out;
}

async function reposFromCloudProject(
  project: CloudProject,
  repoBindings: Record<string, { rootPath: string }> | undefined,
): Promise<DeviceProbeRepoRequest[]> {
  if (!repoBindings) return [];
  const out: DeviceProbeRepoRequest[] = [];
  for (const repo of project.sharedRepos) {
    const binding = repoBindings[repo.id];
    if (!binding?.rootPath) continue;
    const remoteUrl =
      (await readOriginUrl(binding.rootPath)) ?? repo.remoteUrl?.trim() ?? null;
    if (!remoteUrl) continue;
    out.push({
      repoId: repo.id,
      label: repo.name ?? repo.id,
      remoteUrl,
    });
  }
  return out;
}

async function readOriginUrl(repoRootPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRootPath,
      encoding: 'utf8',
    });
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}
