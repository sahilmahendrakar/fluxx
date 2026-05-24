import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ActiveProjectKey,
  Agent,
  AgentSpawnDefaultsPatch,
  CloudProjectLocalBinding,
  CloudRepoBindingOverview,
  RemoteRepoBindingsOverview,
  CloudSharedRepo,
  LocalProject,
  OpenWorkspaceTarget,
  PlanningSession,
  ProjectTabState,
  RepoBranchDiscoveryRequest,
  RepoBranchDiscoveryResponse,
  RepoConfig,
  RepoManagementState,
  RepoSettingsPatch,
  ResolveTaskWorktreeIpcPayload,
  ResolveTaskWorktreeIpcResult,
  Session,
  SessionStartOptions,
  SessionStartResult,
  Shell,
  Task,
  TaskExecutionDeviceRef,
  ExecutionDeviceConfig,
  DeviceProbeResult,
  ExecutionDeviceUpdateInput,
  SshExecutionDeviceUpsertInput,
  TaskStatus,
  TaskGithubPr,
  TaskPullRequestIpcResult,
  TaskRequestPullRequestFromAgentPayload,
  TaskRequestPullRequestFromAgentResult,
  TaskSessionStartProgress,
} from './types';
import type {
  AgentState,
  AttachResult,
  PlanningAttachResult,
} from './terminal-runtime/protocol';
import {
  AUTOMATION_BRIDGE_READY_CHANNEL,
  AUTOMATION_BRIDGE_REQUEST_CHANNEL,
  AUTOMATION_BRIDGE_RESPONSE_CHANNEL,
  type AutomationBridgeRequest,
  type AutomationBridgeResponse,
} from './rendererAutomationBridge';
import type { FirestoreHydrationWritePlan } from './planningDocs/cloudPlanningDocsMigration';
import type {
  PlanningDocsApplyFirestoreSnapshotResult,
  PlanningDocsListPushCandidatesResult,
  PlanningDocsPersistConflictPayload,
  PlanningDocsPersistConflictResult,
  PlanningDocsRecordPushSuccessPayload,
  PlanningDocsRecordPushSuccessResult,
  PlanningDocsResolveConflictIpcResult,
  PlanningDocsResolveConflictPayload,
  PlanningDocsRevealSyncFolderResult,
} from './planningDocs/syncTypes';
import type {
  PlanningDocsCloudMigrationPersistedV1,
  PlanningDocsListResult,
  PlanningDocsWriteResult,
} from './planningDocs/types';
import { ipcSubscribe } from './ipcSubscribe';
import type { AppUpdateState } from './appUpdateState';
import type {
  ValidationPackDetail,
  ValidationPackResolvedInstructions,
  ValidationPackSummary,
} from './validationPacks/types';
import type {
  ValidationArtifactRegisterInput,
  ValidationRun,
  ValidationRunCreateInput,
  ValidationRunStatusUpdate,
} from './validationRuns/types';

type PlanningStartResult = PlanningSession | { error: string; message?: string };

type DirPickResult =
  | { rootPath: string }
  | { error: 'NOT_GIT_REPO' }
  | null;

type ListCursorAgentModelsResult = {
  models: string[];
  source: 'cli' | 'fallback';
  error?: string;
};

type ActivateCloudResult =
  | { ok: true }
  | { error: 'NOT_GIT_REPO' }
  | null;

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('openExternalUrl', url) as Promise<void>,
  workspace: {
    openPath: (dirPath: string, target: OpenWorkspaceTarget) =>
      ipcRenderer.invoke('workspace:openPath', dirPath, target) as Promise<
        { ok: true } | { error: string }
      >,
    resolveTaskWorktree: (payload: ResolveTaskWorktreeIpcPayload) =>
      ipcRenderer.invoke('workspace:resolveTaskWorktree', payload) as Promise<ResolveTaskWorktreeIpcResult>,
  },
  project: {
    get: () => ipcRenderer.invoke('project:get') as Promise<LocalProject | null>,
    getDir: () => ipcRenderer.invoke('project:getDir') as Promise<string | null>,
    open: () =>
      ipcRenderer.invoke('project:open') as Promise<
        LocalProject | { error: 'NOT_GIT_REPO' } | null
      >,
    clear: () => ipcRenderer.invoke('project:clear') as Promise<void>,
    setPlanningAgent: (agent: Agent) =>
      ipcRenderer.invoke('project:setPlanningAgent', agent) as Promise<
        { ok: true } | { error: string }
      >,
    setDefaultTaskAgent: (agent: Agent) =>
      ipcRenderer.invoke('project:setDefaultTaskAgent', agent) as Promise<
        { ok: true } | { error: string }
      >,
    patchAgentSpawnDefaults: (patch: AgentSpawnDefaultsPatch) =>
      ipcRenderer.invoke('project:patchAgentSpawnDefaults', patch) as Promise<
        { ok: true } | { error: string }
      >,
    getMcpConfig: () =>
      ipcRenderer.invoke('project:getMcpConfig') as Promise<
        { ok: true; path: string; text: string } | { error: string }
      >,
    setMcpConfig: (text: string) =>
      ipcRenderer.invoke('project:setMcpConfig', text) as Promise<
        { ok: true; path: string; text: string } | { error: string }
      >,
    addMcpConfig: (text: string) =>
      ipcRenderer.invoke('project:addMcpConfig', text) as Promise<
        { ok: true; path: string; text: string } | { error: string }
      >,
    getRepos: () =>
      ipcRenderer.invoke('project:getRepos') as Promise<RepoConfig[]>,
    getRepoManagementStates: () =>
      ipcRenderer.invoke('project:getRepoManagementStates') as Promise<
        | Record<string, RepoManagementState>
        | { error: string }
      >,
    pickRepoDirectory: () =>
      ipcRenderer.invoke('project:pickRepoDirectory') as Promise<
        | { rootPath: string }
        | { error: 'NOT_GIT_REPO' }
        | { error: string }
        | null
      >,
    updateRepo: (payload: { rootPath: string; patch: RepoSettingsPatch }) =>
      ipcRenderer.invoke('project:updateRepo', payload) as Promise<
        { ok: true; repos: RepoConfig[] } | { error: string }
      >,
    updateRepoById: (payload: { repoId: string; patch: RepoSettingsPatch }) =>
      ipcRenderer.invoke('project:updateRepoById', payload) as Promise<
        | { ok: true; repos: RepoConfig[] }
        | { error: string }
      >,
    addRepo: (payload: { rootPath: string }) =>
      ipcRenderer.invoke('project:addRepo', payload) as Promise<
        | { ok: true; repos: RepoConfig[] }
        | { error: string }
      >,
    removeRepo: (payload: { repoId: string }) =>
      ipcRenderer.invoke('project:removeRepo', payload) as Promise<
        | { ok: true; repos: RepoConfig[] }
        | { error: string }
      >,
    setPrimaryRepo: (payload: { repoId: string }) =>
      ipcRenderer.invoke('project:setPrimaryRepo', payload) as Promise<
        | { ok: true; repos: RepoConfig[] }
        | { error: string }
      >,
    getPrimaryRepoId: () =>
      ipcRenderer.invoke('project:getPrimaryRepoId') as Promise<
        { ok: true; repoId: string | null } | { error: string }
      >,
    getCloudRepoBindingOverview: (sharedRepos: CloudSharedRepo[]) =>
      ipcRenderer.invoke('project:getCloudRepoBindingOverview', sharedRepos) as Promise<
        | CloudRepoBindingOverview
        | { error: string; code?: string }
      >,
    bindCloudSharedRepo: (payload: {
      repoId: string;
      rootPath: string;
      sharedRepos: CloudSharedRepo[];
    }) =>
      ipcRenderer.invoke('project:bindCloudSharedRepo', payload) as Promise<
        | { ok: true; binding: CloudProjectLocalBinding }
        | { error: string; code?: 'NOT_GIT_REPO' }
      >,
    syncCloudSharedRepos: (sharedRepos: CloudSharedRepo[]) =>
      ipcRenderer.invoke('project:syncCloudSharedRepos', sharedRepos) as Promise<
        { ok: true } | { error: string }
      >,
    getRemoteRepoBindingsOverview: (payload: { deviceId: string; repoIds: string[] }) =>
      ipcRenderer.invoke('project:getRemoteRepoBindingsOverview', payload) as Promise<
        RemoteRepoBindingsOverview | { error: string }
      >,
    probeRemoteRepoBinding: (payload: {
      deviceId: string;
      repoId: string;
      remotePath: string;
    }) =>
      ipcRenderer.invoke('project:probeRemoteRepoBinding', payload) as Promise<
        | { ok: true; hostLabel: string; resolvedPath: string; originUrl: string }
        | { error: string; code?: string }
      >,
    setRemoteRepoBinding: (payload: {
      deviceId: string;
      repoId: string;
      remotePath: string;
    }) =>
      ipcRenderer.invoke('project:setRemoteRepoBinding', payload) as Promise<
        | { ok: true; binding: { remotePath: string; boundAt: string } }
        | { error: string; code?: string }
      >,
    clearRemoteRepoBinding: (payload: { deviceId: string; repoId: string }) =>
      ipcRenderer.invoke('project:clearRemoteRepoBinding', payload) as Promise<
        { ok: true } | { error: string }
      >,
    getAutoStartSessionOnInProgress: () =>
      ipcRenderer.invoke('project:getAutoStartSessionOnInProgress') as Promise<boolean>,
    setAutoStartSessionOnInProgress: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoStartSessionOnInProgress', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoStartWhenUnblocked: () =>
      ipcRenderer.invoke('project:getAutoStartWhenUnblocked') as Promise<boolean>,
    setAutoStartWhenUnblocked: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoStartWhenUnblocked', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoRespondToTrustPrompts: () =>
      ipcRenderer.invoke('project:getAutoRespondToTrustPrompts') as Promise<boolean>,
    setAutoRespondToTrustPrompts: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoRespondToTrustPrompts', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoCleanupWorkspaceWhenDone: () =>
      ipcRenderer.invoke('project:getAutoCleanupWorkspaceWhenDone') as Promise<boolean>,
    setAutoCleanupWorkspaceWhenDone: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoCleanupWorkspaceWhenDone', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoMarkDoneWhenPrMerged: () =>
      ipcRenderer.invoke('project:getAutoMarkDoneWhenPrMerged') as Promise<boolean>,
    setAutoMarkDoneWhenPrMerged: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoMarkDoneWhenPrMerged', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoMoveToReviewWhenPrOpen: () =>
      ipcRenderer.invoke('project:getAutoMoveToReviewWhenPrOpen') as Promise<boolean>,
    setAutoMoveToReviewWhenPrOpen: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoMoveToReviewWhenPrOpen', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getTmuxAvailability: () =>
      ipcRenderer.invoke('project:getTmuxAvailability') as Promise<
        import('./types').TmuxAvailability
      >,
    getPersistTerminalsWithTmux: () =>
      ipcRenderer.invoke('project:getPersistTerminalsWithTmux') as Promise<boolean>,
    setPersistTerminalsWithTmux: (enabled: boolean) =>
      ipcRenderer.invoke('project:setPersistTerminalsWithTmux', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getDefaultDeviceId: () =>
      ipcRenderer.invoke('project:getDefaultDeviceId') as Promise<string | null>,
    setDefaultDeviceId: (deviceId: string | null) =>
      ipcRenderer.invoke('project:setDefaultDeviceId', deviceId) as Promise<string | null>,
    getValidationEnabled: () =>
      ipcRenderer.invoke('project:getValidationEnabled') as Promise<boolean>,
    setValidationEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('project:setValidationEnabled', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
  },
  terminal: {
    inventorySnapshot: () =>
      ipcRenderer.invoke('terminal:inventorySnapshot') as Promise<
        import('./types').TerminalInventorySnapshot
      >,
  },
  projects: {
    listLocal: () =>
      ipcRenderer.invoke('projects:listLocal') as Promise<LocalProject[]>,
    getPickerLastOpenedAt: () =>
      ipcRenderer.invoke('projects:getPickerLastOpenedAt') as Promise<
        Record<string, string>
      >,
    addLocal: () =>
      ipcRenderer.invoke('projects:addLocal') as Promise<
        LocalProject | { error: 'NOT_GIT_REPO' } | null
      >,
    create: (
      input:
        | import('./projectCreate').ProjectCreateInput
        | import('./projectCreate').ProjectCreateWizardPayload,
    ) =>
      ipcRenderer.invoke('projects:create', input) as Promise<
        import('./projectCreate').ProjectCreateResult
      >,
    activateLocal: (id: string | null) =>
      ipcRenderer.invoke('projects:activateLocal', id) as Promise<LocalProject | null>,
    removeLocal: (id: string) =>
      ipcRenderer.invoke('projects:removeLocal', id) as Promise<void>,
    removeFluxxOwnedLocalState: (key: ActiveProjectKey) =>
      ipcRenderer.invoke('projects:removeFluxxOwnedLocalState', key) as Promise<{
        ok: boolean;
        warnings: string[];
        errors: string[];
        deletedMaterializationDirs: string[];
      }>,
    getActiveKey: () =>
      ipcRenderer.invoke('projects:getActiveKey') as Promise<ActiveProjectKey | null>,
    clearActive: () => ipcRenderer.invoke('projects:clearActive') as Promise<void>,
    /** Per-project tab strip state, for session-continuity restoration. */
    getTabs: (key: ActiveProjectKey) =>
      ipcRenderer.invoke('projects:getTabs', key) as Promise<ProjectTabState>,
    setTabs: (key: ActiveProjectKey, tabs: ProjectTabState) =>
      ipcRenderer.invoke('projects:setTabs', key, tabs) as Promise<void>,
    getRestorableSessionIds: () =>
      ipcRenderer.invoke('projects:getRestorableSessionIds') as Promise<
        import('./types').RestorableSessionIds
      >,
    getLocalBinding: (cloudProjectId: string) =>
      ipcRenderer.invoke('projects:getLocalBinding', cloudProjectId) as Promise<
        CloudProjectLocalBinding | null
      >,
    pickDirectoryForCloud: (cloudProjectId: string) =>
      ipcRenderer.invoke(
        'projects:pickDirectoryForCloud',
        cloudProjectId,
      ) as Promise<DirPickResult>,
    activateCloud: (payload: {
      id: string;
      rootPath: string;
      sharedRepos?: CloudSharedRepo[];
    }) =>
      ipcRenderer.invoke('projects:activateCloud', payload) as Promise<ActivateCloudResult>,
    resolveCloudMaterializationDir: (cloudProjectId: string) =>
      ipcRenderer.invoke(
        'projects:resolveCloudMaterializationDir',
        cloudProjectId,
      ) as Promise<{ projectDir: string } | { error: string }>,
    applyCloudCreateBindings: (payload: {
      cloudProjectId: string;
      bindings: { repoId: string; rootPath: string }[];
      primaryRepoId?: string;
      sharedRepos?: CloudSharedRepo[];
    }) =>
      ipcRenderer.invoke('projects:applyCloudCreateBindings', payload) as Promise<
        { ok: true } | { error: string; code?: 'NOT_GIT_REPO' }
      >,
    clearLocalBinding: (cloudProjectId: string) =>
      ipcRenderer.invoke('projects:clearLocalBinding', cloudProjectId) as Promise<void>,
  },
  projectOnboarding: {
    getState: () =>
      ipcRenderer.invoke('projectOnboarding:getState') as Promise<
        | {
            status: import('./main/projectOnboarding').PlanningInitStatus;
            docsInitialized: boolean;
            showCallout: boolean;
          }
        | { error: 'NO_ACTIVE_PROJECT' }
      >,
    setStatus: (
      status: import('./main/projectOnboarding').PlanningInitStatus,
    ) =>
      ipcRenderer.invoke('projectOnboarding:setStatus', status) as Promise<
        { ok: true } | { error: 'INVALID_STATUS' | 'NO_ACTIVE_PROJECT' }
      >,
    writePending: (projectDir?: string) =>
      ipcRenderer.invoke('projectOnboarding:writePending', projectDir) as Promise<
        { ok: true } | { error: 'NO_PROJECT_DIR' }
      >,
    maybeCompleteAfterSession: () =>
      ipcRenderer.invoke('projectOnboarding:maybeCompleteAfterSession') as Promise<
        | { ok: true; changed: boolean }
        | { error: 'NO_ACTIVE_PROJECT' }
      >,
  },
  repo: {
    getBranchDiscovery: (arg?: string | RepoBranchDiscoveryRequest) =>
      ipcRenderer.invoke('repo:getBranchDiscovery', arg) as Promise<
        RepoBranchDiscoveryResponse | { error: string }
      >,
  },
  executionDevices: {
    list: () =>
      ipcRenderer.invoke('executionDevices:list') as Promise<ExecutionDeviceConfig[]>,
    getGlobalDefault: () =>
      ipcRenderer.invoke('executionDevices:getGlobalDefault') as Promise<string | null>,
    setGlobalDefault: (deviceId: string | null) =>
      ipcRenderer.invoke('executionDevices:setGlobalDefault', deviceId) as Promise<
        string | null
      >,
    resolveDefaultForNewTask: () =>
      ipcRenderer.invoke(
        'executionDevices:resolveDefaultForNewTask',
      ) as Promise<TaskExecutionDeviceRef>,
    createSsh: (input: SshExecutionDeviceUpsertInput) =>
      ipcRenderer.invoke('executionDevices:createSsh', input) as Promise<ExecutionDeviceConfig>,
    update: (deviceId: string, patch: ExecutionDeviceUpdateInput) =>
      ipcRenderer.invoke('executionDevices:update', deviceId, patch) as Promise<
        ExecutionDeviceConfig
      >,
    remove: (deviceId: string) =>
      ipcRenderer.invoke('executionDevices:remove', deviceId) as Promise<void>,
    probe: (deviceId: string) =>
      ipcRenderer.invoke('executionDevices:probe', deviceId) as Promise<DeviceProbeResult>,
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('executionDevices:changed', handler);
      return () => ipcRenderer.removeListener('executionDevices:changed', handler);
    },
  },
  cloudBindings: {
    getPerTaskDeviceOverrides: (projectId: string) =>
      ipcRenderer.invoke(
        'cloudBindings:getPerTaskDeviceOverrides',
        projectId,
      ) as Promise<Record<string, TaskExecutionDeviceRef>>,
    getPerTaskDeviceOverride: (projectId: string, taskId: string) =>
      ipcRenderer.invoke(
        'cloudBindings:getPerTaskDeviceOverride',
        projectId,
        taskId,
      ) as Promise<TaskExecutionDeviceRef | null>,
    setPerTaskDeviceOverride: (
      projectId: string,
      taskId: string,
      ref: TaskExecutionDeviceRef | null,
    ) =>
      ipcRenderer.invoke(
        'cloudBindings:setPerTaskDeviceOverride',
        projectId,
        taskId,
        ref,
      ) as Promise<TaskExecutionDeviceRef | null>,
    getProjectDefaultDeviceId: (projectId: string) =>
      ipcRenderer.invoke(
        'cloudBindings:getProjectDefaultDeviceId',
        projectId,
      ) as Promise<string | null>,
    setProjectDefaultDeviceId: (projectId: string, deviceId: string | null) =>
      ipcRenderer.invoke(
        'cloudBindings:setProjectDefaultDeviceId',
        projectId,
        deviceId,
      ) as Promise<string | null>,
    onChanged: (handler: () => void) => {
      ipcRenderer.on('cloudBindings:changed', handler);
      return () => ipcRenderer.removeListener('cloudBindings:changed', handler);
    },
  },
  auth: {
    startGoogleLogin: () =>
      ipcRenderer.invoke('auth:startGoogleLogin') as Promise<{
        idToken: string;
      }>,
  },
  email: {
    isConfigured: () =>
      ipcRenderer.invoke('email:isConfigured') as Promise<boolean>,
    sendInvite: (input: {
      to: string;
      projectName: string;
      inviterName?: string;
      inviterEmail?: string;
    }) =>
      ipcRenderer.invoke('email:sendInvite', input) as Promise<
        { ok: true } | { error: string }
      >,
  },
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll') as Promise<Task[]>,
    create: (input: {
      title: string;
      agent: Agent | null;
      blockedByTaskIds?: string[];
      labels?: string[];
      sourceBranch?: string;
      createSourceBranchIfMissing?: boolean;
      agentModel?: string;
      agentYolo?: boolean;
      repoId?: string;
      executionDevice?: TaskExecutionDeviceRef;
    }) => ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
    resolveEffectiveExecutionDevice: (task: Task) =>
      ipcRenderer.invoke(
        'tasks:resolveEffectiveExecutionDevice',
        task,
      ) as Promise<TaskExecutionDeviceRef>,
    update: (
      id: string,
      patch: Partial<
        Pick<
          Task,
          | 'title'
          | 'status'
          | 'agent'
          | 'agentModel'
          | 'agentYolo'
          | 'description'
          | 'orderKey'
          | 'workspaceCleanedAt'
          | 'blockedByTaskIds'
          | 'labels'
          | 'sourceBranch'
          | 'createSourceBranchIfMissing'
          | 'repoId'
          | 'fluxxWorkBranch'
          | 'executionDevice'
        >
      > & {
        githubPr?: TaskGithubPr | null;
        autoStartOnUnblock?: boolean | null;
        executionDevice?: TaskExecutionDeviceRef | null;
      },
    ) => ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task>,
    assertSourceBranchEditable: (
      taskId: string,
      previous: Pick<
        Task,
        'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId' | 'fluxxWorkBranch'
      > & {
        githubPr?: TaskGithubPr;
      },
      patch: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId'>,
    ) =>
      ipcRenderer.invoke(
        'tasks:assertSourceBranchEditable',
        taskId,
        previous,
        patch,
      ) as Promise<{ ok: true } | { ok: false; message: string }>,
    assertRepoIdEditable: (
      taskId: string,
      previous: Pick<Task, 'repoId' | 'fluxxWorkBranch'> & { githubPr?: TaskGithubPr },
      patch: Pick<Task, 'repoId'>,
    ) =>
      ipcRenderer.invoke(
        'tasks:assertRepoIdEditable',
        taskId,
        previous,
        patch,
      ) as Promise<{ ok: true } | { ok: false; message: string }>,
    delete: (id: string) =>
      ipcRenderer.invoke('tasks:delete', id) as Promise<void>,
    requestPullRequestFromAgent: (payload: TaskRequestPullRequestFromAgentPayload) =>
      ipcRenderer.invoke('tasks:requestPullRequestFromAgent', payload) as Promise<
        TaskRequestPullRequestFromAgentResult
      >,
    refreshPullRequest: (payload: { taskId: string; githubPr?: TaskGithubPr }) =>
      ipcRenderer.invoke('tasks:refreshPullRequest', payload) as Promise<TaskPullRequestIpcResult>,
    resolveWorktrees: (
      taskIdsOrEntries:
        | string[]
        | { taskId: string; repoId?: string | null; fluxxWorkBranch?: string | null }[],
    ) =>
      ipcRenderer.invoke('tasks:resolveWorktrees', taskIdsOrEntries) as Promise<
        Record<string, boolean>
      >,
    cleanupResources: (id: string) =>
      ipcRenderer.invoke('tasks:cleanupResources', id) as Promise<{ errors: string[] }>,
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('tasks:changed', handler);
      return () => ipcRenderer.removeListener('tasks:changed', handler);
    },
    // Fires when the user submits input to a session whose task was in needs-input or review.
    // Used by cloud projects to update Firestore (local is handled in main.ts).
    onUserInput: (cb: (p: { sessionId: string; taskId: string }) => void) => {
      const handler = (_e: unknown, p: { sessionId: string; taskId: string }) => cb(p);
      ipcRenderer.on('task:userInput', handler);
      return () => ipcRenderer.removeListener('task:userInput', handler as Parameters<typeof ipcRenderer.removeListener>[1]);
    },
    onPersistFluxxWorkBranch: (cb: (p: { taskId: string; fluxxWorkBranch: string }) => void) => {
      const handler = (_e: unknown, p: { taskId: string; fluxxWorkBranch: string }) => cb(p);
      ipcRenderer.on('task:persistFluxxWorkBranch', handler);
      return () =>
        ipcRenderer.removeListener(
          'task:persistFluxxWorkBranch',
          handler as Parameters<typeof ipcRenderer.removeListener>[1],
        );
    },
  },
  sessions: {
    start: (
      task: Task,
      projectTasks?: Task[],
      requesterUid?: string | null,
      options?: SessionStartOptions,
    ) =>
      ipcRenderer.invoke(
        'session:start',
        task,
        projectTasks,
        requesterUid,
        options,
      ) as Promise<SessionStartResult>,
    deleteWorkspace: (sessionId: string) =>
      ipcRenderer.invoke('session:delete', sessionId) as Promise<void>,
    archive: (sessionId: string) =>
      ipcRenderer.invoke('session:archive', sessionId) as Promise<void>,
    get: (taskId: string) =>
      ipcRenderer.invoke('session:get', taskId) as Promise<Session | null>,
    getAll: () => ipcRenderer.invoke('session:getAll') as Promise<Session[]>,
    isRestoreComplete: () =>
      ipcRenderer.invoke('sessions:isRestoreComplete') as Promise<boolean>,
    awaitRestoreComplete: () =>
      ipcRenderer.invoke('sessions:awaitRestoreComplete') as Promise<void>,
    reconcileRemote: () =>
      ipcRenderer.invoke('session:reconcileRemote') as Promise<Session[]>,
    syncToLocal: (sessionId: string) =>
      ipcRenderer.invoke('session:syncToLocal', sessionId) as Promise<
        import('./types').RemoteSshSyncResult
      >,
    getSshLocalWorktree: (sessionId: string) =>
      ipcRenderer.invoke('session:getSshLocalWorktree', sessionId) as Promise<{
        path: string | null;
        lastSyncedAt: string | null;
      }>,
    onRestoreComplete: (cb: () => void) => {
      const handler = () => cb();
      return ipcSubscribe(ipcRenderer, 'sessions:restoreComplete', handler);
    },
    /** Warm-reattach: attach payload (`replay` and optional `snapshot`). */
    attach: (sessionId: string) =>
      ipcRenderer.invoke('session:attach', sessionId) as Promise<AttachResult | null>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('session:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('session:resize', sessionId, cols, rows),
    onData: (
      sessionId: string,
      cb: (data: string, streamSeq?: number) => void,
    ) => {
      const channel = `session:data:${sessionId}`;
      const handler = (
        _e: IpcRendererEvent,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
    onExit: (cb: (session: Session) => void) => {
      const handler = (_e: IpcRendererEvent, session: Session) => cb(session);
      return ipcSubscribe(ipcRenderer, 'session:exited', handler);
    },
    onAgentState: (sessionId: string, cb: (state: AgentState) => void) => {
      const channel = `session:agent-state:${sessionId}`;
      const handler = (_e: unknown, payload: { state: AgentState }) => cb(payload.state);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onTrustPromptAutoresponded: (
      sessionId: string,
      cb: (payload: { ruleId: string; agent: Agent; sessionId: string }) => void,
    ) => {
      const channel = `session:auto-responded:${sessionId}`;
      const handler = (
        _e: IpcRendererEvent,
        payload: { ruleId: string; agent: Agent; sessionId: string },
      ) => cb(payload);
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
    getSilenceStates: () =>
      ipcRenderer.invoke('session:getSilenceStates') as Promise<
        { id: string; taskId?: string; state: AgentState }[]
      >,
    onTaskStartProgress: (cb: (p: TaskSessionStartProgress) => void) => {
      const ch = 'session:taskStartProgress' as const;
      const handler = (
        _e: IpcRendererEvent,
        p: TaskSessionStartProgress,
      ) => {
        cb(p);
      };
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
  },
  shells: {
    open: (sessionId: string, options?: import('./types').ShellOpenOptions) =>
      ipcRenderer.invoke('shell:open', sessionId, options) as Promise<Shell>,
    close: (shellId: string) =>
      ipcRenderer.invoke('shell:close', shellId) as Promise<void>,
    list: (sessionId: string) =>
      ipcRenderer.invoke('shell:list', sessionId) as Promise<Shell[]>,
    attach: (shellId: string) =>
      ipcRenderer.invoke('shell:attach', shellId) as Promise<AttachResult | null>,
    write: (shellId: string, data: string) =>
      ipcRenderer.send('shell:write', shellId, data),
    resize: (shellId: string, cols: number, rows: number) =>
      ipcRenderer.send('shell:resize', shellId, cols, rows),
    onData: (shellId: string, cb: (data: string, streamSeq?: number) => void) => {
      const channel = `shell:data:${shellId}`;
      const handler = (
        _e: IpcRendererEvent,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
    onExit: (cb: (shell: Shell) => void) => {
      const handler = (_e: IpcRendererEvent, shell: Shell) => cb(shell);
      return ipcSubscribe(ipcRenderer, 'shell:exited', handler);
    },
  },
  planning: {
    list: () =>
      ipcRenderer.invoke('planning:list') as Promise<PlanningSession[]>,
    start: (
      payload:
        | Agent
        | {
            agent?: Agent;
            agentModel?: string;
            agentYolo?: boolean;
            resume?: boolean;
            sessionId?: string;
            initialPrompt?: string;
          },
    ) =>
      ipcRenderer.invoke('planning:start', payload) as Promise<PlanningStartResult>,
    stop: (sessionId: string) =>
      ipcRenderer.invoke('planning:stop', sessionId) as Promise<void>,
    get: (sessionId: string) =>
      ipcRenderer.invoke('planning:get', sessionId) as Promise<PlanningSession | null>,
    attach: (sessionId: string) =>
      ipcRenderer.invoke('planning:attach', sessionId) as Promise<PlanningAttachResult | null>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('planning:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('planning:resize', sessionId, cols, rows),
    onData: (
      sessionId: string,
      cb: (data: string, streamSeq?: number) => void,
    ) => {
      const channel = `planning:data:${sessionId}`;
      const handler = (
        _e: IpcRendererEvent,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
    onExit: (cb: (session: PlanningSession) => void) => {
      const handler = (_e: IpcRendererEvent, session: PlanningSession) =>
        cb(session);
      return ipcSubscribe(ipcRenderer, 'planning:exited', handler);
    },
    onTrustPromptAutoresponded: (
      sessionId: string,
      cb: (payload: { ruleId: string; agent: Agent; sessionId: string }) => void,
    ) => {
      const channel = `planning:auto-responded:${sessionId}`;
      const handler = (
        _e: IpcRendererEvent,
        payload: { ruleId: string; agent: Agent; sessionId: string },
      ) => cb(payload);
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
  },
  cursorAgent: {
    listModels: () =>
      ipcRenderer.invoke('cursor:listAgentModels') as Promise<ListCursorAgentModelsResult>,
  },
  validationRuns: {
    create: (input: ValidationRunCreateInput) =>
      ipcRenderer.invoke('validationRuns:create', input) as Promise<
        { ok: true; run: ValidationRun } | { error: string }
      >,
    updateStatus: (patch: ValidationRunStatusUpdate) =>
      ipcRenderer.invoke('validationRuns:updateStatus', patch) as Promise<
        { ok: true; run: ValidationRun } | { error: string }
      >,
    listForTask: (taskId: string) =>
      ipcRenderer.invoke('validationRuns:listForTask', taskId) as Promise<
        { ok: true; runs: ValidationRun[] } | { error: string }
      >,
    get: (runId: string) =>
      ipcRenderer.invoke('validationRuns:get', runId) as Promise<
        { ok: true; run: ValidationRun } | { error: string }
      >,
    readArtifact: (payload: { runId: string; artifactId: string }) =>
      ipcRenderer.invoke('validationRuns:readArtifact', payload) as Promise<
        | { ok: true; encoding: 'utf8'; content: string }
        | { ok: true; encoding: 'base64'; content: string; mimeType: string }
        | { ok: false; error: string; code: string }
      >,
    openArtifact: (payload: { runId: string; artifactId: string }) =>
      ipcRenderer.invoke('validationRuns:openArtifact', payload) as Promise<
        { ok: true } | { ok: false; error: string; code: string }
      >,
    readVerdict: (runId: string) =>
      ipcRenderer.invoke('validationRuns:readVerdict', runId) as Promise<
        | {
            ok: true;
            verdict: {
              summary: string;
              risks?: string[];
              checks?: { name: string; status: string }[];
            };
          }
        | { ok: false; error: string; code: string }
      >,
    registerArtifact: (input: ValidationArtifactRegisterInput) =>
      ipcRenderer.invoke('validationRuns:registerArtifact', input) as Promise<
        { ok: true; run: ValidationRun } | { error: string }
      >,
    launchValidator: (payload: { runId: string; task: Task }) =>
      ipcRenderer.invoke('validationRuns:launchValidator', payload) as Promise<
        | { ok: true; run: ValidationRun; validatorSessionId: string }
        | { error: string }
      >,
    cancelValidator: (payload: { runId: string; sessionId: string }) =>
      ipcRenderer.invoke('validationRuns:cancelValidator', payload) as Promise<
        { ok: true; run: ValidationRun | null } | { error: string }
      >,
    onChanged: (cb: (payload: { runId: string }) => void) => {
      const channel = 'validationRuns:changed';
      const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string }) =>
        cb(payload);
      return ipcSubscribe(ipcRenderer, channel, handler);
    },
  },
  validationTasks: {
    onEnteredValidation: (payload: { previousStatus: TaskStatus; task: Task }) =>
      ipcRenderer.invoke('validationTasks:onEnteredValidation', payload) as Promise<
        { ok: true } | { error: string }
      >,
  },
  validationPacks: {
    list: () =>
      ipcRenderer.invoke('validationPacks:list') as Promise<
        { ok: true; packs: ValidationPackSummary[] } | { error: string }
      >,
    get: (packId: string) =>
      ipcRenderer.invoke('validationPacks:get', packId) as Promise<
        { ok: true; pack: ValidationPackDetail } | { error: string }
      >,
    resolveInstructions: (payload: { packId: string; projectDir?: string }) =>
      ipcRenderer.invoke('validationPacks:resolveInstructions', payload) as Promise<
        { ok: true; resolved: ValidationPackResolvedInstructions } | { error: string }
      >,
  },
  planningDocs: {
    list: () =>
      ipcRenderer.invoke('planningDocs:list') as Promise<PlanningDocsListResult>,
    read: (relativePath: string) =>
      ipcRenderer.invoke('planningDocs:read', relativePath) as Promise<
        { content: string } | { error: string }
      >,
    write: (relativePath: string, content: string) =>
      ipcRenderer.invoke('planningDocs:write', relativePath, content) as Promise<PlanningDocsWriteResult>,
    applyFirestoreSnapshot: (payload: {
      projectId: string;
      docs: Array<{
        docId: string;
        relativePath: string;
        markdown: string;
        remoteRevision: string;
      }>;
      removedDocIds: string[];
    }) =>
      ipcRenderer.invoke(
        'planningDocs:applyFirestoreSnapshot',
        payload,
      ) as Promise<PlanningDocsApplyFirestoreSnapshotResult>,
    listPushCandidates: (projectId: string) =>
      ipcRenderer.invoke(
        'planningDocs:listPushCandidates',
        projectId,
      ) as Promise<PlanningDocsListPushCandidatesResult>,
    recordPushSuccess: (payload: PlanningDocsRecordPushSuccessPayload) =>
      ipcRenderer.invoke(
        'planningDocs:recordPushSuccess',
        payload,
      ) as Promise<PlanningDocsRecordPushSuccessResult>,
    persistConflict: (payload: PlanningDocsPersistConflictPayload) =>
      ipcRenderer.invoke(
        'planningDocs:persistConflict',
        payload,
      ) as Promise<PlanningDocsPersistConflictResult>,
    resolveConflict: (payload: PlanningDocsResolveConflictPayload) =>
      ipcRenderer.invoke('planningDocs:resolveConflict', payload) as Promise<
        PlanningDocsResolveConflictIpcResult
      >,
    revealSyncFolder: () =>
      ipcRenderer.invoke('planningDocs:revealSyncFolder') as Promise<PlanningDocsRevealSyncFolderResult>,
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('planningDocs:changed', handler);
      return () => ipcRenderer.removeListener('planningDocs:changed', handler);
    },
    cloudMigration: {
      getState: (cloudProjectId: string) =>
        ipcRenderer.invoke(
          'planningDocs:cloudMigration:getState',
          cloudProjectId,
        ) as Promise<
          | { state: PlanningDocsCloudMigrationPersistedV1 | null }
          | { error: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' }
        >,
      patchState: (
        cloudProjectId: string,
        patch: Partial<
          Pick<
            PlanningDocsCloudMigrationPersistedV1,
            'didInitialHydrateFromCloud' | 'seedOfferResolved'
          >
        >,
      ) =>
        ipcRenderer.invoke(
          'planningDocs:cloudMigration:patchState',
          cloudProjectId,
          patch,
        ) as Promise<
          | { ok: true; state: PlanningDocsCloudMigrationPersistedV1 }
          | { error: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' }
        >,
      applyHydration: (payload: {
        cloudProjectId: string;
        plan: FirestoreHydrationWritePlan;
      }) =>
        ipcRenderer.invoke(
          'planningDocs:cloudMigration:applyHydration',
          payload,
        ) as Promise<{ ok: true } | { error: string }>,
    },
  },
  notifications: {
    getAutoTransitionPrefs: () =>
      ipcRenderer.invoke('notifications:getAutoTransitionPrefs') as Promise<
        import('./taskAutoTransitionNotificationPrefs').AutoTransitionNotificationPrefs
      >,
    setAutoTransitionPrefs: (
      prefs: import('./taskAutoTransitionNotificationPrefs').AutoTransitionNotificationPrefs,
    ) =>
      ipcRenderer.invoke('notifications:setAutoTransitionPrefs', prefs) as Promise<{
        ok: true;
        prefs: import('./taskAutoTransitionNotificationPrefs').AutoTransitionNotificationPrefs;
      }>,
    notifyAutoTransition: (
      payload: import('./taskAutoTransitionNotification').AutoTransitionNotifyInput,
    ) =>
      ipcRenderer.invoke('notifications:notifyAutoTransition', payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
  /**
   * macOS packaged builds — GitHub Releases via `electron-updater`; downloads only after `startDownload`.
   */
  updates: {
    getState: (): Promise<AppUpdateState> =>
      ipcRenderer.invoke('app:updates:getState'),
    check: (): Promise<void> => ipcRenderer.invoke('app:updates:check'),
    startDownload: (): Promise<{ ok: true } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('app:updates:startDownload'),
    quitAndInstall: (): Promise<void> =>
      ipcRenderer.invoke('app:updates:quitAndInstall'),
    onStateChanged: (cb: (state: AppUpdateState) => void) => {
      const ch = 'app:updates:stateChanged' as const;
      const handler = (_e: IpcRendererEvent, s: AppUpdateState) => cb(s);
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
  },
  automationBridge: {
    signalReady: () => ipcRenderer.send(AUTOMATION_BRIDGE_READY_CHANNEL),
    onRequest: (cb: (req: AutomationBridgeRequest) => void) => {
      const handler = (_e: IpcRendererEvent, req: AutomationBridgeRequest) => cb(req);
      ipcRenderer.on(AUTOMATION_BRIDGE_REQUEST_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(AUTOMATION_BRIDGE_REQUEST_CHANNEL, handler);
    },
    respond: (resp: AutomationBridgeResponse) => {
      ipcRenderer.send(AUTOMATION_BRIDGE_RESPONSE_CHANNEL, resp);
    },
  },
});
