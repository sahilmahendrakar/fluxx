import path from 'node:path';
import type {
  Project,
  RemoteSshSyncResult,
  RepoConfig,
  Session,
  Task,
} from '../../types';
import type { WorktreeService } from '../WorktreeService';
import { isWorktreeCreateError } from '../worktreeCreateError';
import { worktreePathSegmentsForFluxxBranch } from '../fluxxTaskWorkBranchNaming';
import type { RemoteHelperClient } from './RemoteHelperClient';
import type {
  RemoteHelperGitSyncStatusData,
  RemoteHelperPushWorkBranchData,
} from './remoteHelperProtocol';
import type { DeviceStore } from '../DeviceStore';
import {
  ensureLocalBranchFromOrigin,
  fastForwardWorktreeToOrigin,
  fetchOriginBranch,
  isGitWorktreeDirty,
  pathExistsAsDirectory,
  readBranchTrackingState,
} from './localGitWorktreeChecks';
import { persistRemoteSshSyncMetadata } from './remoteSshSyncMetadata';
import {
  classifyGitBranchPresence,
  effectiveTaskSourceBranchShort,
  resolveCreateSourceBranchIfMissingForStart,
} from '../../taskBranches';
import { collectRepoBranchDiscovery } from '../repoGit';
import { isDirectWorkspaceKind } from '../DirectFolderWorkspaceProvider';

export type RemoteSshBranchSyncDeps = {
  deviceStore: DeviceStore;
  helper: RemoteHelperClient;
  worktreeService: WorktreeService;
  resolveRepoConfigForTaskSession: (
    project: Project,
    task: Task,
    projectDir: string,
  ) => Promise<RepoConfig>;
  activeProjectDir: () => string;
};

export type RemoteSshBranchSyncInput = {
  session: Session;
  task: Task;
  project: Project;
};

function fail(
  phase: RemoteSshSyncResult extends { ok: false } ? RemoteSshSyncResult['phase'] : never,
  error: Extract<RemoteSshSyncResult, { ok: false }>['error'],
  message: string,
  recovery?: string,
): RemoteSshSyncResult {
  return { ok: false, phase, error, message, ...(recovery ? { recovery } : {}) };
}

export async function syncRemoteSshTaskToLocal(
  deps: RemoteSshBranchSyncDeps,
  input: RemoteSshBranchSyncInput,
): Promise<RemoteSshSyncResult> {
  const { session, task, project } = input;
  if (isDirectWorkspaceKind(session.workspaceKind)) {
    return fail(
      'remote-status',
      'NOT_SSH_SESSION',
      'Sync to local is not available for gitless SSH sessions. The agent runs directly in your bound remote folder.',
    );
  }
  if (session.deviceKind !== 'ssh') {
    return fail(
      'remote-status',
      'NOT_SSH_SESSION',
      'Sync to local is only available for SSH task sessions.',
    );
  }
  const deviceId = session.deviceId?.trim();
  if (!deviceId) {
    return fail(
      'remote-status',
      'DEVICE_NOT_CONFIGURED',
      'This SSH session has no device id. Start a new session on the SSH device.',
    );
  }
  const device = deps.deviceStore.getDevice(deviceId);
  if (!device || device.kind !== 'ssh' || !device.enabled) {
    return fail(
      'remote-status',
      'DEVICE_NOT_CONFIGURED',
      'The SSH device for this session is not configured or is disabled. Open Settings → Devices.',
      'Configure the SSH device or switch this task to local execution.',
    );
  }

  const install = await deps.helper.ensureInstalled(device);
  if (!install.ok) {
    return fail(
      'remote-status',
      'REMOTE_STATUS_FAILED',
      install.message,
      'Open Settings → Devices and run Probe to install or update the remote helper.',
    );
  }

  const remotePath = (session.remotePath ?? session.worktreePath)?.trim();
  if (!remotePath) {
    return fail(
      'remote-status',
      'REMOTE_STATUS_FAILED',
      'This SSH session has no remote worktree path.',
    );
  }

  const fluxxWorkBranch = (session.branch || task.fluxxWorkBranch || '').trim();
  const statusResult = await deps.helper.runJsonCommand<RemoteHelperGitSyncStatusData>(
    device,
    'git-sync-status',
    {
      worktreePath: remotePath,
      fluxxWorkBranch: fluxxWorkBranch || undefined,
      sourceBranchShort: task.sourceBranch?.trim() || undefined,
    },
  );
  if (!statusResult.ok) {
    const code =
      statusResult.code === 'REMOTE_PUSH_FAILED'
        ? 'REMOTE_STATUS_FAILED'
        : statusResult.code === 'WORKSPACE_MISSING'
          ? 'REMOTE_STATUS_FAILED'
          : 'REMOTE_STATUS_FAILED';
    return fail('remote-status', code, statusResult.message);
  }
  const remoteStatus = statusResult.data;
  const workBranch = remoteStatus.fluxxWorkBranch.trim();
  if (!workBranch) {
    return fail(
      'remote-status',
      'REMOTE_STATUS_FAILED',
      'Remote helper did not report a Fluxx work branch.',
    );
  }

  const pushResult = await deps.helper.runJsonCommand<RemoteHelperPushWorkBranchData>(
    device,
    'push-work-branch',
    {
      worktreePath: remotePath,
      fluxxWorkBranch: workBranch,
    },
    360_000,
  );
  if (!pushResult.ok) {
    return fail(
      'remote-push',
      'REMOTE_PUSH_FAILED',
      pushResult.message,
      'Commit and push changes on the SSH host, or configure git credentials on the remote.',
    );
  }

  const projectDir = deps.activeProjectDir();
  let repoCfg: RepoConfig;
  try {
    repoCfg = await deps.resolveRepoConfigForTaskSession(project, task, projectDir);
  } catch (err: unknown) {
    if (isWorktreeCreateError(err)) {
      const code =
        err.code === 'WORKTREE_REPO_NOT_BOUND' ? 'LOCAL_REPO_NOT_BOUND' : 'LOCAL_REPO_NOT_BOUND';
      return fail(
        'local-fetch',
        code,
        err.message,
        project.kind === 'cloud'
          ? 'Bind a local clone for this repository in Project settings, then retry Sync to local.'
          : 'Configure a local repository root in Project settings, then retry Sync to local.',
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail('local-fetch', 'LOCAL_REPO_NOT_BOUND', message);
  }

  const gitRoot = path.resolve(repoCfg.rootPath);
  try {
    await fetchOriginBranch(gitRoot, workBranch);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(
      'local-fetch',
      'LOCAL_FETCH_FAILED',
      `Could not fetch origin/${workBranch}: ${message}`,
      'Check your network connection and local git remote configuration.',
    );
  }

  const expectedLocalPath = path.join(
    projectDir,
    'worktrees',
    repoCfg.id,
    ...worktreePathSegmentsForFluxxBranch(workBranch),
  );
  const localExists = await pathExistsAsDirectory(expectedLocalPath);

  if (localExists) {
    const dirty = await isGitWorktreeDirty(expectedLocalPath);
    if (dirty.dirty) {
      return fail(
        'conflict-check',
        'LOCAL_DIRTY_CONFLICT',
        'Your local task worktree has uncommitted changes. Commit, stash, or move them before syncing from SSH.',
        'Finish or stash local edits, then run Sync to local again. Fluxx never overwrites dirty local work.',
      );
    }
  }

  const tracking = await readBranchTrackingState(gitRoot, workBranch);
  if (localExists && tracking.localSha && tracking.originSha) {
    if (tracking.diverged || (tracking.ahead > 0 && tracking.behind > 0)) {
      return fail(
        'conflict-check',
        'LOCAL_BRANCH_DIVERGED',
        `Local branch '${workBranch}' has diverged from origin/${workBranch}. Merge or reset locally before syncing.`,
        'Reconcile the local branch with origin manually, then retry Sync to local.',
      );
    }
    if (tracking.ahead > 0 && tracking.behind === 0) {
      return fail(
        'conflict-check',
        'LOCAL_BRANCH_DIVERGED',
        `Local branch '${workBranch}' has commits that are not on origin. Push or reset locally before syncing remote changes.`,
        'Push local commits or reset the branch to match origin, then retry Sync to local.',
      );
    }
  }

  const branchEnsure = await ensureLocalBranchFromOrigin(gitRoot, workBranch);
  if (!branchEnsure.ok) {
    return fail('local-worktree', 'LOCAL_FETCH_FAILED', branchEnsure.message);
  }

  let localWorktreePath = expectedLocalPath;
  try {
    const sourceOpts = await resolveLocalSourceBranchOpts(task, repoCfg);
    deps.worktreeService.setProjectDir(projectDir);
    deps.worktreeService.setRootPath(repoCfg.rootPath);
    const created = await deps.worktreeService.create({
      task: {
        id: task.id,
        title: task.title,
        fluxxWorkBranch: workBranch,
      },
      repo: {
        repoId: repoCfg.id,
        gitRootPath: repoCfg.rootPath,
        baseBranch: repoCfg.baseBranch,
        setupScript: repoCfg.setupScript,
        env: repoCfg.env,
      },
      source: sourceOpts,
      layout: 'repo-scoped',
    });
    localWorktreePath = created.worktreePath;
  } catch (err: unknown) {
    if (isWorktreeCreateError(err)) {
      return fail('local-worktree', 'LOCAL_WORKTREE_FAILED', err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail('local-worktree', 'LOCAL_WORKTREE_FAILED', message);
  }

  const ff = await fastForwardWorktreeToOrigin(localWorktreePath, workBranch);
  if (!ff.ok) {
    return fail(
      'local-worktree',
      'LOCAL_BRANCH_DIVERGED',
      ff.message,
      'Resolve the local branch divergence, then retry Sync to local.',
    );
  }

  const metadata = {
    lastSyncedAt: new Date().toISOString(),
    lastSyncedCommit: ff.headCommit,
    deviceId: device.id,
    remoteBranch: workBranch,
    remoteHasUnsyncedChanges: remoteStatus.remoteHasUnsyncedChanges,
    localWorktreePath,
  };
  await persistRemoteSshSyncMetadata(projectDir, task.id, metadata);

  return {
    ok: true,
    phase: 'complete',
    localWorktreePath,
    branch: workBranch,
    headCommit: ff.headCommit,
    metadata,
    dirtySnapshotHooks: remoteStatus.dirtySnapshotHooks,
  };
}

async function resolveLocalSourceBranchOpts(
  task: Task,
  repoCfg: RepoConfig,
): Promise<{ sourceBranchShort: string; createSourceBranchIfMissing: boolean }> {
  const discovery = await collectRepoBranchDiscovery(repoCfg.rootPath, repoCfg.baseBranch);
  const sourceEff =
    effectiveTaskSourceBranchShort(task, discovery.defaultBranchShort) ||
    discovery.defaultBranchShort ||
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
}
