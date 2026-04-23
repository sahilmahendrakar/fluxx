/// <reference types="vite/client" />
import type {
  Task,
  Agent,
  LocalProject,
  RepoConfig,
  Session,
  Shell,
  PlanningSession,
  ActiveProjectKey,
} from './types';

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

type SessionStartResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'WORKTREE_FAILED'; message: string };

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

/** Replay snapshot returned by the daemon on attach. */
type AttachResult = { replay: string; cols: number; rows: number };
type PlanningAttachResult = AttachResult & { session: PlanningSession };

type ProjectTabsState = {
  openTaskIds: string[];
  activeTaskId: string | null;
};

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
        getRepos: () => Promise<RepoConfig[]>;
        updateRepo: (payload: {
          rootPath: string;
          patch: Partial<Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env'>>;
        }) => Promise<{ ok: true; repos: RepoConfig[] } | { error: string }>;
      };
      projects: {
        listLocal: () => Promise<LocalProject[]>;
        addLocal: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        activateLocal: (id: string | null) => Promise<LocalProject | null>;
        removeLocal: (id: string) => Promise<void>;
        getActiveKey: () => Promise<ActiveProjectKey | null>;
        clearActive: () => Promise<void>;
        getTabs: (key: ActiveProjectKey) => Promise<ProjectTabsState>;
        setTabs: (
          key: ActiveProjectKey,
          tabs: ProjectTabsState,
        ) => Promise<void>;
        getLocalBinding: (
          cloudProjectId: string,
        ) => Promise<{ rootPath: string; lastOpenedAt: string } | null>;
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
        create: (input: { title: string; agent: Agent }) => Promise<Task>;
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
            >
          >,
        ) => Promise<Task>;
        delete: (id: string) => Promise<void>;
        cleanupResources: (id: string) => Promise<{ errors: string[] }>;
        onChanged: (cb: () => void) => () => void;
      };
      sessions: {
        start: (task: Task) => Promise<SessionStartResult>;
        archive: (sessionId: string) => Promise<void>;
        deleteWorkspace: (sessionId: string) => Promise<void>;
        get: (taskId: string) => Promise<Session | null>;
        getAll: () => Promise<Session[]>;
        attach: (sessionId: string) => Promise<AttachResult | null>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (sessionId: string, cb: (data: string) => void) => () => void;
        onExit: (cb: (session: Session) => void) => () => void;
      };
      shells: {
        open: (sessionId: string) => Promise<Shell>;
        close: (shellId: string) => Promise<void>;
        list: (sessionId: string) => Promise<Shell[]>;
        attach: (shellId: string) => Promise<AttachResult | null>;
        write: (shellId: string, data: string) => void;
        resize: (shellId: string, cols: number, rows: number) => void;
        onData: (shellId: string, cb: (data: string) => void) => () => void;
        onExit: (cb: (shell: Shell) => void) => () => void;
      };
      planning: {
        start: (agent: Agent) => Promise<PlanningStartResult>;
        stop: () => Promise<void>;
        get: () => Promise<PlanningSession | null>;
        attach: () => Promise<PlanningAttachResult | null>;
        write: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        onData: (cb: (data: string) => void) => () => void;
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
    };
  }
}

export {};
