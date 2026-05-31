import type {
  ActiveProjectKey,
  ExecutionDeviceConfig,
  Project,
  RemoteRepoBinding,
  RemoteRepoBindingsByDevice,
  RemoteRepoBindingsOverview,
} from '../../types';
import { getRemoteRepoBinding } from '../../remoteRepoBindings';
import type { LocalBindingStore } from '../LocalBindingStore';
import type { ProjectStore } from '../ProjectStore';
import type { DeviceStore } from '../DeviceStore';
import { RemoteHelperClient } from './RemoteHelperClient';
import { deviceProbeHostLabel } from './opensshRunner';
import type { RemoteHelperRepoEnsureData } from './remoteHelperProtocol';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';

export type RemoteHelperProbeRepoPathData = {
  resolvedPath: string;
  originUrl: string;
  writable: boolean;
};

export type RemoteRepoBindingProbeResult =
  | { ok: true; data: RemoteHelperProbeRepoPathData; hostLabel: string }
  | { ok: false; code: string; message: string };

export class RemoteRepoBindingService {
  constructor(
    private bindingStore: LocalBindingStore,
    private projectStore: ProjectStore,
    private deviceStore: DeviceStore,
    private helper: RemoteHelperClient = new RemoteHelperClient(),
  ) {}

  listEnabledSshDevices(): ExecutionDeviceConfig[] {
    return this.deviceStore.listDevices().filter((d) => d.kind === 'ssh' && d.enabled);
  }

  async resolveBindingsMap(
    key: ActiveProjectKey,
    projectDir: string | null,
  ): Promise<RemoteRepoBindingsByDevice | undefined> {
    if (key.kind === 'cloud') {
      return this.bindingStore.getRemoteRepoBindings(key.id);
    }
    if (projectDir) {
      return this.projectStore.getRemoteRepoBindingsAt(projectDir);
    }
    return this.projectStore.getRemoteRepoBindings();
  }

  getBinding(
    key: ActiveProjectKey,
    projectDir: string | null,
    deviceId: string,
    repoId: string,
  ): RemoteRepoBinding | undefined {
    if (key.kind === 'cloud') {
      return this.bindingStore.getRemoteRepoBinding(key.id, deviceId, repoId);
    }
    const map = this.projectStore.getRemoteRepoBindings();
    return getRemoteRepoBinding(map, deviceId, repoId);
  }

  async setBinding(
    key: ActiveProjectKey,
    projectDir: string,
    deviceId: string,
    repoId: string,
    binding: RemoteRepoBinding,
  ): Promise<void> {
    if (key.kind === 'cloud') {
      await this.bindingStore.setRemoteRepoBinding(key.id, deviceId, repoId, binding);
      return;
    }
    await this.projectStore.setRemoteRepoBindingAt(projectDir, deviceId, repoId, binding);
  }

  async clearBinding(
    key: ActiveProjectKey,
    projectDir: string,
    deviceId: string,
    repoId: string,
  ): Promise<void> {
    if (key.kind === 'cloud') {
      await this.bindingStore.clearRemoteRepoBinding(key.id, deviceId, repoId);
      return;
    }
    await this.projectStore.clearRemoteRepoBindingAt(projectDir, deviceId, repoId);
  }

  resolveBoundRepoPath(
    bindings: RemoteRepoBindingsByDevice | undefined,
    deviceId: string,
    repoId: string,
  ): string | undefined {
    return getRemoteRepoBinding(bindings, deviceId, repoId)?.remotePath;
  }

  async buildOverview(input: {
    device: ExecutionDeviceConfig;
    repoIds: string[];
    bindings: RemoteRepoBindingsByDevice | undefined;
  }): Promise<RemoteRepoBindingsOverview> {
    const hostLabel = deviceProbeHostLabel(input.device);
    const out: RemoteRepoBindingsOverview = {};
    for (const repoId of input.repoIds) {
      const binding = getRemoteRepoBinding(input.bindings, input.device.id, repoId);
      if (!binding) {
        out[repoId] = { kind: 'unbound' };
        continue;
      }
      out[repoId] = {
        kind: 'bound',
        remotePath: binding.remotePath,
        hostLabel,
        boundAt: binding.boundAt,
        ...(binding.lastValidatedAt ? { lastValidatedAt: binding.lastValidatedAt } : {}),
      };
    }
    return out;
  }

  async probeRemoteRepoPath(
    device: ExecutionDeviceConfig,
    remotePath: string,
    options?: { remoteUrl?: string; gitEnabled?: boolean },
  ): Promise<RemoteRepoBindingProbeResult> {
    if (device.kind !== 'ssh') {
      return { ok: false, code: 'INTERNAL', message: 'Device is not an SSH device' };
    }
    const install = await this.helper.ensureInstalled(device);
    if (!install.ok) {
      return {
        ok: false,
        code: install.phase === 'helper-bootstrap' ? 'SSH_HELPER_MISSING' : 'SSH_CONNECT_FAILED',
        message: install.message,
      };
    }
    const hostLabel = deviceProbeHostLabel(device);
    const trimmedPath = remotePath.trim();
    const gitEnabled = options?.gitEnabled !== false;
    if (!trimmedPath) {
      return { ok: false, code: 'INTERNAL', message: 'Remote path is required' };
    }
    const trimmedUrl = options?.remoteUrl?.trim() ?? '';
    if (gitEnabled && !trimmedUrl) {
      return {
        ok: false,
        code: 'REMOTE_NON_GIT_UNSUPPORTED',
        message: 'No git remote URL is configured for this repository.',
      };
    }
    const result = await this.helper.runJsonCommand<RemoteHelperProbeRepoPathData>(
      device,
      'probe-repo-path',
      {
        remotePath: trimmedPath,
        ...(gitEnabled ? { remoteUrl: trimmedUrl } : { gitless: true }),
      },
      120_000,
    );
    if (!result.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(result.code),
        message: `${hostLabel}: ${result.message}`,
      };
    }
    return { ok: true, data: result.data, hostLabel };
  }

  async ensureRemoteRepoAtPath(
    device: ExecutionDeviceConfig,
    input: {
      workspaceRoot: string;
      projectId: string;
      repoId: string;
      remoteUrl: string;
      repoLabel: string;
      boundRepoPath: string;
    },
  ): Promise<
    | { ok: true; repoPath: string; action: RemoteHelperRepoEnsureData['action'] }
    | { ok: false; code: string; message: string }
  > {
    if (device.kind !== 'ssh') {
      return { ok: false, code: 'INTERNAL', message: 'Device is not SSH' };
    }
    const install = await this.helper.ensureInstalled(device);
    if (!install.ok) {
      return {
        ok: false,
        code: install.phase === 'helper-bootstrap' ? 'SSH_HELPER_MISSING' : 'SSH_CONNECT_FAILED',
        message: install.message,
      };
    }
    const hostLabel = deviceProbeHostLabel(device);
    const result = await this.helper.runJsonCommand<RemoteHelperRepoEnsureData>(
      device,
      'repo-ensure',
      {
        workspaceRoot: device.workspaceRoot,
        projectId: input.projectId,
        repoId: input.repoId,
        remoteUrl: input.remoteUrl,
        repoLabel: input.repoLabel,
        repoPath: input.boundRepoPath,
      },
      300_000,
    );
    if (!result.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(result.code),
        message: `${hostLabel}: ${result.message}`,
      };
    }
    return { ok: true, repoPath: result.data.repoPath, action: result.data.action };
  }
}

export function resolveRemoteRepoBindingForSession(
  project: Project,
  deviceId: string,
  repoId: string,
  bindingStore: LocalBindingStore,
  projectBindings?: RemoteRepoBindingsByDevice,
): string | undefined {
  if (project.kind === 'cloud') {
    const binding = bindingStore.getRemoteRepoBinding(project.id, deviceId, repoId);
    return binding?.remotePath;
  }
  return getRemoteRepoBinding(projectBindings ?? project.remoteRepoBindings, deviceId, repoId)
    ?.remotePath;
}
