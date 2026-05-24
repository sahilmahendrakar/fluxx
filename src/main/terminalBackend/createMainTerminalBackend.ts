import {
  deliverTerminalStreamFrameToRenderers,
  type TerminalRuntimeManagerOptions,
} from '../TerminalRuntimeManager';
import type { DeviceStore } from '../DeviceStore';
import { LocalMainProcessTerminalBackend } from './LocalMainProcessTerminalBackend';
import { RoutingTerminalBackend } from './RoutingTerminalBackend';
import { SshTerminalBackend } from './SshTerminalBackend';
import type { TerminalBackend } from './TerminalBackend';

export type MainTerminalBackendOptions = TerminalRuntimeManagerOptions & {
  deviceStore?: DeviceStore;
};

/**
 * Terminal backend for `main.ts`: local PTYs plus SSH attach bridges behind a
 * single {@link TerminalBackend} router.
 */
export function createMainTerminalBackend(opts: MainTerminalBackendOptions = {}): TerminalBackend {
  const local = new LocalMainProcessTerminalBackend({
    deliverStreamFrame: deliverTerminalStreamFrameToRenderers,
    ...opts,
  });
  if (!opts.deviceStore) {
    return local;
  }
  const ssh = new SshTerminalBackend({
    deviceStore: opts.deviceStore,
    deliverStreamFrame: opts.deliverStreamFrame ?? deliverTerminalStreamFrameToRenderers,
  });
  return new RoutingTerminalBackend(local, ssh);
}

export function sshTerminalBackendFrom(
  backend: TerminalBackend | null | undefined,
): SshTerminalBackend | null {
  if (backend instanceof RoutingTerminalBackend) {
    return backend.ssh;
  }
  if (backend instanceof SshTerminalBackend) {
    return backend;
  }
  return null;
}

export function localTerminalBackendFrom(
  backend: TerminalBackend | null | undefined,
): LocalMainProcessTerminalBackend | null {
  if (backend instanceof RoutingTerminalBackend) {
    return backend.local;
  }
  if (backend instanceof LocalMainProcessTerminalBackend) {
    return backend;
  }
  return null;
}
