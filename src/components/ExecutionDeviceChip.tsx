import type { ExecutionDeviceConfig, TaskExecutionDeviceRef } from '../types';
import {
  deviceAvailabilityForRef,
  deviceAvailabilityHint,
  deviceChipLabel,
} from '../executionDevices/deviceUi';
import { ExecutionDeviceKindIcon } from './ExecutionDeviceKindIcon';

export function ExecutionDeviceChip({
  devices,
  deviceRef,
  cloudProject = false,
  title,
}: {
  devices: ExecutionDeviceConfig[];
  deviceRef: TaskExecutionDeviceRef | undefined;
  cloudProject?: boolean;
  title?: string;
}) {
  const state = deviceAvailabilityForRef(devices, deviceRef, {
    cloudProject,
    hasExplicitTaskDevice: Boolean(deviceRef),
  });
  const hint = deviceAvailabilityHint(state);
  const label = deviceChipLabel(devices, deviceRef);
  const tooltip = title ?? (hint ? `${label} — ${hint}` : label);
  const tone =
    state === 'ok'
      ? 'text-zinc-500'
      : state === 'cloud-no-local-override'
        ? 'text-zinc-600'
        : 'text-amber-500/80';

  return (
    <span
      className={`inline-flex shrink-0 items-center ${tone}`}
      title={tooltip}
    >
      <ExecutionDeviceKindIcon
        kind={deviceRef?.kind === 'ssh' ? 'ssh' : 'local'}
        className="h-3.5 w-3.5"
        strokeWidth={1.75}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
