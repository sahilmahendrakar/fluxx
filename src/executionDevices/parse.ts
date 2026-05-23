import type {
  DeviceProbeResult,
  DeviceProbeStatus,
  ExecutionDeviceConfig,
  ExecutionDeviceSshConfig,
  ExecutionDeviceTmuxSettings,
  TaskExecutionDeviceKind,
  TaskExecutionDeviceRef,
} from '../types';
import {
  BUILTIN_LOCAL_DEVICE_DISPLAY_NAME,
  BUILTIN_LOCAL_DEVICE_ID,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
} from './constants';

const TASK_DEVICE_KINDS: TaskExecutionDeviceKind[] = [
  'local',
  'ssh',
  'runner',
  'managed-cloud',
];

const CONFIG_DEVICE_KINDS = ['local', 'ssh'] as const;

export function isTaskExecutionDeviceKind(value: unknown): value is TaskExecutionDeviceKind {
  return (
    typeof value === 'string' &&
    (TASK_DEVICE_KINDS as string[]).includes(value)
  );
}

export function isPrivateDirectExecutionDeviceKind(
  kind: TaskExecutionDeviceKind,
): boolean {
  return kind === 'local' || kind === 'ssh';
}

/** Shared Firestore execution targets only (not direct-SSH v1). */
export function isSharedFirestoreExecutionDeviceKind(
  kind: TaskExecutionDeviceKind,
): boolean {
  return kind === 'runner' || kind === 'managed-cloud';
}

export function shouldPersistExecutionDeviceToFirestore(
  ref: TaskExecutionDeviceRef | undefined | null,
): boolean {
  if (!ref) return false;
  return isSharedFirestoreExecutionDeviceKind(ref.kind);
}

export function parseTaskExecutionDeviceRef(
  raw: unknown,
): TaskExecutionDeviceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isTaskExecutionDeviceKind(o.kind)) return null;
  if (typeof o.deviceId !== 'string' || !o.deviceId.trim()) return null;
  const ref: TaskExecutionDeviceRef = {
    kind: o.kind,
    deviceId: o.deviceId.trim(),
  };
  if (typeof o.ownerUid === 'string' && o.ownerUid.trim()) {
    ref.ownerUid = o.ownerUid.trim();
  }
  return ref;
}

export function validateTaskExecutionDeviceRef(
  ref: TaskExecutionDeviceRef,
  configuredDeviceIds: ReadonlySet<string>,
): { ok: true } | { ok: false; message: string } {
  if (ref.kind === 'local') {
    if (ref.deviceId !== BUILTIN_LOCAL_DEVICE_ID) {
      return {
        ok: false,
        message: `Local execution device must use id "${BUILTIN_LOCAL_DEVICE_ID}"`,
      };
    }
    return { ok: true };
  }
  if (ref.kind === 'ssh') {
    if (!configuredDeviceIds.has(ref.deviceId)) {
      return {
        ok: false,
        message: `Unknown SSH device id: ${ref.deviceId}`,
      };
    }
    return { ok: true };
  }
  if (ref.kind === 'runner' || ref.kind === 'managed-cloud') {
    if (!ref.ownerUid?.trim()) {
      return {
        ok: false,
        message: `${ref.kind} devices require ownerUid`,
      };
    }
    return { ok: true };
  }
  return { ok: false, message: `Unsupported device kind: ${ref.kind}` };
}

function parseTmuxSettings(raw: unknown): ExecutionDeviceTmuxSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled !== 'boolean') return null;
  return { enabled: o.enabled };
}

const PROBE_STATUSES: DeviceProbeStatus[] = ['unknown', 'available', 'unavailable', 'probing'];

function parseDeviceProbeResult(raw: unknown): DeviceProbeResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.status !== 'string' ||
    !(PROBE_STATUSES as string[]).includes(o.status)
  ) {
    return null;
  }
  if (typeof o.checkedAt !== 'string' || !o.checkedAt) return null;
  const out: DeviceProbeResult = {
    status: o.status as DeviceProbeStatus,
    checkedAt: o.checkedAt,
  };
  if (typeof o.message === 'string' && o.message.trim()) {
    out.message = o.message.trim();
  }
  return out;
}

function parseSshConfig(raw: unknown): ExecutionDeviceSshConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.host !== 'string' || !o.host.trim()) return null;
  const out: ExecutionDeviceSshConfig = { host: o.host.trim() };
  if (typeof o.user === 'string' && o.user.trim()) out.user = o.user.trim();
  if (typeof o.port === 'number' && Number.isFinite(o.port)) out.port = o.port;
  if (Array.isArray(o.extraArgs)) {
    const args = o.extraArgs.filter((x): x is string => typeof x === 'string');
    if (args.length > 0) out.extraArgs = args;
  }
  if (
    typeof o.connectTimeoutSeconds === 'number' &&
    Number.isFinite(o.connectTimeoutSeconds)
  ) {
    out.connectTimeoutSeconds = o.connectTimeoutSeconds;
  }
  return out;
}

export function parseExecutionDeviceConfig(raw: unknown): ExecutionDeviceConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (
    typeof o.kind !== 'string' ||
    !(CONFIG_DEVICE_KINDS as readonly string[]).includes(o.kind)
  ) {
    return null;
  }
  if (typeof o.displayName !== 'string' || !o.displayName.trim()) return null;
  if (typeof o.enabled !== 'boolean') return null;
  if (typeof o.createdAt !== 'string' || !o.createdAt) return null;
  if (typeof o.updatedAt !== 'string' || !o.updatedAt) return null;
  const tmux = parseTmuxSettings(o.tmux);
  if (!tmux) return null;
  if (typeof o.workspaceRoot !== 'string' || !o.workspaceRoot.trim()) return null;
  const kind = o.kind as 'local' | 'ssh';
  const config: ExecutionDeviceConfig = {
    id: o.id.trim(),
    kind,
    displayName: o.displayName.trim(),
    enabled: o.enabled,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    tmux,
    workspaceRoot: o.workspaceRoot.trim(),
  };
  if (typeof o.lastUsedAt === 'string' && o.lastUsedAt) {
    config.lastUsedAt = o.lastUsedAt;
  }
  const lastProbe = parseDeviceProbeResult(o.lastProbe);
  if (lastProbe) {
    config.lastProbe = lastProbe;
  }
  if (typeof o.shell === 'string' && o.shell.trim()) {
    config.shell = o.shell.trim();
  }
  if (kind === 'ssh') {
    const ssh = parseSshConfig(o.ssh);
    if (!ssh) return null;
    config.ssh = ssh;
  }
  return config;
}

export function synthesizeBuiltInLocalDevice(opts?: {
  tmuxEnabled?: boolean;
  now?: string;
}): ExecutionDeviceConfig {
  const now = opts?.now ?? new Date().toISOString();
  return {
    id: BUILTIN_LOCAL_DEVICE_ID,
    kind: 'local',
    displayName: BUILTIN_LOCAL_DEVICE_DISPLAY_NAME,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    tmux: { enabled: opts?.tmuxEnabled === true },
    workspaceRoot: DEFAULT_LOCAL_WORKSPACE_ROOT,
  };
}

export function builtInLocalDeviceRef(): TaskExecutionDeviceRef {
  return { kind: 'local', deviceId: BUILTIN_LOCAL_DEVICE_ID };
}

export function parsePerTaskDeviceOverridesRecord(
  raw: unknown,
): Record<string, TaskExecutionDeviceRef> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, TaskExecutionDeviceRef> = {};
  for (const [taskId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!taskId.trim()) continue;
    const ref = parseTaskExecutionDeviceRef(value);
    if (ref && isPrivateDirectExecutionDeviceKind(ref.kind)) {
      out[taskId.trim()] = ref;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
