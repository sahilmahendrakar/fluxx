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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    ? 'text-muted-foreground'
    : state === 'cloud-no-local-override'
      ? 'text-muted-foreground/70'
      : 'text-status-needs-input';
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label={
            editable
              ? `Execution device: ${label}. Open menu to change.`
              : `Execution device: ${label}. Locked while session is running.`
          }
          title={triggerTitle}
          className={cn(
            '-m-0.5 size-6 shrink-0',
            tone,
            editable && 'hover:bg-muted/40',
          )}
        >
          <ExecutionDeviceKindIcon
            kind={deviceRef.kind === 'ssh' ? 'ssh' : 'local'}
            className="size-3.5"
            strokeWidth={1.75}
          />
          <span className="sr-only">{label}</span>
        </Button>
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
                'cursor-pointer gap-0 px-2.5 py-1.5 text-[11px] leading-tight focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-45',
                selected && 'bg-accent text-accent-foreground',
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
                <span className="text-muted-foreground">{opt.kindLabel}:</span> {opt.label}
                {opt.disabled ? (
                  <span className="text-muted-foreground"> (unavailable)</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
