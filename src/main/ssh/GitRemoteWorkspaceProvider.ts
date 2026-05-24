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
  RemoteHelperWorktreeRemoveData,
} from './remoteHelperProtocol';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';
import { remoteRepoCachePath, remoteTaskWorktreePath } from './remoteWorkspacePaths';
import { deviceProbeHostLabel } from './opensshRunner';
import type { RemoteRepoSessionContext } from './resolveRemoteRepoForTask';

const LEGACY_WORKTREE_BRANCH_MISMATCH =
  'exists but is not on branch';

export type RemoteContextFile = {
  relativePath: string;
  content: string;
};

export type GitRemoteWorkspaceCreateParams = {
  device: ExecutionDeviceConfig;
  projectId: string;
  task: Pick<Task, 'id' | 'title' | 'fluxxWorkBranch' | 'agent'>;
  repo: RemoteRepoSessionContext;
  /** When set, use this existing remote clone instead of Fluxx-managed storage. */
  boundRepoPath?: string;
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

    const boundRepoPath = params.boundRepoPath?.trim();
    const repoEnsure = await this.helper.runJsonCommand<RemoteHelperRepoEnsureData>(
      device,
      'repo-ensure',
      {
        workspaceRoot: device.workspaceRoot,
        projectId: params.projectId,
        repoId: params.repo.repoId,
        remoteUrl: params.repo.remoteUrl,
        repoLabel: params.repo.label,
        ...(boundRepoPath ? { repoPath: boundRepoPath } : {}),
      },
    );
    if (!repoEnsure.ok) {
      return {
        ok: false,
        code: mapRemoteHelperCodeToSessionStart(repoEnsure.code),
        message: formatRemoteRepoFailure(hostLabel, params.repo, repoEnsure.message),
      };
    }

    const worktreeCreatePayload = {
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
    };

    let worktree = await this.helper.runJsonCommand<RemoteHelperWorktreeCreateData>(
      device,
      'worktree-create',
      worktreeCreatePayload,
      600_000,
    );
    if (
      !worktree.ok &&
      worktree.message.includes(LEGACY_WORKTREE_BRANCH_MISMATCH)
    ) {
      const reinstall = await this.helper.ensureInstalled(device, {
        forceRebootstrap: true,
      });
      if (reinstall.ok) {
        worktree = await this.helper.runJsonCommand<RemoteHelperWorktreeCreateData>(
          device,
          'worktree-create',
          worktreeCreatePayload,
          600_000,
        );
      }
    }
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

  async stopOpenTerminalsForTask(
    device: ExecutionDeviceConfig,
    taskId: string,
    projectId: string,
  ): Promise<string[]> {
    const errors: string[] = [];
    const listed = await this.listRemoteTerminals(device);
    if (!listed.ok) {
      errors.push(listed.message);
      return errors;
    }
    const matches = listed.terminals.filter((row) => {
      if (row.projectId !== projectId) return false;
      if (row.endedAt) return false;
      if (row.kind === 'task' && row.task?.taskId === taskId) return true;
      if (row.kind === 'shell' && row.shell) {
        const parent = listed.terminals.find((t) => t.id === row.shell!.parentSessionId);
        return parent?.task?.taskId === taskId;
      }
      return false;
    });

    const shellRows = matches.filter((r) => r.kind === 'shell');
    const taskRows = matches.filter((r) => r.kind === 'task');
    for (const row of [...shellRows, ...taskRows]) {
      const stopped = await this.helper.runJsonCommand(device, 'stop-terminal', {
        terminalId: row.id,
        deviceId: device.id,
        reason: 'workspace-deleted',
      });
      if (!stopped.ok) {
        errors.push(`stop-terminal ${row.id}: ${stopped.message}`);
      }
    }
    return errors;
  }

  async removeTaskWorktree(
    device: ExecutionDeviceConfig,
    input: {
      projectId: string;
      repoId: string;
      taskId: string;
      worktreePath?: string;
      /** Main repo root (bound clone or Fluxx cache); defaults to managed cache path. */
      repoPath?: string;
    },
  ): Promise<string | null> {
    if (device.kind !== 'ssh') return 'Device is not SSH';
    const worktreePath =
      input.worktreePath?.trim() ||
      remoteTaskWorktreePath(device.workspaceRoot, input.projectId, input.repoId, input.taskId);
    const repoPath =
      input.repoPath?.trim() ||
      remoteRepoCachePath(device.workspaceRoot, input.projectId, input.repoId);
    const result = await this.helper.runJsonCommand<RemoteHelperWorktreeRemoveData>(
      device,
      'worktree-remove',
      { worktreePath, repoPath },
    );
    if (!result.ok) return result.message;
    return null;
  }
}

function formatRemoteRepoFailure(
  hostLabel: string,
  repo: RemoteRepoSessionContext,
  detail: string,
): string {
  return `${hostLabel}: could not clone or fetch "${repo.label}" (${repo.remoteUrl}). ${detail} Configure git credentials on the SSH host or choose a different remote URL.`;
}
