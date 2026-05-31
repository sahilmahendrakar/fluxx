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
import {
  DirectRemoteFolderWorkspaceProvider,
  remoteFolderRequiredMessage,
} from './DirectRemoteFolderWorkspaceProvider';
import { GitRemoteWorkspaceProvider, type RemoteContextFile } from './GitRemoteWorkspaceProvider';
import { mapRemoteHelperCodeToSessionStart } from './remoteSessionErrors';
import { resolveRemoteRepoForTaskSession } from './resolveRemoteRepoForTask';
import type { SshTerminalBackend } from '../terminalBackend/SshTerminalBackend';
import type { DeviceStore } from '../DeviceStore';
import type { LocalBindingStore } from '../LocalBindingStore';
import type { ProjectStore } from '../ProjectStore';
import { trustPromptAutorespondRootsForRemoteWorktree } from '../trustPromptAutorespondRoots';
import { resolveRemoteRepoBindingForSession } from './RemoteRepoBindingService';
import {
  buildGitlessWorkspaceBusyKey,
  findGitlessWorkspaceBusyHolder,
  workspaceBusyErrorMessage,
} from '../gitlessWorkspaceBusy';

export type StartSshTaskSessionDeps = {
  deviceStore: DeviceStore;
  projectStore: ProjectStore;
  bindingStore: LocalBindingStore;
  sshTerminalBackend: SshTerminalBackend;
  gitRemoteWorkspace: GitRemoteWorkspaceProvider;
  directRemoteWorkspace: DirectRemoteFolderWorkspaceProvider;
  taskAgentSessionRecordStore: TaskAgentSessionRecordStore;
  terminalSessionRecordStore: TerminalSessionRecordStore;
  resolvePlanningDocsDir: () => string | null;
  activeProjectDir: () => string;
  gitEnabledForProject: () => Promise<boolean>;
  gitlessSingleSessionPerFolderForProject: () => Promise<boolean>;
  listRunningSessions: () => Promise<Session[]>;
  resolveTaskTitle?: (taskId: string) => string | undefined;
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

  const gitEnabled = await deps.gitEnabledForProject();
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
    remoteRepo = await resolveRemoteRepoForTaskSession(project, task, repos, cloudProject, {
      gitEnabled,
    });
  } catch (err: unknown) {
    if (isWorktreeCreateError(err)) {
      return { error: err.code, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: 'INTERNAL', message };
  }

  const boundRepoPath = resolveRemoteRepoBindingForSession(
    project,
    device.id,
    remoteRepo.repoId,
    deps.bindingStore,
    project.kind === 'local' ? project.remoteRepoBindings : undefined,
  );

  if (!gitEnabled) {
    if (!boundRepoPath?.trim()) {
      return {
        error: 'REMOTE_FOLDER_REQUIRED',
        message: remoteFolderRequiredMessage(device.displayName),
      };
    }

    const busyKey = buildGitlessWorkspaceBusyKey(boundRepoPath, device.id);
    const runningSessions = await deps.listRunningSessions();
    const busyHolder = findGitlessWorkspaceBusyHolder(runningSessions, busyKey, task.id);
    const singlePerFolder = await deps.gitlessSingleSessionPerFolderForProject();
    if (busyHolder && singlePerFolder) {
      const holderTitle = deps.resolveTaskTitle?.(busyHolder.taskId);
      return {
        error: 'WORKSPACE_BUSY',
        message: workspaceBusyErrorMessage(busyHolder.taskId, holderTitle),
      };
    }

    return startGitlessSshTaskSession(deps, {
      task,
      project,
      device,
      remoteRepo,
      boundRepoPath: boundRepoPath.trim(),
      projectMcpConfig,
      projectDir,
      options,
    });
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
    ...(boundRepoPath ? { boundRepoPath } : {}),
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

  return registerSshTaskSession(deps, {
    task,
    project,
    device,
    remoteRepo,
    started,
    command,
    args,
    sourceBranchShort: sourceOpts.sourceBranchShort || undefined,
  });
}

async function startGitlessSshTaskSession(
  deps: StartSshTaskSessionDeps,
  input: {
    task: Task;
    project: Project;
    device: Extract<
      ReturnType<DeviceStore['getDevice']>,
      { kind: 'ssh'; enabled: true }
    >;
    remoteRepo: Awaited<ReturnType<typeof resolveRemoteRepoForTaskSession>>;
    boundRepoPath: string;
    projectMcpConfig: Awaited<ReturnType<typeof ensureProjectMcpConfig>>;
    projectDir: string;
    options?: { resume?: boolean };
  },
): Promise<SessionStartResult> {
  const { task, project, device, remoteRepo, boundRepoPath, projectMcpConfig, projectDir, options } =
    input;

  let resumeConversationId: string | undefined;
  if (options?.resume) {
    resumeConversationId = await deps.taskAgentSessionRecordStore.getResumeConversationId(
      task.id,
      task.agent!,
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

  const contextFiles = buildRemoteAgentContextFiles(task.agent!, projectMcpConfig.config);

  const started = await deps.directRemoteWorkspace.createTaskWorkspaceAndStart({
    device,
    projectId: project.id,
    task: { id: task.id, agent: task.agent },
    repoId: remoteRepo.repoId,
    folderPath: boundRepoPath,
    command,
    args,
    contextFiles,
  });

  if (!started.ok) {
    return {
      error: mapRemoteHelperCodeToSessionStart(started.code),
      message: started.message,
    };
  }

  return registerSshTaskSession(deps, {
    task,
    project,
    device,
    remoteRepo,
    started,
    command,
    args,
  });
}

function registerSshTaskSession(
  deps: StartSshTaskSessionDeps,
  input: {
    task: Task;
    project: Project;
    device: { id: string; displayName: string };
    remoteRepo: { repoId: string };
    started: {
      session: Session;
      tmuxSessionName: string;
      manifestRow: { hostLabel?: string };
    };
    command: string;
    args: string[];
    sourceBranchShort?: string;
  },
): Session {
  const { task, project, device, remoteRepo, started, command, args, sourceBranchShort } = input;

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

  void deps.taskAgentSessionRecordStore.recordSessionStart({
    fluxxSessionId: started.session.id,
    taskId: task.id,
    projectId: project.id,
    repoId: remoteRepo.repoId,
    agent: task.agent,
    worktreePath: started.session.worktreePath,
    fluxxWorkBranch: started.session.branch,
    workspaceKind: started.session.workspaceKind,
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
