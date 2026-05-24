import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  Agent,
  CloudProject,
  Project,
  RepoConfig,
  Session,
  SessionStartResult,
  Task,
  TaskExecutionDeviceRef,
} from '../../types';
import {
  agentSpawnResumeSpec,
  agentSpawnSpec,
} from '../agentSpawn';
import { composeTaskSessionInitialPrompt } from '../composeTaskSessionInitialPrompt';
import {
  ensureProjectMcpConfig,
  formatMcpConfig,
  PROJECT_MCP_CONFIG_BASENAME,
  type McpConfig,
} from '../mcpConfig';
import type { TaskAgentSessionRecordStore } from '../taskAgentSessionRecords';
import type { TerminalSessionRecordStore } from '../terminalSessionRecords';
import { isWorktreeCreateError } from '../worktreeCreateError';
import { collectRepoBranchDiscovery } from '../repoGit';
import {
  classifyGitBranchPresence,
  effectiveTaskSourceBranchShort,
  resolveCreateSourceBranchIfMissingForStart,
} from '../../taskBranches';
import { GitRemoteWorkspaceProvider, type RemoteContextFile } from './GitRemoteWorkspaceProvider';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';
import { resolveRemoteRepoForTaskSession } from './resolveRemoteRepoForTask';
import type { SshTerminalBackend } from '../terminalBackend/SshTerminalBackend';
import type { DeviceStore } from '../DeviceStore';
import type { ProjectStore } from '../ProjectStore';
import { trustPromptAutorespondRootsForRemoteWorktree } from '../trustPromptAutorespondRoots';

export type StartSshTaskSessionDeps = {
  deviceStore: DeviceStore;
  projectStore: ProjectStore;
  sshTerminalBackend: SshTerminalBackend;
  gitRemoteWorkspace: GitRemoteWorkspaceProvider;
  taskAgentSessionRecordStore: TaskAgentSessionRecordStore;
  terminalSessionRecordStore: TerminalSessionRecordStore;
  resolvePlanningDocsDir: () => string | null;
  activeProjectDir: () => string;
};

export type StartSshTaskSessionInput = {
  task: Task;
  project: Project;
  executionDevice: TaskExecutionDeviceRef;
  cloudProject?: CloudProject | null;
  options?: { resume?: boolean };
};

export async function startSshTaskSession(
  deps: StartSshTaskSessionDeps,
  input: StartSshTaskSessionInput,
): Promise<SessionStartResult> {
  const { task, project, executionDevice, cloudProject, options } = input;
  if (executionDevice.kind !== 'ssh') {
    return {
      error: 'INTERNAL',
      message: 'SSH session start requires an SSH execution device on the task.',
    };
  }

  const device = deps.deviceStore.getDevice(executionDevice.deviceId);
  if (!device) {
    return {
      error: 'DEVICE_NOT_CONFIGURED',
      message: `SSH device "${executionDevice.deviceId}" is not configured on this machine. Open Settings → Devices to add it.`,
    };
  }
  if (device.kind !== 'ssh' || !device.enabled) {
    return {
      error: 'DEVICE_UNAVAILABLE',
      message: `SSH device "${device.displayName}" is disabled or unavailable.`,
    };
  }
  if (!device.tmux.enabled) {
    return {
      error: 'REMOTE_TMUX_MISSING',
      message: `SSH device "${device.displayName}" requires tmux, but tmux persistence is disabled for this device.`,
    };
  }

  if (task.agent == null) {
    return {
      error: 'NO_TASK_AGENT',
      message:
        'This task has no coding agent assigned. Choose Claude Code, Codex, or Cursor Agent in task details before starting a session.',
    };
  }

  const existing = deps.sshTerminalBackend.findRunningByTaskId(task.id);
  if (existing) {
    return existing;
  }

  const projectDir = deps.activeProjectDir();
  let projectMcpConfig: Awaited<ReturnType<typeof ensureProjectMcpConfig>>;
  try {
    projectMcpConfig = await ensureProjectMcpConfig(projectDir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: 'INTERNAL',
      message: `Could not load MCP configuration: ${message}`,
    };
  }

  const repos = await deps.projectStore.getReposAt(projectDir);
  let remoteRepo;
  try {
    remoteRepo = await resolveRemoteRepoForTaskSession(project, task, repos, cloudProject);
  } catch (err: unknown) {
    if (isWorktreeCreateError(err)) {
      return { error: err.code, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: 'INTERNAL', message };
  }

  const sourceOpts = await resolveRemoteSourceBranchOpts(task, repos, remoteRepo.baseBranch);

  let resumeConversationId: string | undefined;
  if (options?.resume) {
    resumeConversationId = await deps.taskAgentSessionRecordStore.getResumeConversationId(
      task.id,
      task.agent,
    );
  }

  const { command, args } = options?.resume
    ? agentSpawnResumeSpec(task, {
        agentConversationId: resumeConversationId,
        mcpConfigPath: path.join('.cursor', PROJECT_MCP_CONFIG_BASENAME),
      })
    : agentSpawnSpec(
        task,
        await composeTaskSessionInitialPrompt(
          task,
          deps.resolvePlanningDocsDir() ?? path.join(projectDir, 'planning'),
        ),
        { mcpConfigPath: path.join('.cursor', PROJECT_MCP_CONFIG_BASENAME) },
      );

  const contextFiles = buildRemoteAgentContextFiles(task.agent, projectMcpConfig.config);

  const started = await deps.gitRemoteWorkspace.createTaskWorkspaceAndStart({
    device,
    projectId: project.id,
    task: {
      id: task.id,
      title: task.title,
      fluxxWorkBranch: task.fluxxWorkBranch,
      agent: task.agent,
    },
    repo: remoteRepo,
    sourceBranchShort: sourceOpts.sourceBranchShort,
    createSourceBranchIfMissing: sourceOpts.createSourceBranchIfMissing,
    command,
    args,
    contextFiles,
    setupScript: remoteRepo.setupScript,
  });

  if (!started.ok) {
    return {
      error: mapRemoteHelperCodeToSessionStart(started.code),
      message: started.message,
    };
  }

  deps.sshTerminalBackend.registerTaskSession({
    session: started.session,
    deviceId: device.id,
    tmuxSessionName: started.tmuxSessionName,
    agent: task.agent ?? undefined,
    cols: 80,
    rows: 24,
  ...(project.autoRespondToTrustPrompts === true
    ? {
        trustPromptAutorespond: true,
        trustPromptAutorespondRoots: trustPromptAutorespondRootsForRemoteWorktree(
          started.session.worktreePath,
        ),
      }
    : {}),
  });

  const sourceBranchShort = sourceOpts.sourceBranchShort || undefined;
  void deps.taskAgentSessionRecordStore.recordSessionStart({
    fluxxSessionId: started.session.id,
    taskId: task.id,
    projectId: project.id,
    repoId: remoteRepo.repoId,
    agent: task.agent,
    worktreePath: started.session.worktreePath,
    fluxxWorkBranch: started.session.branch,
    ...(sourceBranchShort ? { sourceBranchShort } : {}),
    startedAt: started.session.startedAt,
    deviceId: device.id,
    deviceKind: 'ssh',
    deviceLabel: device.displayName,
  });

  void deps.terminalSessionRecordStore.recordTerminalStart({
    id: started.session.id,
    kind: 'task',
    runtime: 'tmux',
    projectId: project.id,
    repoId: remoteRepo.repoId,
    deviceId: device.id,
    deviceKind: 'ssh',
    hostLabel: started.manifestRow.hostLabel,
    cwd: started.session.worktreePath,
    tmuxSessionName: started.tmuxSessionName,
    command,
    args,
    cols: 80,
    rows: 24,
    startedAt: started.session.startedAt,
    task: {
      taskId: task.id,
      agent: task.agent,
      worktreePath: started.session.worktreePath,
      fluxxWorkBranch: started.session.branch,
      ...(sourceBranchShort ? { sourceBranchShort } : {}),
    },
  });

  return started.session;
}

async function resolveRemoteSourceBranchOpts(
  task: Task,
  repos: RepoConfig[],
  baseBranch: string,
): Promise<{ sourceBranchShort: string; createSourceBranchIfMissing: boolean }> {
  const repoCfg = repos.find((r) => r.id === (task.repoId?.trim() || repos[0]?.id));
  const localRoot = repoCfg?.rootPath?.trim();
  if (localRoot) {
    try {
      await fs.access(path.join(path.resolve(localRoot), '.git'));
      const discovery = await collectRepoBranchDiscovery(localRoot, baseBranch);
      const sourceEff =
        effectiveTaskSourceBranchShort(task, discovery.defaultBranchShort) ||
        discovery.defaultBranchShort ||
        baseBranch ||
        'main';
      const { presence } = classifyGitBranchPresence(
        sourceEff,
        discovery.localBranches,
        discovery.remoteBranches,
      );
      return {
        sourceBranchShort: sourceEff,
        createSourceBranchIfMissing: resolveCreateSourceBranchIfMissingForStart(task, presence),
      };
    } catch {
      // fall through to task-only resolution
    }
  }

  const sourceEff =
    effectiveTaskSourceBranchShort(task, baseBranch) || baseBranch || 'main';
  return {
    sourceBranchShort: sourceEff,
    createSourceBranchIfMissing: task.createSourceBranchIfMissing === true,
  };
}

function buildRemoteAgentContextFiles(agent: Agent, projectConfig: McpConfig): RemoteContextFile[] {
  if (agent !== 'cursor') {
    return [];
  }
  return [
    {
      relativePath: path.join('.cursor', PROJECT_MCP_CONFIG_BASENAME),
      content: formatMcpConfig(projectConfig),
    },
  ];
}
