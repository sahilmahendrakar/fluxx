import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionDeviceConfig } from '../types';
import {
  BUILTIN_LOCAL_DEVICE_ID,
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
