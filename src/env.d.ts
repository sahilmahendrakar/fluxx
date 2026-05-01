/// <reference types="vite/client" />
import type {
  Task,
  Agent,
  CloudProjectLocalBinding,
  LocalProject,
  RepoConfig,
  Session,
  SessionStartResult,
  Shell,
  PlanningSession,
  ActiveProjectKey,
  ProjectTabState,
  TaskSessionStartProgress,
} from './types';
import type { AttachResult, PlanningAttachResult } from './daemon/protocol';
import type {
  McpBridgeRequest,
  McpBridgeResponse,
} from './mcpBridge';

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
        getRepos: () => Promise<RepoConfig[]>;
        updateRepo: (payload: {
          rootPath: string;
          patch: Partial<Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env'>>;
        }) => Promise<{ ok: true; repos: RepoConfig[] } | { error: string }>;
        getAutoStartSessionOnInProgress: () => Promise<boolean>;
        setAutoStartSessionOnInProgress: (
          enabled: boolean,
        ) => Promise<{ ok: true; enabled: boolean } | { error: string }>;
        getAutoStartWhenUnblocked: () => Promise<boolean>;
        setAutoStartWhenUnblocked: (
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
      tasks: {
        getAll: () => Promise<Task[]>;
        create: (input: {
          title: string;
          agent: Agent;
          blockedByTaskIds?: string[];
          labels?: string[];
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
            | 'autoStartOnUnblock'
          >
        >,
      ) => Promise<Task>;
        delete: (id: string) => Promise<void>;
        cleanupResources: (id: string) => Promise<{ errors: string[] }>;
        onChanged: (cb: () => void) => () => void;
      };
      sessions: {
        start: (task: Task, projectTasks?: Task[]) => Promise<SessionStartResult>;
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
        start: (agent: Agent) => Promise<PlanningStartResult>;
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
        list: () => Promise<
          | { files: { relativePath: string }[] }
          | { error: 'NO_PROJECT' | 'IO_ERROR' }
        >;
        read: (relativePath: string) => Promise<
          { content: string } | { error: string }
        >;
        onChanged: (cb: () => void) => () => void;
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
