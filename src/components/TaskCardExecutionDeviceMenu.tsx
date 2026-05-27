import { useMemo } from 'react';
import type { ExecutionDeviceConfig, SessionStatus, TaskExecutionDeviceRef } from '../types';
import {
  buildDevicePickerOptions,
  deviceAvailabilityForRef,
  deviceAvailabilityHint,
  deviceChipLabel,
  isTaskExecutionDeviceEditable,
} from '../executionDevices/deviceUi';
import { ExecutionDeviceKindIcon } from './ExecutionDeviceKindIcon';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

function refKey(ref: TaskExecutionDeviceRef): string {
  return `${ref.kind}:${ref.deviceId}`;
}

function chipToneForRef(
  devices: ExecutionDeviceConfig[],
  deviceRef: TaskExecutionDeviceRef | undefined,
  opts: { cloudProject: boolean; hasExplicitTaskDevice: boolean },
): string {
  const state = deviceAvailabilityForRef(devices, deviceRef, {
    cloudProject: opts.cloudProject,
    hasExplicitTaskDevice: opts.hasExplicitTaskDevice,
  });
  return state === 'ok'
    ? 'text-zinc-500'
    : state === 'cloud-no-local-override'
      ? 'text-zinc-600'
      : 'text-amber-500/80';
}

export function TaskCardExecutionDeviceMenu({
  devices,
  deviceRef,
  hasExplicitTaskDevice,
  cloudProject = false,
  sessionStatus,
  onPick,
}: {
  devices: ExecutionDeviceConfig[];
  deviceRef: TaskExecutionDeviceRef;
  hasExplicitTaskDevice: boolean;
  cloudProject?: boolean;
  sessionStatus?: SessionStatus;
  onPick: (ref: TaskExecutionDeviceRef) => void;
}) {
  const editable = isTaskExecutionDeviceEditable(sessionStatus);
  const options = useMemo(() => buildDevicePickerOptions(devices), [devices]);
  const selectedKey = refKey(deviceRef);

  const availability = deviceAvailabilityForRef(devices, deviceRef, {
    cloudProject,
    hasExplicitTaskDevice,
  });
  const availabilityHint = deviceAvailabilityHint(availability);
  const label = deviceChipLabel(devices, deviceRef);
  const tone = chipToneForRef(devices, deviceRef, { cloudProject, hasExplicitTaskDevice });

  const triggerTitle = editable
    ? availabilityHint
      ? `${label} — ${availabilityHint}. Click to change device.`
      : `${label}. Click to change device.`
    : 'Locked while the session is running.';

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={!editable}>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label={
            editable
              ? `Execution device: ${label}. Open menu to change.`
              : `Execution device: ${label}. Locked while session is running.`
          }
          title={triggerTitle}
          className={`-m-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60 ${tone} ${
            editable ? 'hover:bg-white/[0.05] hover:brightness-110' : ''
          }`}
        >
          <ExecutionDeviceKindIcon
            kind={deviceRef.kind === 'ssh' ? 'ssh' : 'local'}
            className="h-3.5 w-3.5"
            strokeWidth={1.75}
          />
          <span className="sr-only">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[5610] min-w-0 w-auto max-w-[min(calc(100vw-12px),14rem)] p-1 text-[11px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {options.map((opt) => {
          const key = refKey(opt.ref);
          const selected = key === selectedKey;
          return (
            <DropdownMenuItem
              key={key}
              disabled={opt.disabled}
              title={opt.hint}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'gap-0 cursor-pointer px-2.5 py-1.5 text-[11px] leading-tight focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-45',
                selected
                  ? 'bg-accent text-zinc-50'
                  : 'text-zinc-200',
              )}
              onSelect={(e) => {
                if (opt.disabled) {
                  e.preventDefault();
                  return;
                }
                if (!selected) onPick(opt.ref);
              }}
            >
              <span className="min-w-0 truncate">
                <span className="text-zinc-500">{opt.kindLabel}:</span> {opt.label}
                {opt.disabled ? (
                  <span className="text-zinc-500"> (unavailable)</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
