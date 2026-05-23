import { randomUUID } from 'node:crypto';
import type {
  Agent,
  ExecutionDeviceConfig,
  Session,
  Task,
} from '../../types';
import { buildFluxxTmuxSessionName } from '../tmux/tmuxSessionName';
import { agentCommandForAgent } from './agentCliCommands';
import { RemoteHelperClient } from './RemoteHelperClient';
import type {
  RemoteHelperListTerminalsData,
  RemoteHelperRepoEnsureData,
  RemoteHelperStartTerminalData,
  RemoteHelperWorktreeCreateData,
} from './remoteHelperProtocol';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';
import { remoteTaskWorktreePath } from './remoteWorkspacePaths';
import { deviceProbeHostLabel } from './opensshRunner';
import type { RemoteRepoSessionContext } from './resolveRemoteRepoForTask';

export type RemoteContextFile = {
  relativePath: string;
  content: string;
};

export type GitRemoteWorkspaceCreateParams = {
  device: ExecutionDeviceConfig;
  projectId: string;
  task: Pick<Task, 'id' | 'title' | 'fluxxWorkBranch' | 'agent'>;
  repo: RemoteRepoSessionContext;
  sourceBranchShort: string;
  createSourceBranchIfMissing: boolean;
  command: string;
  args: string[];
  contextFiles?: RemoteContextFile[];
  setupScript?: string;
  setupTimeoutMs?: number;
  hostLabel?: string;
};

export type GitRemoteWorkspaceCreateResult =
  | {
      ok: true;
      session: Session;
      tmuxSessionName: string;
      manifestRow: RemoteHelperListTerminalsData['terminals'][number];
    }
  | { ok: false; code: string; message: string };

export class GitRemoteWorkspaceProvider {
  constructor(private helper: RemoteHelperClient = new RemoteHelperClient()) {}

  async createTaskWorkspaceAndStart(
    params: GitRemoteWorkspaceCreateParams,
  ): Promise<GitRemoteWorkspaceCreateResult> {
    const device = params.device;
    if (device.kind !== 'ssh') {
      return { ok: false, code: 'INTERNAL', message: 'Git remote workspace requires an SSH device' };
    }

    const install = await this.helper.ensureInstalled(device);
    if (!install.ok) {
      const code =
        install.phase === 'helper-bootstrap'
          ? 'SSH_HELPER_MISSING'
          : 'SSH_CONNECT_FAILED';
      return { ok: false, code, message: install.message };
    }

    const hostLabel = params.hostLabel ?? deviceProbeHostLabel(device);
    const terminalId = randomUUID();
    const tmuxSessionName = buildFluxxTmuxSessionName({
      kind: 'task',
      projectSlugSource: params.projectId,
      terminalId,
    });
    const worktreePath = remoteTaskWorktreePath(
      device.workspaceRoot,
      params.projectId,
      params.repo.repoId,
      params.task.id,
    );

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

    const repoEnsure = await this.helper.runJsonCommand<RemoteHelperRepoEnsureData>(
      device,
      'repo-ensure',
      {
        workspaceRoot: device.workspaceRoot,
        projectId: params.projectId,
        repoId: params.repo.repoId,
        remoteUrl: params.repo.remoteUrl,
        repoLabel: params.repo.label,
      },
    );
    if (!repoEnsure.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(repoEnsure.code),
        message: formatRemoteRepoFailure(hostLabel, params.repo, repoEnsure.message),
      };
    }

    const worktree = await this.helper.runJsonCommand<RemoteHelperWorktreeCreateData>(
      device,
      'worktree-create',
      {
        workspaceRoot: device.workspaceRoot,
        projectId: params.projectId,
        repoId: params.repo.repoId,
        taskId: params.task.id,
        taskTitle: params.task.title,
        fluxxWorkBranch: params.task.fluxxWorkBranch,
        repoPath: repoEnsure.data.repoPath,
        worktreePath,
        sourceBranchShort: params.sourceBranchShort,
        createSourceBranchIfMissing: params.createSourceBranchIfMissing,
        baseBranch: params.repo.baseBranch,
        setupScript: params.setupScript,
        setupTimeoutMs: params.setupTimeoutMs ?? 300_000,
        contextFiles: params.contextFiles ?? [],
      },
      600_000,
    );
    if (!worktree.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(worktree.code),
        message: worktree.message,
      };
    }

    const started = await this.helper.runJsonCommand<RemoteHelperStartTerminalData>(
      device,
      'start-terminal',
      {
        terminalId,
        deviceId: device.id,
        hostLabel,
        projectId: params.projectId,
        repoId: params.repo.repoId,
        taskId: params.task.id,
        agent: params.task.agent,
        cwd: worktree.data.worktreePath,
        tmuxSessionName,
        command: params.command,
        args: params.args,
        cols: 80,
        rows: 24,
        fluxxWorkBranch: worktree.data.branch,
        sourceBranchShort: params.sourceBranchShort,
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
      repoId: params.repo.repoId,
      worktreePath: worktree.data.worktreePath,
      branch: worktree.data.branch,
      status: 'running',
      startedAt: started.data.startedAt,
      deviceId: device.id,
      deviceKind: 'ssh',
      deviceLabel: device.displayName,
      remotePath: worktree.data.worktreePath,
    };

    const manifestRow: RemoteHelperListTerminalsData['terminals'][number] = {
      id: terminalId,
      kind: 'task',
      runtime: 'tmux',
      projectId: params.projectId,
      repoId: params.repo.repoId,
      deviceId: device.id,
      deviceKind: 'ssh',
      hostLabel,
      cwd: worktree.data.worktreePath,
      tmuxSessionName,
      command: params.command,
      args: params.args,
      startedAt: started.data.startedAt,
      task: {
        taskId: params.task.id,
        agent: params.task.agent as Agent,
        worktreePath: worktree.data.worktreePath,
        fluxxWorkBranch: worktree.data.branch,
        ...(params.sourceBranchShort ? { sourceBranchShort: params.sourceBranchShort } : {}),
      },
    };

    return {
      ok: true,
      session,
      tmuxSessionName,
      manifestRow,
    };
  }

  async listRemoteTerminals(
    device: ExecutionDeviceConfig,
  ): Promise<
    | { ok: true; terminals: RemoteHelperListTerminalsData['terminals'] }
    | { ok: false; code: string; message: string }
  > {
    const result = await this.helper.runJsonCommand<RemoteHelperListTerminalsData>(
      device,
      'list-terminals',
      { deviceId: device.id },
    );
    if (!result.ok) {
      return result;
    }
    return { ok: true, terminals: result.data.terminals };
  }
}

function formatRemoteRepoFailure(
  hostLabel: string,
  repo: RemoteRepoSessionContext,
  detail: string,
): string {
  return `${hostLabel}: could not clone or fetch "${repo.label}" (${repo.remoteUrl}). ${detail} Configure git credentials on the SSH host or choose a different remote URL.`;
}
