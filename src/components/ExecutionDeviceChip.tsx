import type { ExecutionDeviceConfig, TaskExecutionDeviceRef } from '../types';
import {
  deviceAvailabilityForRef,
  deviceAvailabilityHint,
  deviceChipLabel,
} from '../executionDevices/deviceUi';

const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset';

export function ExecutionDeviceChip({
  devices,
  ref: deviceRef,
  cloudProject = false,
  title,
}: {
  devices: ExecutionDeviceConfig[];
  ref: TaskExecutionDeviceRef | undefined;
  cloudProject?: boolean;
  title?: string;
}) {
  const state = deviceAvailabilityForRef(devices, deviceRef, {
    cloudProject,
    hasExplicitTaskDevice: Boolean(deviceRef),
  });
  const hint = deviceAvailabilityHint(state);
  const label = deviceChipLabel(devices, deviceRef);
  const tone =
    state === 'ok'
      ? 'border-teal-400/25 bg-teal-500/10 text-teal-100/90 ring-teal-500/15'
      : state === 'cloud-no-local-override'
        ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400 ring-zinc-500/15'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-100/90 ring-amber-500/15';

  return (
    <span
      className={`${CHIP_BASE} ${tone}`}
      title={title ?? hint ?? (deviceRef?.kind === 'ssh' ? 'SSH device (private to this computer)' : 'Local device')}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
