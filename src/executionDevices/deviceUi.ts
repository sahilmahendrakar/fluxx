import type {
  ExecutionDeviceConfig,
  SessionStatus,
  TaskExecutionDeviceRef,
} from '../types';

/** When true, sessions on this device must use tmux; Fluxx must not fall back to direct PTYs. */
export function deviceUsesTmuxPersistence(device: ExecutionDeviceConfig): boolean {
  return device.tmux.enabled;
}
import {
  BUILTIN_LOCAL_DEVICE_DISPLAY_NAME,
  BUILTIN_LOCAL_DEVICE_ID,
} from './constants';
import { resolveEffectiveExecutionDevice } from './resolve';

export type DeviceAvailabilityState =
  | 'ok'
  | 'disabled'
  | 'missing'
  | 'probe-unavailable'
  | 'cloud-no-local-override';

export function taskRefFromDeviceConfig(device: ExecutionDeviceConfig): TaskExecutionDeviceRef {
  return device.kind === 'local'
    ? { kind: 'local', deviceId: BUILTIN_LOCAL_DEVICE_ID }
    : { kind: 'ssh', deviceId: device.id };
}

export function deviceConfigById(
  devices: ExecutionDeviceConfig[],
  deviceId: string,
): ExecutionDeviceConfig | undefined {
  return devices.find((d) => d.id === deviceId);
}

export function deviceDisplayLabel(
  devices: ExecutionDeviceConfig[],
  ref: TaskExecutionDeviceRef,
): string {
  if (ref.kind === 'local') return BUILTIN_LOCAL_DEVICE_DISPLAY_NAME;
  const device = deviceConfigById(devices, ref.deviceId);
  return device?.displayName ?? ref.deviceId;
}

export function deviceAvailabilityForRef(
  devices: ExecutionDeviceConfig[],
  ref: TaskExecutionDeviceRef | undefined,
  opts?: { cloudProject?: boolean; hasExplicitTaskDevice?: boolean },
): DeviceAvailabilityState {
  if (!ref) {
    return opts?.cloudProject && !opts.hasExplicitTaskDevice
      ? 'cloud-no-local-override'
      : 'missing';
  }
  if (ref.kind === 'local') return 'ok';
  const device = deviceConfigById(devices, ref.deviceId);
  if (!device) return 'missing';
  if (!device.enabled) return 'disabled';
  if (device.lastProbe?.status === 'unavailable') return 'probe-unavailable';
  return 'ok';
}

export function deviceAvailabilityHint(state: DeviceAvailabilityState): string | null {
  switch (state) {
    case 'ok':
      return null;
    case 'disabled':
      return 'Device is disabled in Settings → Devices.';
    case 'missing':
      return 'Configured device is missing. Choose another device or add it in Settings → Devices.';
    case 'probe-unavailable':
      return 'Last probe reported this host as unavailable.';
    case 'cloud-no-local-override':
      return 'No device chosen on this computer yet. Pick a device to run sessions locally.';
    default:
      return null;
  }
}

export function isTaskExecutionDeviceEditable(sessionStatus: SessionStatus | undefined): boolean {
  return sessionStatus !== 'running';
}

export function resolveNewTaskDeviceRef(input: {
  projectDefaultDeviceId?: string;
  globalDefaultDeviceId?: string;
  explicitRef?: TaskExecutionDeviceRef;
}): TaskExecutionDeviceRef {
  if (input.explicitRef) return input.explicitRef;
  return resolveEffectiveExecutionDevice({
    projectDefaultDeviceId: input.projectDefaultDeviceId,
    globalDefaultDeviceId: input.globalDefaultDeviceId,
  });
}

export type DevicePickerOption = {
  ref: TaskExecutionDeviceRef;
  label: string;
  kindLabel: string;
  disabled: boolean;
  hint?: string;
};

export function buildDevicePickerOptions(
  devices: ExecutionDeviceConfig[],
  opts?: { includeDisabled?: boolean },
): DevicePickerOption[] {
  const includeDisabled = opts?.includeDisabled === true;
  const out: DevicePickerOption[] = [];
  for (const device of devices) {
    if (!includeDisabled && !device.enabled) continue;
    const ref = taskRefFromDeviceConfig(device);
    const state = deviceAvailabilityForRef(devices, ref);
    out.push({
      ref,
      label: device.displayName,
      kindLabel: device.kind === 'local' ? 'Local' : 'SSH',
      disabled: !device.enabled || state === 'missing',
      hint: deviceAvailabilityHint(state) ?? undefined,
    });
  }
  return out;
}

/** Short chip label for board/session surfaces (no SSH host details). */
export function deviceChipLabel(
  devices: ExecutionDeviceConfig[],
  ref: TaskExecutionDeviceRef | undefined,
): string {
  if (!ref) return 'No device';
  const label = deviceDisplayLabel(devices, ref);
  if (ref.kind === 'ssh') return label;
  return label;
}
