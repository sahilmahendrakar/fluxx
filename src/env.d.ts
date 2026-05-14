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
  TaskRequestPullRequestFromAgentResult,
  TaskSessionStartProgress,
} from './types';
import type {
  AgentState,
  AttachResult,
  DaemonStreamCatchupPayload,
  PlanningAttachResult,
} from './daemon/protocol';
import type {
  McpBridgeRequest,
  McpBridgeResponse,
} from './mcpBridge';
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
      };
      projects: {
        listLocal: () => Promise<LocalProject[]>;
        addLocal: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        activateLocal: (id: string | null) => Promise<LocalProject | null>;
        removeLocal: (id: string) => Promise<void>;
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
        clearLocalBinding: (cloudProjectId: string) => Promise<void>;
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
      tasks: {
        getAll: () => Promise<Task[]>;
        create: (input: {
          title: string;
          agent: Agent;
          blockedByTaskIds?: string[];
          labels?: string[];
          sourceBranch?: string;
          createSourceBranchIfMissing?: boolean;
          agentModel?: string;
          agentYolo?: boolean;
          repoId?: string;
        }) => Promise<Task>;
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
              | 'fluxWorkBranch'
            >
          > & {
            githubPr?: TaskGithubPr | null;
            autoStartOnUnblock?: boolean | null;
          },
        ) => Promise<Task>;
        assertSourceBranchEditable: (
          taskId: string,
          previous: Pick<
            Task,
            'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId' | 'fluxWorkBranch'
          > & {
            githubPr?: TaskGithubPr;
          },
          patch: Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId'>,
        ) => Promise<{ ok: true } | { ok: false; message: string }>;
        assertRepoIdEditable: (
          taskId: string,
          previous: Pick<Task, 'repoId' | 'fluxWorkBranch'> & { githubPr?: TaskGithubPr },
          patch: Pick<Task, 'repoId'>,
        ) => Promise<{ ok: true } | { ok: false; message: string }>;
        delete: (id: string) => Promise<void>;
        requestPullRequestFromAgent: (payload: {
          taskId: string;
          title?: string;
        }) => Promise<TaskRequestPullRequestFromAgentResult>;
        refreshPullRequest: (payload: {
          taskId: string;
          githubPr?: TaskGithubPr;
        }) => Promise<TaskPullRequestIpcResult>;
        resolveWorktrees: (
          taskIdsOrEntries:
            | string[]
            | { taskId: string; repoId?: string | null; fluxWorkBranch?: string | null }[],
        ) => Promise<Record<string, boolean>>;
        cleanupResources: (id: string) => Promise<{ errors: string[] }>;
        onChanged: (cb: () => void) => () => void;
        onUserInput: (
          cb: (p: { sessionId: string; taskId: string }) => void,
        ) => () => void;
        onPersistFluxWorkBranch: (
          cb: (p: { taskId: string; fluxWorkBranch: string }) => void,
        ) => () => void;
      };
      sessions: {
        start: (
          task: Task,
          projectTasks?: Task[],
          requesterUid?: string | null,
          options?: SessionStartOptions,
        ) => Promise<SessionStartResult>;
        archive: (sessionId: string) => Promise<void>;
        deleteWorkspace: (sessionId: string) => Promise<void>;
        get: (taskId: string) => Promise<Session | null>;
        getAll: () => Promise<Session[]>;
        attach: (sessionId: string) => Promise<AttachResult | null>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (
          sessionId: string,
          cb: (data: string, streamSeq?: number) => void,
        ) => () => void;
        onExit: (cb: (session: Session) => void) => () => void;
        onAgentState: (sessionId: string, cb: (state: AgentState) => void) => () => void;
        getSilenceStates: () => Promise<
          { id: string; taskId?: string; state: AgentState }[]
        >;
        onDaemonStreamCatchup: (
          cb: (payload: DaemonStreamCatchupPayload) => void,
        ) => () => void;
        onTaskStartProgress: (cb: (p: TaskSessionStartProgress) => void) => () => void;
      };
      shells: {
        open: (sessionId: string) => Promise<Shell>;
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
          payload: Agent | { agent: Agent; agentModel?: string; agentYolo?: boolean },
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
      mcpBridge: {
        signalReady: () => void;
        onRequest: (cb: (req: McpBridgeRequest) => void) => () => void;
        respond: (resp: McpBridgeResponse) => void;
      };
    };
  }
}

export {};
