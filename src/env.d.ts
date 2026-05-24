/// <reference types="vite/client" />
import type {
  Task,
  Agent,
  AgentSpawnDefaultsPatch,
  CloudProjectLocalBinding,
  CloudRepoBindingOverview,
  CloudSharedRepo,
  LocalProject,
  OpenWorkspaceTarget,
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
  PlanningSession,
  ActiveProjectKey,
  ProjectTabState,
  TaskGithubPr,
  TaskPullRequestIpcResult,
  TaskRequestPullRequestFromAgentPayload,
  TaskRequestPullRequestFromAgentResult,
  TaskSessionStartProgress,
  TaskAttachedPlanningDoc,
  TaskExecutionDeviceRef,
  ExecutionDeviceConfig,
  DeviceProbeResult,
  ExecutionDeviceUpdateInput,
  SshExecutionDeviceUpsertInput,
} from './types';
import type {
  AgentState,
  AttachResult,
  PlanningAttachResult,
} from './terminal-runtime/protocol';
import type {
  AutomationBridgeRequest,
  AutomationBridgeResponse,
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
import type { AppUpdateState } from './appUpdateState';

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

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

declare global {
  interface Window {
    electronAPI: {
      platform: string;
      /** Opens http(s) URLs in the system default browser (not an in-app window). */
      openExternalUrl: (url: string) => Promise<void>;
      workspace: {
        openPath: (
          dirPath: string,
          target: OpenWorkspaceTarget,
        ) => Promise<{ ok: true } | { error: string }>;
        resolveTaskWorktree: (
          payload: ResolveTaskWorktreeIpcPayload,
        ) => Promise<ResolveTaskWorktreeIpcResult>;
      };
      project: {
        get: () => Promise<LocalProject | null>;
        getDir: () => Promise<string | null>;
        open: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        clear: () => Promise<void>;
        setPlanningAgent: (
          agent: Agent,
        ) => Promise<{ ok: true } | { error: string }>;
        setDefaultTaskAgent: (
          agent: Agent,
        ) => Promise<{ ok: true } | { error: string }>;
        patchAgentSpawnDefaults: (
          patch: AgentSpawnDefaultsPatch,
        ) => Promise<{ ok: true } | { error: string }>;
        getMcpConfig: () => Promise<
          { ok: true; path: string; text: string } | { error: string }
        >;
        setMcpConfig: (
          text: string,
        ) => Promise<
          { ok: true; path: string; text: string } | { error: string }
        >;
        addMcpConfig: (
          text: string,
        ) => Promise<
          { ok: true; path: string; text: string } | { error: string }
        >;
        getRepos: () => Promise<RepoConfig[]>;
        updateRepo: (payload: {
          rootPath: string;
          patch: RepoSettingsPatch;
        }) => Promise<{ ok: true; repos: RepoConfig[] } | { error: string }>;
        getRepoManagementStates: () => Promise<
          | Record<string, RepoManagementState>
          | { error: string }
        >;
        pickRepoDirectory: () => Promise<
          | { rootPath: string }
          | { error: 'NOT_GIT_REPO' }
          | { error: string }
          | null
        >;
        updateRepoById: (payload: {
          repoId: string;
          patch: RepoSettingsPatch;
        }) => Promise<
          | { ok: true; repos: RepoConfig[] }
          | { error: string }
        >;
        addRepo: (payload: {
          rootPath: string;
        }) => Promise<
          | { ok: true; repos: RepoConfig[] }
          | { error: string }
        >;
        removeRepo: (payload: {
          repoId: string;
        }) => Promise<
          | { ok: true; repos: RepoConfig[] }
          | { error: string }
        >;
        setPrimaryRepo: (payload: {
          repoId: string;
        }) => Promise<
          | { ok: true; repos: RepoConfig[] }
          | { error: string }
        >;
        getPrimaryRepoId: () => Promise<
          { ok: true; repoId: string | null } | { error: string }
        >;
        getCloudRepoBindingOverview: (
          sharedRepos: CloudSharedRepo[],
        ) => Promise<
          CloudRepoBindingOverview | { error: string; code?: string }
        >;
        bindCloudSharedRepo: (payload: {
          repoId: string;
          rootPath: string;
          sharedRepos: CloudSharedRepo[];
        }) => Promise<
          | { ok: true; binding: CloudProjectLocalBinding }
          | { error: string; code?: 'NOT_GIT_REPO' }
        >;
        syncCloudSharedRepos: (
          sharedRepos: CloudSharedRepo[],
        ) => Promise<{ ok: true } | { error: string }>;
        getAutoStartSessionOnInProgress: () => Promise<boolean>;
        setAutoStartSessionOnInProgress: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoStartWhenUnblocked: () => Promise<boolean>;
        setAutoStartWhenUnblocked: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoRespondToTrustPrompts: () => Promise<boolean>;
        setAutoRespondToTrustPrompts: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoCleanupWorkspaceWhenDone: () => Promise<boolean>;
        setAutoCleanupWorkspaceWhenDone: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoMarkDoneWhenPrMerged: () => Promise<boolean>;
        setAutoMarkDoneWhenPrMerged: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoMoveToReviewWhenPrOpen: () => Promise<boolean>;
        setAutoMoveToReviewWhenPrOpen: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getTmuxAvailability: () => Promise<import('./types').TmuxAvailability>;
        getPersistTerminalsWithTmux: () => Promise<boolean>;
        setPersistTerminalsWithTmux: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getDefaultDeviceId: () => Promise<string | null>;
        setDefaultDeviceId: (deviceId: string | null) => Promise<string | null>;
      };
      terminal: {
        inventorySnapshot: () => Promise<import('./types').TerminalInventorySnapshot>;
      };
      projects: {
        listLocal: () => Promise<LocalProject[]>;
        getPickerLastOpenedAt: () => Promise<Record<string, string>>;
        addLocal: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        create: (
          input:
            | import('./projectCreate').ProjectCreateInput
            | import('./projectCreate').ProjectCreateWizardPayload,
        ) => Promise<import('./projectCreate').ProjectCreateResult>;
        activateLocal: (id: string | null) => Promise<LocalProject | null>;
        removeLocal: (id: string) => Promise<void>;
        removeFluxxOwnedLocalState: (key: ActiveProjectKey) => Promise<{
          ok: boolean;
          warnings: string[];
          errors: string[];
          deletedMaterializationDirs: string[];
        }>;
        getActiveKey: () => Promise<ActiveProjectKey | null>;
        clearActive: () => Promise<void>;
        getTabs: (key: ActiveProjectKey) => Promise<ProjectTabState>;
        setTabs: (key: ActiveProjectKey, tabs: ProjectTabState) => Promise<void>;
        getLocalBinding: (
          cloudProjectId: string,
        ) => Promise<CloudProjectLocalBinding | null>;
        pickDirectoryForCloud: (cloudProjectId: string) => Promise<DirPickResult>;
        activateCloud: (payload: {
          id: string;
          rootPath: string;
          sharedRepos?: CloudSharedRepo[];
        }) => Promise<ActivateCloudResult>;
        resolveCloudMaterializationDir: (
          cloudProjectId: string,
        ) => Promise<{ projectDir: string } | { error: string }>;
        applyCloudCreateBindings: (payload: {
          cloudProjectId: string;
          bindings: { repoId: string; rootPath: string }[];
          primaryRepoId?: string;
          sharedRepos?: CloudSharedRepo[];
        }) => Promise<{ ok: true } | { error: string; code?: 'NOT_GIT_REPO' }>;
        clearLocalBinding: (cloudProjectId: string) => Promise<void>;
      };
      projectOnboarding: {
        getState: () => Promise<
          | {
              status: import('./main/projectOnboarding').PlanningInitStatus;
              docsInitialized: boolean;
              showCallout: boolean;
            }
          | { error: 'NO_ACTIVE_PROJECT' }
        >;
        setStatus: (
          status: import('./main/projectOnboarding').PlanningInitStatus,
        ) => Promise<{ ok: true } | { error: 'INVALID_STATUS' | 'NO_ACTIVE_PROJECT' }>;
        writePending: (
          projectDir?: string,
        ) => Promise<{ ok: true } | { error: 'NO_PROJECT_DIR' }>;
        maybeCompleteAfterSession: () => Promise<
          { ok: true; changed: boolean } | { error: 'NO_ACTIVE_PROJECT' }
        >;
      };
      auth: {
        startGoogleLogin: () => Promise<{ idToken: string }>;
      };
      email: {
        isConfigured: () => Promise<boolean>;
        sendInvite: (input: {
          to: string;
          projectName: string;
          inviterName?: string;
          inviterEmail?: string;
        }) => Promise<{ ok: true } | { error: string }>;
      };
      repo: {
        getBranchDiscovery: (
          arg?: string | RepoBranchDiscoveryRequest,
        ) => Promise<RepoBranchDiscoveryResponse | { error: string }>;
      };
      executionDevices: {
        list: () => Promise<ExecutionDeviceConfig[]>;
        getGlobalDefault: () => Promise<string | null>;
        setGlobalDefault: (deviceId: string | null) => Promise<string | null>;
        resolveDefaultForNewTask: () => Promise<TaskExecutionDeviceRef>;
        createSsh: (input: SshExecutionDeviceUpsertInput) => Promise<ExecutionDeviceConfig>;
        update: (
          deviceId: string,
          patch: ExecutionDeviceUpdateInput,
        ) => Promise<ExecutionDeviceConfig>;
        remove: (deviceId: string) => Promise<void>;
        probe: (deviceId: string) => Promise<DeviceProbeResult>;
        onChanged: (cb: () => void) => () => void;
      };
      cloudBindings: {
        getPerTaskDeviceOverrides: (
          projectId: string,
        ) => Promise<Record<string, TaskExecutionDeviceRef>>;
        getPerTaskDeviceOverride: (
          projectId: string,
          taskId: string,
        ) => Promise<TaskExecutionDeviceRef | null>;
        setPerTaskDeviceOverride: (
          projectId: string,
          taskId: string,
          ref: TaskExecutionDeviceRef | null,
        ) => Promise<TaskExecutionDeviceRef | null>;
        getProjectDefaultDeviceId: (projectId: string) => Promise<string | null>;
        setProjectDefaultDeviceId: (
          projectId: string,
          deviceId: string | null,
        ) => Promise<string | null>;
      };
      tasks: {
        getAll: () => Promise<Task[]>;
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
          attachedPlanningDocs?: TaskAttachedPlanningDoc[];
          executionDevice?: TaskExecutionDeviceRef;
        }) => Promise<Task>;
        resolveEffectiveExecutionDevice: (task: Task) => Promise<TaskExecutionDeviceRef>;
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
            attachedPlanningDocs?: TaskAttachedPlanningDoc[] | null;
            executionDevice?: TaskExecutionDeviceRef | null;
          },
        ) => Promise<Task>;
        assertSourceBranchEditable: (
          taskId: string,
          previous: Pick<
            Task,
            'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId' | 'fluxxWorkBranch'
          > & {
            githubPr?: TaskGithubPr;
          },
          patch: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId'>,
        ) => Promise<{ ok: true } | { ok: false; message: string }>;
        assertRepoIdEditable: (
          taskId: string,
          previous: Pick<Task, 'repoId' | 'fluxxWorkBranch'> & { githubPr?: TaskGithubPr },
          patch: Pick<Task, 'repoId'>,
        ) => Promise<{ ok: true } | { ok: false; message: string }>;
        delete: (id: string) => Promise<void>;
        requestPullRequestFromAgent: (
          payload: TaskRequestPullRequestFromAgentPayload,
        ) => Promise<TaskRequestPullRequestFromAgentResult>;
        refreshPullRequest: (payload: {
          taskId: string;
          githubPr?: TaskGithubPr;
        }) => Promise<TaskPullRequestIpcResult>;
        resolveWorktrees: (
          taskIdsOrEntries:
            | string[]
            | { taskId: string; repoId?: string | null; fluxxWorkBranch?: string | null }[],
        ) => Promise<Record<string, boolean>>;
        cleanupResources: (id: string) => Promise<{ errors: string[] }>;
        onChanged: (cb: () => void) => () => void;
        onUserInput: (
          cb: (p: { sessionId: string; taskId: string }) => void,
        ) => () => void;
        onPersistFluxxWorkBranch: (
          cb: (p: { taskId: string; fluxxWorkBranch: string }) => void,
        ) => () => void;
      };
      sessions: {
        start: (
          task: Task,
          projectTasks?: Task[],
          requesterUid?: string | null,
          options?: SessionStartOptions,
        ) => Promise<SessionStartResult>;
        deleteWorkspace: (sessionId: string) => Promise<void>;
        archive: (sessionId: string) => Promise<void>;
        get: (taskId: string) => Promise<Session | null>;
        getAll: () => Promise<Session[]>;
        isRestoreComplete: () => Promise<boolean>;
        awaitRestoreComplete: () => Promise<void>;
        reconcileRemote: () => Promise<Session[]>;
        syncToLocal: (sessionId: string) => Promise<import('./types').RemoteSshSyncResult>;
        getSshLocalWorktree: (sessionId: string) => Promise<{
          path: string | null;
          lastSyncedAt: string | null;
        }>;
        onRestoreComplete: (cb: () => void) => () => void;
        attach: (sessionId: string) => Promise<AttachResult | null>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (
          sessionId: string,
          cb: (data: string, streamSeq?: number) => void,
        ) => () => void;
        onExit: (cb: (session: Session) => void) => () => void;
        onAgentState: (sessionId: string, cb: (state: AgentState) => void) => () => void;
        onTrustPromptAutoresponded: (
          sessionId: string,
          cb: (payload: { ruleId: string; agent: Agent; sessionId: string }) => void,
        ) => () => void;
        getSilenceStates: () => Promise<
          { id: string; taskId?: string; state: AgentState }[]
        >;
        onTaskStartProgress: (cb: (p: TaskSessionStartProgress) => void) => () => void;
      };
      shells: {
        open: (sessionId: string, options?: import('./types').ShellOpenOptions) => Promise<Shell>;
        close: (shellId: string) => Promise<void>;
        list: (sessionId: string) => Promise<Shell[]>;
        attach: (shellId: string) => Promise<AttachResult | null>;
        write: (shellId: string, data: string) => void;
        resize: (shellId: string, cols: number, rows: number) => void;
        onData: (
          shellId: string,
          cb: (data: string, streamSeq?: number) => void,
        ) => () => void;
        onExit: (cb: (shell: Shell) => void) => () => void;
      };
      planning: {
        list: () => Promise<PlanningSession[]>;
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
        ) => Promise<PlanningStartResult>;
        stop: (sessionId: string) => Promise<void>;
        get: (sessionId: string) => Promise<PlanningSession | null>;
        attach: (sessionId: string) => Promise<PlanningAttachResult | null>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (
          sessionId: string,
          cb: (data: string, streamSeq?: number) => void,
        ) => () => void;
        onExit: (cb: (session: PlanningSession) => void) => () => void;
        onTrustPromptAutoresponded: (
          sessionId: string,
          cb: (payload: { ruleId: string; agent: Agent; sessionId: string }) => void,
        ) => () => void;
      };
      cursorAgent: {
        listModels: () => Promise<ListCursorAgentModelsResult>;
      };
      planningDocs: {
        list: () => Promise<PlanningDocsListResult>;
        read: (relativePath: string) => Promise<
          { content: string } | { error: string }
        >;
        write: (
          relativePath: string,
          content: string,
        ) => Promise<PlanningDocsWriteResult>;
        applyFirestoreSnapshot: (payload: {
          projectId: string;
          docs: Array<{
            docId: string;
            relativePath: string;
            markdown: string;
            remoteRevision: string;
          }>;
          removedDocIds: string[];
        }) => Promise<PlanningDocsApplyFirestoreSnapshotResult>;
        listPushCandidates: (
          projectId: string,
        ) => Promise<PlanningDocsListPushCandidatesResult>;
        recordPushSuccess: (
          payload: PlanningDocsRecordPushSuccessPayload,
        ) => Promise<PlanningDocsRecordPushSuccessResult>;
        persistConflict: (
          payload: PlanningDocsPersistConflictPayload,
        ) => Promise<PlanningDocsPersistConflictResult>;
        resolveConflict: (
          payload: PlanningDocsResolveConflictPayload,
        ) => Promise<PlanningDocsResolveConflictIpcResult>;
        revealSyncFolder: () => Promise<PlanningDocsRevealSyncFolderResult>;
        onChanged: (cb: () => void) => () => void;
        cloudMigration: {
          getState: (
            cloudProjectId: string,
          ) => Promise<
            | { state: PlanningDocsCloudMigrationPersistedV1 | null }
            | { error: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' }
          >;
          patchState: (
            cloudProjectId: string,
            patch: Partial<
              Pick<
                PlanningDocsCloudMigrationPersistedV1,
                'didInitialHydrateFromCloud' | 'seedOfferResolved'
              >
            >,
          ) => Promise<
            | { ok: true; state: PlanningDocsCloudMigrationPersistedV1 }
            | { error: 'NOT_ACTIVE_CLOUD' | 'NO_PLANNING_DIR' }
          >;
          applyHydration: (payload: {
            cloudProjectId: string;
            plan: FirestoreHydrationWritePlan;
          }) => Promise<{ ok: true } | { error: string }>;
        };
      };
      /**
       * macOS packaged builds — GitHub Releases via `electron-updater`; download starts only via `startDownload`.
       */
      updates: {
        getState: () => Promise<AppUpdateState>;
        check: () => Promise<void>;
        startDownload: () => Promise<{ ok: true } | { ok: false; reason: string }>;
        quitAndInstall: () => Promise<void>;
        onStateChanged: (cb: (state: AppUpdateState) => void) => () => void;
      };
      automationBridge: {
        signalReady: () => void;
        onRequest: (cb: (req: AutomationBridgeRequest) => void) => () => void;
        respond: (resp: AutomationBridgeResponse) => void;
      };
    };
  }
}

export {};
