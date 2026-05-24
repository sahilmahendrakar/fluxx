import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ExecutionDeviceConfig, TaskExecutionDeviceRef } from '../types';
import {
  buildDevicePickerOptions,
  deviceAvailabilityForRef,
  deviceAvailabilityHint,
} from '../executionDevices/deviceUi';

function refKey(ref: TaskExecutionDeviceRef): string {
  return `${ref.kind}:${ref.deviceId}`;
}

export function ExecutionDevicePicker({
  id,
  devices,
  value,
  onChange,
  disabled,
  cloudProject = false,
  hasExplicitTaskDevice,
  className,
  'aria-label': ariaLabel = 'Execution device',
}: {
  id?: string;
  devices: ExecutionDeviceConfig[];
  value: TaskExecutionDeviceRef | undefined;
  onChange: (ref: TaskExecutionDeviceRef) => void;
  disabled?: boolean;
  cloudProject?: boolean;
  /** When false on cloud tasks, shows “no local override” until the user picks a device. */
  hasExplicitTaskDevice?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const options = useMemo(() => buildDevicePickerOptions(devices), [devices]);
  const selectedKey = value ? refKey(value) : '';
  const availability = deviceAvailabilityForRef(devices, value, {
    cloudProject,
    hasExplicitTaskDevice: hasExplicitTaskDevice ?? Boolean(value),
  });
  const hint = deviceAvailabilityHint(availability);

  return (
    <div className="min-w-0">
      <select
        id={id}
        value={selectedKey}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o) => refKey(o.ref) === e.target.value);
          if (opt) onChange(opt.ref);
        }}
        className={
          className ??
          'w-full min-w-0 max-w-full cursor-pointer appearance-none rounded-lg border-0 bg-white/[0.04] py-1.5 pl-2.5 pr-8 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.06] outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50'
        }
        style={{ colorScheme: 'dark' } as CSSProperties}
        aria-label={ariaLabel}
      >
        {options.map((opt) => (
          <option
            key={refKey(opt.ref)}
            value={refKey(opt.ref)}
            disabled={opt.disabled}
          >
            {opt.kindLabel}: {opt.label}
            {opt.disabled ? ' (unavailable)' : ''}
          </option>
        ))}
      </select>
      {hint ? (
        <p className="mt-1.5 text-[11px] leading-snug text-amber-200/85" role="status">
          {hint}
          {cloudProject ? (
            <span className="mt-1 block text-zinc-500">
              SSH device choices are stored on this computer only and are not shared with teammates.
            </span>
          ) : null}
        </p>
      ) : cloudProject ? (
        <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
          Stored on this computer only — teammates do not see your SSH configuration.
        </p>
      ) : null}
    </div>
  );
}
