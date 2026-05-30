import { randomUUID } from 'node:crypto';
import type { Agent, ExecutionDeviceConfig, Session, Task } from '../../types';
import { buildFluxxTmuxSessionName } from '../tmux/tmuxSessionName';
import { agentCommandForAgent } from './agentCliCommands';
import { RemoteHelperClient } from './RemoteHelperClient';
import type {
  RemoteHelperListTerminalsData,
  RemoteHelperPrepareDirectFolderData,
  RemoteHelperStartTerminalData,
} from './remoteHelperProtocol';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';
import { deviceProbeHostLabel } from './opensshRunner';
import type { RemoteContextFile } from './GitRemoteWorkspaceProvider';

export type DirectRemoteFolderCreateParams = {
  device: ExecutionDeviceConfig;
  projectId: string;
  task: Pick<Task, 'id' | 'agent'>;
  repoId: string;
  folderPath: string;
  command: string;
  args: string[];
  contextFiles?: RemoteContextFile[];
  hostLabel?: string;
};

export type DirectRemoteFolderCreateResult =
  | {
      ok: true;
      session: Session;
      tmuxSessionName: string;
      manifestRow: RemoteHelperListTerminalsData['terminals'][number];
    }
  | { ok: false; code: string; message: string };

export class DirectRemoteFolderWorkspaceProvider {
  constructor(private helper: RemoteHelperClient = new RemoteHelperClient()) {}

  async createTaskWorkspaceAndStart(
    params: DirectRemoteFolderCreateParams,
  ): Promise<DirectRemoteFolderCreateResult> {
    const device = params.device;
    if (device.kind !== 'ssh') {
      return { ok: false, code: 'INTERNAL', message: 'Direct remote workspace requires an SSH device' };
    }

    const install = await this.helper.ensureInstalled(device);
    if (!install.ok) {
      const code =
        install.phase === 'helper-bootstrap' ? 'SSH_HELPER_MISSING' : 'SSH_CONNECT_FAILED';
      return { ok: false, code, message: install.message };
    }

    const hostLabel = params.hostLabel ?? deviceProbeHostLabel(device);
    const folderPath = params.folderPath.trim();
    if (!folderPath) {
      return { ok: false, code: 'INTERNAL', message: 'Bound remote folder path is required.' };
    }

    const agentCommand = params.task.agent ? agentCommandForAgent(params.task.agent) : null;
    if (agentCommand) {
      const agentProbe = await this.helper.runJsonCommand<{ found: boolean }>(
        device,
        'probe-agent',
        { command: agentCommand },
        30_000,
      );
      if (!agentProbe.ok) {
        return {
          ok: false,
          code: mapRemoteHelperCodeToSessionStart(agentProbe.code),
          message: agentProbe.message,
        };
      }
      if (!agentProbe.data.found) {
        return {
          ok: false,
          code: 'REMOTE_AGENT_NOT_FOUND',
          message: `Agent CLI "${agentCommand}" was not found on ${hostLabel}. Install it on the SSH host or choose a different agent.`,
        };
      }
    }

    const prepared = await this.helper.runJsonCommand<RemoteHelperPrepareDirectFolderData>(
      device,
      'prepare-direct-folder',
      {
        folderPath,
        contextFiles: params.contextFiles ?? [],
      },
      120_000,
    );
    if (!prepared.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(prepared.code),
        message: `${hostLabel}: ${prepared.message}`,
      };
    }

    const cwd = prepared.data.folderPath;
    const terminalId = randomUUID();
    const tmuxSessionName = buildFluxxTmuxSessionName({
      kind: 'task',
      projectSlugSource: params.projectId,
      terminalId,
    });

    const started = await this.helper.runJsonCommand<RemoteHelperStartTerminalData>(
      device,
      'start-terminal',
      {
        terminalId,
        deviceId: device.id,
        hostLabel,
        projectId: params.projectId,
        repoId: params.repoId,
        taskId: params.task.id,
        agent: params.task.agent,
        cwd,
        tmuxSessionName,
        command: params.command,
        args: params.args,
        cols: 80,
        rows: 24,
        fluxxWorkBranch: '',
      },
    );
    if (!started.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(started.code),
        message: started.message,
      };
    }

    const session: Session = {
      id: terminalId,
      taskId: params.task.id,
      projectId: params.projectId,
      repoId: params.repoId,
      worktreePath: cwd,
      branch: '',
      workspaceKind: 'direct',
      status: 'running',
      startedAt: started.data.startedAt,
      deviceId: device.id,
      deviceKind: 'ssh',
      deviceLabel: device.displayName,
      remotePath: cwd,
    };

    const manifestRow: RemoteHelperListTerminalsData['terminals'][number] = {
      id: terminalId,
      kind: 'task',
      runtime: 'tmux',
      projectId: params.projectId,
      repoId: params.repoId,
      deviceId: device.id,
      deviceKind: 'ssh',
      hostLabel,
      cwd,
      tmuxSessionName,
      command: params.command,
      args: params.args,
      startedAt: started.data.startedAt,
      task: {
        taskId: params.task.id,
        agent: params.task.agent as Agent,
        worktreePath: cwd,
        fluxxWorkBranch: '',
      },
    };

    return {
      ok: true,
      session,
      tmuxSessionName,
      manifestRow,
    };
  }
}

export function remoteFolderRequiredMessage(deviceDisplayName: string): string {
  const label = deviceDisplayName.trim() || 'this SSH device';
  return (
    `Git integration is off for this project. Bind a remote folder for “${label}” in Project settings before starting a task session on that device.`
  );
}
