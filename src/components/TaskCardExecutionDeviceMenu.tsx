import { useMemo, useRef, useState } from 'react';
import type { ExecutionDeviceConfig, SessionStatus, TaskExecutionDeviceRef } from '../types';
import {
  buildDevicePickerOptions,
  deviceAvailabilityForRef,
  deviceAvailabilityHint,
  deviceChipLabel,
  isTaskExecutionDeviceEditable,
} from '../executionDevices/deviceUi';
import { AgentSessionPrefsMenuPortal } from './AgentSessionPrefsMenu';
import { ExecutionDeviceKindIcon } from './ExecutionDeviceKindIcon';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const closeMenu = () => setMenuOpen(false);

  const handlePick = (ref: TaskExecutionDeviceRef) => {
    if (refKey(ref) === selectedKey) {
      closeMenu();
      return;
    }
    onPick(ref);
    closeMenu();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={!editable}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!editable) return;
          setMenuOpen((wasOpen) => !wasOpen);
        }}
        aria-label={
          editable
            ? `Execution device: ${label}. Open menu to change.`
            : `Execution device: ${label}. Locked while session is running.`
        }
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
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
      <AgentSessionPrefsMenuPortal
        open={menuOpen}
        anchorRef={anchorRef}
        dropdownRef={dropdownRef}
        onClose={closeMenu}
        ariaLabel="Execution device"
      >
        <div className="w-[min(calc(100vw-12px),14rem)] py-1">
          <div role="menu" aria-label="Execution devices">
            {options.map((opt) => {
              const key = refKey(opt.ref);
              const selected = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={opt.disabled}
                  title={opt.hint}
                  className={`flex w-full px-2.5 py-2 text-left text-[12px] outline-none focus-visible:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45 ${
                    selected ? 'bg-white/[0.04] text-zinc-50' : 'text-zinc-200 hover:bg-white/[0.06]'
                  }`}
                  onClick={() => {
                    if (opt.disabled) return;
                    handlePick(opt.ref);
                  }}
                >
                  <span className="min-w-0 truncate">
                    <span className="text-zinc-500">{opt.kindLabel}:</span> {opt.label}
                    {opt.disabled ? (
                      <span className="text-zinc-500"> (unavailable)</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </AgentSessionPrefsMenuPortal>
    </>
  );
}
