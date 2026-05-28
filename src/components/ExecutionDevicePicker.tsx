import { useMemo } from 'react';
import type { ExecutionDeviceConfig, TaskExecutionDeviceRef } from '../types';
import { buildDevicePickerOptions } from '../executionDevices/deviceUi';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

function refKey(ref: TaskExecutionDeviceRef): string {
  return `${ref.kind}:${ref.deviceId}`;
}

export function ExecutionDevicePicker({
  id,
  devices,
  value,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel = 'Execution device',
}: {
  id?: string;
  devices: ExecutionDeviceConfig[];
  value: TaskExecutionDeviceRef | undefined;
  onChange: (ref: TaskExecutionDeviceRef) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const options = useMemo(() => buildDevicePickerOptions(devices), [devices]);
  const selectedKey = value ? refKey(value) : '';

  return (
    <Select
      value={selectedKey}
      disabled={disabled}
      onValueChange={(key) => {
        const opt = options.find((o) => refKey(o.ref) === key);
        if (opt) onChange(opt.ref);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'h-8 w-full min-w-0 max-w-full text-xs font-medium',
          className,
        )}
      >
        <SelectValue placeholder="Select device" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((opt) => (
            <SelectItem
              key={refKey(opt.ref)}
              value={refKey(opt.ref)}
              disabled={opt.disabled}
              title={opt.hint}
            >
              {opt.kindLabel}: {opt.label}
              {opt.disabled ? ' (unavailable)' : ''}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
