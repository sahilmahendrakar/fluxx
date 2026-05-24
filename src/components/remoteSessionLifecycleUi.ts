import type { Session } from '../types';
import type { RemoteSessionLifecycleStatus } from '../types';

export function remoteLifecycleStatusHeading(status: RemoteSessionLifecycleStatus): string {
  switch (status) {
    case 'device-unreachable':
      return 'SSH device unreachable';
    case 'tmux-missing':
      return 'Remote tmux session missing';
    case 'helper-mismatch':
      return 'Remote helper mismatch';
    case 'workspace-missing':
      return 'Remote workspace missing';
    default:
      return 'Remote session interrupted';
  }
}

export function remoteLifecycleStatusDetail(
  status: RemoteSessionLifecycleStatus,
  session: Pick<Session, 'deviceLabel' | 'remotePath'>,
): string {
  const host = session.deviceLabel?.trim() || 'SSH device';
  switch (status) {
    case 'device-unreachable':
      return `${host} is offline or could not be reached over SSH. Your task metadata is unchanged — reopen when the host is available to reattach.`;
    case 'tmux-missing':
      return `The Fluxx-owned tmux session on ${host} is no longer running. You can start a new session or clean up the remote workspace from the task.`;
    case 'helper-mismatch':
      return `The remote helper on ${host} is missing or out of date. Open Settings → Devices and run Probe to install or update the helper.`;
    case 'workspace-missing':
      return session.remotePath
        ? `The remote worktree ${session.remotePath} no longer exists on ${host}.`
        : `The remote worktree for this task no longer exists on ${host}.`;
    default:
      return 'This remote session cannot attach right now.';
  }
}
