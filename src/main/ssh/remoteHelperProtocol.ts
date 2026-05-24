import type { DeviceProbeCapabilities, DeviceProbeErrorCode } from '../../types';
import {
  FLUXX_REMOTE_HELPER_VERSION,
  fluxxRemoteHelperVersionedFilename,
} from '../../remoteHelper/constants';

export type RemoteHelperErrorPayload = {
  code: string;
  message: string;
};

export type RemoteHelperSuccess<T> = {
  ok: true;
  version: string;
  data: T;
};

export type RemoteHelperFailure = {
  ok: false;
  version?: string;
  error: RemoteHelperErrorPayload;
  data?: DeviceProbeCapabilities;
};

export type RemoteHelperEnvelope<T> = RemoteHelperSuccess<T> | RemoteHelperFailure;

export function parseRemoteHelperJsonLine(rawStdout: string): unknown {
  const lines = rawStdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error('Remote helper returned no JSON output');
  }
  const lastLine = lines[lines.length - 1];
  return JSON.parse(lastLine) as unknown;
}

export function parseRemoteHelperEnvelope<T>(rawStdout: string): RemoteHelperEnvelope<T> {
  const parsed = parseRemoteHelperJsonLine(rawStdout);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Remote helper returned invalid JSON envelope');
  }
  const o = parsed as Record<string, unknown>;
  if (o.ok === true) {
    return {
      ok: true,
      version: typeof o.version === 'string' ? o.version : FLUXX_REMOTE_HELPER_VERSION,
      data: o.data as T,
    };
  }
  if (o.ok === false && o.error && typeof o.error === 'object') {
    const err = o.error as Record<string, unknown>;
    return {
      ok: false,
      version: typeof o.version === 'string' ? o.version : undefined,
      error: {
        code: typeof err.code === 'string' ? err.code : 'INTERNAL',
        message: typeof err.message === 'string' ? err.message : 'Remote helper failed',
      },
      data: o.data as DeviceProbeCapabilities | undefined,
    };
  }
  throw new Error('Remote helper JSON envelope missing ok flag');
}

export function isRemoteHelperVersionCompatible(remoteVersion: string | undefined): boolean {
  if (!remoteVersion?.trim()) return false;
  return remoteVersion.trim() === FLUXX_REMOTE_HELPER_VERSION;
}

export type RemoteHelperVersionFeatures = {
  worktreeReclaim?: boolean;
};

export function isRemoteHelperInstallComplete(
  version: string | undefined,
  features: RemoteHelperVersionFeatures | undefined,
): boolean {
  return (
    isRemoteHelperVersionCompatible(version) && features?.worktreeReclaim === true
  );
}

/** Partial helper upload (main script without `~/.fluxx/bin/lib/`) or stale symlink. */
export function isBrokenRemoteHelperInstallError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('cannot find module') ||
    lower.includes('module_not_found') ||
    lower.includes('lib/remoteworktreeprep')
  );
}

export function remoteHelperVersionedRemotePath(version: string = FLUXX_REMOTE_HELPER_VERSION): string {
  return `"$HOME/.fluxx/bin/${fluxxRemoteHelperVersionedFilename(version)}"`;
}

const PROBE_ERROR_CODES = new Set<DeviceProbeErrorCode>([
  'SSH_CONNECT_FAILED',
  'SSH_HOST_KEY_FAILED',
  'SSH_AUTH_FAILED',
  'SSH_TIMEOUT',
  'SSH_HELPER_MISSING',
  'SSH_HELPER_VERSION_MISMATCH',
  'SSH_HELPER_BOOTSTRAP_FAILED',
  'REMOTE_TMUX_MISSING',
  'REMOTE_GIT_MISSING',
  'REMOTE_AGENT_NOT_FOUND',
  'REMOTE_WORKSPACE_UNWRITABLE',
  'REMOTE_REPO_ACCESS_FAILED',
  'INTERNAL',
]);

export function mapHelperErrorCode(code: string): DeviceProbeErrorCode {
  if (PROBE_ERROR_CODES.has(code as DeviceProbeErrorCode)) {
    return code as DeviceProbeErrorCode;
  }
  return 'INTERNAL';
}

export function mapSshFailureToProbeError(input: {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  error?: Error;
}): { code: DeviceProbeErrorCode; message: string } {
  if (input.timedOut) {
    return {
      code: 'SSH_TIMEOUT',
      message: 'SSH command timed out',
    };
  }
  const stderr = input.stderr.trim();
  const combined = `${stderr}\n${input.error?.message ?? ''}`.trim();
  const lower = combined.toLowerCase();
  if (lower.includes('host key verification failed') || lower.includes('host key mismatch')) {
    return {
      code: 'SSH_HOST_KEY_FAILED',
      message: stderr || 'Host key verification failed',
    };
  }
  if (
    lower.includes('permission denied') ||
    lower.includes('publickey') ||
    lower.includes('authentication failed')
  ) {
    return {
      code: 'SSH_AUTH_FAILED',
      message: stderr || 'SSH authentication failed',
    };
  }
  if (
    lower.includes('operation timed out') ||
    lower.includes('connection timed out') ||
    lower.includes('timed out')
  ) {
    return {
      code: 'SSH_TIMEOUT',
      message: stderr || 'SSH connection timed out',
    };
  }
  if (
    lower.includes('not found') ||
    lower.includes('no such file') ||
    input.exitCode === 127
  ) {
    return {
      code: 'SSH_HELPER_MISSING',
      message: stderr || 'Remote helper command was not found',
    };
  }
  if (lower.includes('could not resolve hostname') || lower.includes('connection refused')) {
    return {
      code: 'SSH_CONNECT_FAILED',
      message: stderr || 'Could not connect over SSH',
    };
  }
  return {
    code: 'SSH_CONNECT_FAILED',
    message: stderr || input.error?.message || 'SSH command failed',
  };
}

export type RemoteHelperVersionData = {
  version: string;
  features?: RemoteHelperVersionFeatures;
};

export type RemoteHelperProbeData = DeviceProbeCapabilities;

export type RemoteHelperRepoEnsureData = {
  repoPath: string;
  action: 'cloned' | 'fetched' | 'validated';
};

export type RemoteHelperWorktreeCreateData = {
  worktreePath: string;
  branch: string;
  /** Present when the repo setup script failed but the worktree was still created. */
  setupWarning?: string;
};

export type RemoteHelperStartTerminalData = {
  terminalId: string;
  tmuxSessionName: string;
  startedAt: string;
};

export type RemoteHelperStopTerminalData = {
  stopped: boolean;
  terminalId: string;
  endedAt?: string;
  reason?: string;
};

export type RemoteHelperStartShellData = {
  terminalId: string;
  tmuxSessionName: string;
  startedAt: string;
};

export type RemoteHelperListTerminalsData = {
  terminals: Array<{
    id: string;
    kind: string;
    runtime: string;
    projectId: string;
    repoId?: string;
    deviceId?: string;
    deviceKind?: string;
    hostLabel?: string;
    cwd: string;
    tmuxSessionName?: string;
    command: string;
    args: string[];
    startedAt: string;
    endedAt?: string;
    endedReason?: string;
    task?: {
      taskId: string;
      agent: string;
      worktreePath: string;
      fluxxWorkBranch: string;
      sourceBranchShort?: string;
    };
    shell?: {
      parentSessionId: string;
      worktreePath: string;
    };
  }>;
};

export type RemoteHelperListTmuxSessionsData = {
  sessionNames: string[];
};

export type RemoteHelperPathExistsData = {
  exists: boolean;
};

export type RemoteHelperWorktreeRemoveData = {
  removed: boolean;
  reason?: string;
  worktreePath?: string;
};

export type RemoteHelperMarkTerminalEndedData = {
  marked: boolean;
  terminalId: string;
  endedAt?: string;
  reason?: string;
};

export type RemoteHelperJsonResult<T> =
  | { ok: true; version: string; data: T }
  | { ok: false; code: string; message: string };
