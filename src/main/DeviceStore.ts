import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ExecutionDeviceConfig,
  ExecutionDeviceUpdateInput,
  SshExecutionDeviceUpsertInput,
} from '../types';
import {
  BUILTIN_LOCAL_DEVICE_ID,
  DEFAULT_SSH_WORKSPACE_ROOT,
  EXECUTION_DEVICES_FILE_SCHEMA_VERSION,
} from '../executionDevices/constants';
import {
  parseExecutionDeviceConfig,
  synthesizeBuiltInLocalDevice,
} from '../executionDevices/parse';

export interface ExecutionDevicesFileV1 {
  schemaVersion: typeof EXECUTION_DEVICES_FILE_SCHEMA_VERSION;
  defaultDeviceId?: string;
  devices: ExecutionDeviceConfig[];
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

/**
 * Global per-machine SSH/local device registry (`userData/executionDevices.json`).
 */
export class DeviceStore {
  private filePath: string;
  private devices: ExecutionDeviceConfig[] = [];
  private defaultDeviceId: string | undefined;
  private initialized = false;

  constructor(opts?: { filePath?: string }) {
    this.filePath =
      opts?.filePath ?? path.join(app.getPath('userData'), 'executionDevices.json');
  }

  async init(opts?: { legacyLocalTmuxEnabled?: boolean }): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        await this.bootstrapFreshStore(opts?.legacyLocalTmuxEnabled);
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.warn('[DeviceStore] executionDevices.json malformed; reinitializing.');
      await this.bootstrapFreshStore(opts?.legacyLocalTmuxEnabled);
      return;
    }

    const loaded = this.parseStoreFile(parsed);
    if (!loaded) {
      await this.bootstrapFreshStore(opts?.legacyLocalTmuxEnabled);
      return;
    }

    this.devices = loaded.devices;
    this.defaultDeviceId = loaded.defaultDeviceId;
    let persist = loaded.migrated;

    const hasLocal = this.devices.some((d) => d.id === BUILTIN_LOCAL_DEVICE_ID);
    if (!hasLocal) {
      this.devices.unshift(
        synthesizeBuiltInLocalDevice({
          tmuxEnabled: opts?.legacyLocalTmuxEnabled,
        }),
      );
      persist = true;
    }

    if (persist) {
      await this.save();
    }
  }

  private parseStoreFile(raw: unknown): {
    devices: ExecutionDeviceConfig[];
    defaultDeviceId?: string;
    migrated: boolean;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Partial<ExecutionDevicesFileV1> & { devices?: unknown };
    if (!Array.isArray(o.devices)) return null;
    const devices: ExecutionDeviceConfig[] = [];
    let migrated = false;
    for (const entry of o.devices) {
      const parsed = parseExecutionDeviceConfig(entry);
      if (parsed) {
        devices.push(parsed);
        continue;
      }
      migrated = true;
    }
    const defaultDeviceId =
      typeof o.defaultDeviceId === 'string' && o.defaultDeviceId.trim()
        ? o.defaultDeviceId.trim()
        : undefined;
    return { devices, defaultDeviceId, migrated };
  }

  private async bootstrapFreshStore(legacyLocalTmuxEnabled?: boolean): Promise<void> {
    this.devices = [
      synthesizeBuiltInLocalDevice({ tmuxEnabled: legacyLocalTmuxEnabled }),
    ];
    this.defaultDeviceId = undefined;
    await this.save();
  }

  listDevices(): ExecutionDeviceConfig[] {
    return this.devices.map((d) => ({ ...d, tmux: { ...d.tmux } }));
  }

  getDevice(id: string): ExecutionDeviceConfig | null {
    const found = this.devices.find((d) => d.id === id);
    return found ? { ...found, tmux: { ...found.tmux } } : null;
  }

  getConfiguredDeviceIds(): Set<string> {
    return new Set(this.devices.map((d) => d.id));
  }

  getGlobalDefaultDeviceId(): string | undefined {
    return this.defaultDeviceId;
  }

  async setGlobalDefaultDeviceId(deviceId: string | null | undefined): Promise<void> {
    const trimmed = deviceId?.trim();
    if (!trimmed) {
      this.defaultDeviceId = undefined;
    } else {
      if (!this.devices.some((d) => d.id === trimmed && d.enabled)) {
        throw new Error(`Unknown or disabled device id: ${trimmed}`);
      }
      this.defaultDeviceId = trimmed;
    }
    await this.save();
  }

  async createSshDevice(input: SshExecutionDeviceUpsertInput): Promise<ExecutionDeviceConfig> {
    const now = new Date().toISOString();
    const displayName = input.displayName?.trim();
    const host = input.host?.trim();
    const workspaceRoot = input.workspaceRoot?.trim() || DEFAULT_SSH_WORKSPACE_ROOT;
    if (!displayName) throw new Error('Display name is required');
    if (!host) throw new Error('SSH host is required');
    const device: ExecutionDeviceConfig = {
      id: randomUUID(),
      kind: 'ssh',
      displayName,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      tmux: {
        enabled: input.tmuxEnabled === true,
      },
      workspaceRoot,
      ssh: {
        host,
        ...(input.user?.trim() ? { user: input.user.trim() } : {}),
        ...(input.port != null && Number.isFinite(input.port) ? { port: input.port } : {}),
        ...(input.forwardAgent === true ? { forwardAgent: true } : {}),
        ...(input.extraArgs?.length ? { extraArgs: input.extraArgs } : {}),
        ...(input.connectTimeoutSeconds != null && Number.isFinite(input.connectTimeoutSeconds)
          ? { connectTimeoutSeconds: input.connectTimeoutSeconds }
          : {}),
      },
      ...(input.shell?.trim() ? { shell: input.shell.trim() } : {}),
    };
    this.devices.push(device);
    await this.save();
    return { ...device, tmux: { ...device.tmux }, ssh: device.ssh ? { ...device.ssh } : undefined };
  }

  async updateDevice(id: string, patch: ExecutionDeviceUpdateInput): Promise<ExecutionDeviceConfig> {
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`Unknown device id: ${id}`);
    const existing = this.devices[idx];
    const now = new Date().toISOString();
    const next: ExecutionDeviceConfig = {
      ...existing,
      updatedAt: now,
      tmux: { ...existing.tmux },
      ...(existing.ssh ? { ssh: { ...existing.ssh } } : {}),
    };
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      if (!name) throw new Error('Display name cannot be empty');
      next.displayName = name;
    }
    if (patch.enabled !== undefined) {
      if (id === BUILTIN_LOCAL_DEVICE_ID && patch.enabled === false) {
        throw new Error('The built-in local device cannot be disabled');
      }
      next.enabled = patch.enabled;
      if (!patch.enabled && this.defaultDeviceId === id) {
        this.defaultDeviceId = undefined;
      }
    }
    if (patch.workspaceRoot !== undefined) {
      const root = patch.workspaceRoot.trim();
      if (!root) throw new Error('Workspace root cannot be empty');
      next.workspaceRoot = root;
    }
    if (patch.shell !== undefined) {
      const shell = patch.shell.trim();
      if (shell) next.shell = shell;
      else delete next.shell;
    }
    if (patch.tmuxEnabled !== undefined) {
      next.tmux = { enabled: patch.tmuxEnabled };
    }
    if (existing.kind === 'ssh' && next.ssh) {
      if (patch.host !== undefined) {
        const host = patch.host.trim();
        if (!host) throw new Error('SSH host cannot be empty');
        next.ssh.host = host;
      }
      if (patch.user !== undefined) {
        const user = patch.user.trim();
        if (user) next.ssh.user = user;
        else delete next.ssh.user;
      }
      if (patch.port !== undefined) {
        if (patch.port == null) delete next.ssh.port;
        else next.ssh.port = patch.port;
      }
      if (patch.forwardAgent !== undefined) {
        if (patch.forwardAgent) next.ssh.forwardAgent = true;
        else delete next.ssh.forwardAgent;
      }
      if (patch.extraArgs !== undefined) {
        if (patch.extraArgs.length > 0) next.ssh.extraArgs = patch.extraArgs;
        else delete next.ssh.extraArgs;
      }
      if (patch.connectTimeoutSeconds !== undefined) {
        if (patch.connectTimeoutSeconds == null) delete next.ssh.connectTimeoutSeconds;
        else next.ssh.connectTimeoutSeconds = patch.connectTimeoutSeconds;
      }
    }
    this.devices[idx] = next;
    await this.save();
    return this.getDevice(id)!;
  }

  async removeDevice(id: string): Promise<void> {
    if (id === BUILTIN_LOCAL_DEVICE_ID) {
      throw new Error('The built-in local device cannot be removed');
    }
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) {
      throw new Error(`Unknown device id: ${id}`);
    }
    if (this.defaultDeviceId === id) {
      this.defaultDeviceId = undefined;
    }
    await this.save();
  }

  async setLastProbe(id: string, probe: import('../types').DeviceProbeResult): Promise<ExecutionDeviceConfig> {
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`Unknown device id: ${id}`);
    const existing = this.devices[idx];
    const next: ExecutionDeviceConfig = {
      ...existing,
      updatedAt: new Date().toISOString(),
      lastProbe: probe,
      tmux: { ...existing.tmux },
      ...(existing.ssh ? { ssh: { ...existing.ssh } } : {}),
    };
    this.devices[idx] = next;
    await this.save();
    return this.getDevice(id)!;
  }

  getBuiltInLocalDevice(): ExecutionDeviceConfig {
    const local =
      this.devices.find((d) => d.id === BUILTIN_LOCAL_DEVICE_ID) ??
      synthesizeBuiltInLocalDevice();
    return { ...local, tmux: { ...local.tmux } };
  }

  private async save(): Promise<void> {
    const data: ExecutionDevicesFileV1 = {
      schemaVersion: EXECUTION_DEVICES_FILE_SCHEMA_VERSION,
      devices: this.devices,
      ...(this.defaultDeviceId ? { defaultDeviceId: this.defaultDeviceId } : {}),
    };
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    if (process.platform === 'win32') {
      try {
        await fs.unlink(this.filePath);
      } catch (e: unknown) {
        if (errnoCode(e) !== 'ENOENT') throw e;
      }
    }
    await fs.rename(tmpPath, this.filePath);
  }
}
