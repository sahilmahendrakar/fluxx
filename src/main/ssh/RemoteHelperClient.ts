import type { ExecutionDeviceConfig, ExecutionDeviceSshConfig } from '../../types';
import {
  buildOpenSshArgv,
  buildRemoteHelperShellCommand,
  createOpenSshRunner,
  defaultProbeTimeoutMs,
  deviceProbeHostLabel,
  type OpenSshRunner,
} from './opensshRunner';
import {
  isRemoteHelperVersionCompatible,
  mapSshFailureToProbeError,
  parseRemoteHelperEnvelope,
  type RemoteHelperProbeData,
  type RemoteHelperVersionData,
} from './remoteHelperProtocol';
import { readBundledRemoteHelperSource, remoteHelperInstallPaths } from './remoteHelperPath';
import { FLUXX_REMOTE_HELPER_VERSION } from '../../remoteHelper/constants';

export type RemoteHelperClientDeps = {
  runner?: OpenSshRunner;
  readHelperSource?: () => Promise<string>;
};

export class RemoteHelperClient {
  private runner: OpenSshRunner;
  private readHelperSource: () => Promise<string>;

  constructor(deps: RemoteHelperClientDeps = {}) {
    this.runner = deps.runner ?? createOpenSshRunner();
    this.readHelperSource = deps.readHelperSource ?? readBundledRemoteHelperSource;
  }

  async runVersion(device: ExecutionDeviceConfig): Promise<
    | { ok: true; version: string }
    | { ok: false; missing: true; sshError: ReturnType<typeof mapSshFailureToProbeError> }
    | { ok: false; missing: false; sshError: ReturnType<typeof mapSshFailureToProbeError> }
  > {
    const ssh = requireSsh(device);
    const argv = buildOpenSshArgv({
      ssh,
      remoteCommand: buildRemoteHelperShellCommand('version'),
    });
    const result = await this.runner.run({
      argv,
      timeoutMs: defaultProbeTimeoutMs(ssh),
    });
    if (result.exitCode !== 0 || result.timedOut || result.error) {
      const sshError = mapSshFailureToProbeError(result);
      return { ok: false, missing: sshError.code === 'SSH_HELPER_MISSING', sshError };
    }
    try {
      const envelope = parseRemoteHelperEnvelope<RemoteHelperVersionData>(result.stdout);
      if (!envelope.ok) {
        return {
          ok: false,
          missing: false,
          sshError: { code: 'INTERNAL', message: envelope.error.message },
        };
      }
      return { ok: true, version: envelope.data.version };
    } catch (err) {
      return {
        ok: false,
        missing: true,
        sshError: {
          code: 'SSH_HELPER_MISSING',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async ensureInstalled(device: ExecutionDeviceConfig): Promise<
    | { ok: true; version: string }
    | { ok: false; phase: 'helper-handshake' | 'helper-bootstrap'; message: string }
  > {
    const versionCheck = await this.runVersion(device);
    if (versionCheck.ok && isRemoteHelperVersionCompatible(versionCheck.version)) {
      return versionCheck;
    }

    if (!versionCheck.ok && !versionCheck.missing) {
      const code = versionCheck.sshError.code;
      if (
        code === 'SSH_AUTH_FAILED' ||
        code === 'SSH_HOST_KEY_FAILED' ||
        code === 'SSH_TIMEOUT' ||
        code === 'SSH_CONNECT_FAILED'
      ) {
        return {
          ok: false,
          phase: 'helper-handshake',
          message: `${deviceProbeHostLabel(device)} (${code}): ${versionCheck.sshError.message}`,
        };
      }
    }

    try {
      await this.bootstrap(device);
    } catch (err) {
      return {
        ok: false,
        phase: 'helper-bootstrap',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const after = await this.runVersion(device);
    if (!after.ok) {
      return {
        ok: false,
        phase: 'helper-bootstrap',
        message: `${deviceProbeHostLabel(device)}: ${after.sshError.message}`,
      };
    }
    if (!isRemoteHelperVersionCompatible(after.version)) {
      return {
        ok: false,
        phase: 'helper-bootstrap',
        message: `${deviceProbeHostLabel(device)}: helper version mismatch (remote ${after.version}, expected ${FLUXX_REMOTE_HELPER_VERSION})`,
      };
    }
    return after;
  }

  async probe(
    device: ExecutionDeviceConfig,
    request: Record<string, unknown>,
  ): Promise<
    | { ok: true; version: string; capabilities: RemoteHelperProbeData }
    | {
        ok: false;
        code: string;
        message: string;
        capabilities?: RemoteHelperProbeData;
      }
  > {
    const ssh = requireSsh(device);
    const argv = buildOpenSshArgv({
      ssh,
      remoteCommand: buildRemoteHelperShellCommand('probe'),
    });
    const result = await this.runner.run({
      argv,
      stdin: `${JSON.stringify(request)}\n`,
      timeoutMs: defaultProbeTimeoutMs(ssh) + 60_000,
    });
    const parsedProbe = tryParseRemoteHelperProbeOutput(result.stdout);
    if (parsedProbe) {
      return parsedProbe;
    }
    if (result.exitCode !== 0 || result.timedOut || result.error) {
      const mapped = mapSshFailureToProbeError(result);
      return { ok: false, code: mapped.code, message: mapped.message };
    }
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Remote helper returned no JSON output',
    };
  }

  async runJsonCommand<T>(
    device: ExecutionDeviceConfig,
    command: string,
    request: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<
    | { ok: true; version: string; data: T }
    | { ok: false; code: string; message: string }
  > {
    const ssh = requireSsh(device);
    const argv = buildOpenSshArgv({
      ssh,
      remoteCommand: buildRemoteHelperShellCommand(command),
    });
    const result = await this.runner.run({
      argv,
      stdin: `${JSON.stringify(request)}\n`,
      timeoutMs: timeoutMs ?? defaultProbeTimeoutMs(ssh) + 120_000,
    });
    const parsed = tryParseRemoteHelperJsonOutput<T>(result.stdout);
    if (parsed) {
      return parsed;
    }
    if (result.exitCode !== 0 || result.timedOut || result.error) {
      const mapped = mapSshFailureToProbeError(result);
      return { ok: false, code: mapped.code, message: mapped.message };
    }
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Remote helper returned no JSON output',
    };
  }

  private async bootstrap(device: ExecutionDeviceConfig): Promise<void> {
    const ssh = requireSsh(device);
    const source = await this.readHelperSource();
    const paths = remoteHelperInstallPaths();
    const mkdirArgv = buildOpenSshArgv({
      ssh,
      remoteCommand: ['sh', '-c', paths.mkdirScript],
    });
    const mkdirResult = await this.runner.run({
      argv: mkdirArgv,
      timeoutMs: defaultProbeTimeoutMs(ssh),
    });
    if (mkdirResult.exitCode !== 0 || mkdirResult.timedOut || mkdirResult.error) {
      const mapped = mapSshFailureToProbeError(mkdirResult);
      throw new Error(mapped.message);
    }

    const uploadArgv = buildOpenSshArgv({
      ssh,
      remoteCommand: ['sh', '-c', paths.uploadScript],
    });
    const uploadResult = await this.runner.run({
      argv: uploadArgv,
      stdin: source,
      timeoutMs: defaultProbeTimeoutMs(ssh) + 30_000,
    });
    if (uploadResult.exitCode !== 0 || uploadResult.timedOut || uploadResult.error) {
      const mapped = mapSshFailureToProbeError(uploadResult);
      throw new Error(mapped.message);
    }

    const linkArgv = buildOpenSshArgv({
      ssh,
      remoteCommand: ['sh', '-c', paths.linkScript],
    });
    const linkResult = await this.runner.run({
      argv: linkArgv,
      timeoutMs: defaultProbeTimeoutMs(ssh),
    });
    if (linkResult.exitCode !== 0 || linkResult.timedOut || linkResult.error) {
      const mapped = mapSshFailureToProbeError(linkResult);
      throw new Error(mapped.message);
    }
  }
}

function requireSsh(device: ExecutionDeviceConfig): ExecutionDeviceSshConfig {
  if (device.kind !== 'ssh' || !device.ssh) {
    throw new Error('SSH device config is required');
  }
  return device.ssh;
}

function tryParseRemoteHelperProbeOutput(
  stdout: string,
):
  | { ok: true; version: string; capabilities: RemoteHelperProbeData }
  | {
      ok: false;
      code: string;
      message: string;
      capabilities?: RemoteHelperProbeData;
    }
  | null {
  if (!stdout.trim()) return null;
  try {
    const envelope = parseRemoteHelperEnvelope<RemoteHelperProbeData>(stdout);
    if (envelope.ok) {
      return {
        ok: true,
        version: envelope.version,
        capabilities: envelope.data,
      };
    }
    return {
      ok: false,
      code: envelope.error.code,
      message: envelope.error.message,
      capabilities: envelope.data,
    };
  } catch {
    return null;
  }
}

function tryParseRemoteHelperJsonOutput<T>(
  stdout: string,
):
  | { ok: true; version: string; data: T }
  | { ok: false; code: string; message: string }
  | null {
  if (!stdout.trim()) return null;
  try {
    const envelope = parseRemoteHelperEnvelope<T>(stdout);
    if (envelope.ok) {
      return { ok: true, version: envelope.version, data: envelope.data };
    }
    return {
      ok: false,
      code: envelope.error.code,
      message: envelope.error.message,
    };
  } catch {
    return null;
  }
}
