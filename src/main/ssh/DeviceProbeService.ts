import type {
  DeviceProbeErrorCode,
  DeviceProbeResult,
} from '../../types';
import type { DeviceStore } from '../DeviceStore';
import { deviceProbeHostLabel } from './opensshRunner';
import { mapHelperErrorCode } from './remoteHelperProtocol';
import { RemoteHelperClient } from './RemoteHelperClient';
import {
  resolveDeviceProbeProjectContext,
  type DeviceProbeContextResolver,
} from './deviceProbeContext';
import {
  STANDARD_AGENT_CLI_COMMANDS,
  buildAvailableProbeMessage,
} from '../../executionDevices/probeAgents';

export class DeviceProbeService {
  private deviceStore: DeviceStore;
  private helper: RemoteHelperClient;
  private contextResolver: DeviceProbeContextResolver;

  constructor(
    deviceStore: DeviceStore,
    contextResolver: DeviceProbeContextResolver,
    helper: RemoteHelperClient = new RemoteHelperClient(),
  ) {
    this.deviceStore = deviceStore;
    this.contextResolver = contextResolver;
    this.helper = helper;
  }

  async probeDevice(deviceId: string): Promise<DeviceProbeResult> {
    const device = this.deviceStore.getDevice(deviceId);
    if (!device) {
      throw new Error(`Unknown device id: ${deviceId}`);
    }
    if (device.kind !== 'ssh') {
      throw new Error('Only SSH devices can be probed');
    }

    const probing: DeviceProbeResult = {
      status: 'probing',
      checkedAt: new Date().toISOString(),
      message: 'Probing…',
    };
    await this.deviceStore.setLastProbe(deviceId, probing);

    const hostLabel = deviceProbeHostLabel(device);
    const projectContext = await resolveDeviceProbeProjectContext(this.contextResolver);
    const probeRequest = {
      workspaceRoot: device.workspaceRoot,
      requireTmux: device.tmux.enabled,
      shell: device.shell,
      agentCommands: [...STANDARD_AGENT_CLI_COMMANDS],
      repos: projectContext.repos,
    };

    const installed = await this.helper.ensureInstalled(device);
    if (!installed.ok) {
      const errorCode =
        installed.phase === 'helper-handshake'
          ? mapHandshakePhaseToErrorCode(installed.message)
          : 'SSH_HELPER_BOOTSTRAP_FAILED';
      const result = failureResult({
        phase: installed.phase,
        errorCode,
        message: installed.message,
        hostLabel,
      });
      await this.deviceStore.setLastProbe(deviceId, result);
      return result;
    }

    const probe = await this.helper.probe(device, probeRequest);
    if (!probe.ok) {
      const result = failureResult({
        phase: 'probe',
        errorCode: mapHelperErrorCode(probe.code),
        message: `${hostLabel}: ${probe.message}`,
        capabilities: probe.capabilities,
        helperVersion: installed.version,
      });
      await this.deviceStore.setLastProbe(deviceId, result);
      return result;
    }

    const result: DeviceProbeResult = {
      status: 'available',
      checkedAt: new Date().toISOString(),
      message: buildAvailableProbeMessage(probe.capabilities),
      phase: 'probe',
      capabilities: probe.capabilities,
      helperVersion: installed.version,
    };
    await this.deviceStore.setLastProbe(deviceId, result);
    return result;
  }
}

function failureResult(input: {
  phase: string;
  errorCode: DeviceProbeErrorCode;
  message: string;
  capabilities?: DeviceProbeResult['capabilities'];
  helperVersion?: string;
  hostLabel?: string;
}): DeviceProbeResult {
  return {
    status: 'unavailable',
    checkedAt: new Date().toISOString(),
    phase: input.phase,
    errorCode: input.errorCode,
    message: input.message,
    capabilities: input.capabilities,
    helperVersion: input.helperVersion,
  };
}

function mapHandshakePhaseToErrorCode(message: string): DeviceProbeErrorCode {
  const match = /\((SSH_[A-Z_]+)\):/.exec(message);
  if (match && match[1]) {
    return match[1] as DeviceProbeErrorCode;
  }
  return 'SSH_CONNECT_FAILED';
}
