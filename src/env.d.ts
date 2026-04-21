/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors shared Task shape (status uses TaskStatus)
import type {
  Task,
  Agent,
  LocalProject,
  Session,
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

type ActivateCloudResult =
  | { ok: true }
  | { error: 'NOT_GIT_REPO' }
  | null;

declare global {
  interface Window {
    electronAPI: {
      platform: string;
      project: {
        get: () => Promise<LocalProject | null>;
        getDir: () => Promise<string | null>;
        open: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        clear: () => Promise<void>;
      };
      projects: {
        listLocal: () => Promise<LocalProject[]>;
        addLocal: () => Promise<LocalProject | { error: 'NOT_GIT_REPO' } | null>;
        activateLocal: (id: string | null) => Promise<LocalProject | null>;
        removeLocal: (id: string) => Promise<void>;
        getActiveKey: () => Promise<ActiveProjectKey | null>;
        clearActive: () => Promise<void>;
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
            Pick<Task, 'title' | 'status' | 'agent' | 'description' | 'orderKey'>
          >,
        ) => Promise<Task>;
        delete: (id: string) => Promise<void>;
        onChanged: (cb: () => void) => () => void;
      };
      sessions: {
        start: (task: Task) => Promise<SessionStartResult>;
        stop: (sessionId: string) => Promise<void>;
        get: (taskId: string) => Promise<Session | null>;
        getAll: () => Promise<Session[]>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (sessionId: string, cb: (data: string) => void) => () => void;
        onExit: (cb: (session: Session) => void) => () => void;
        openDedicatedWindow: (
          sessionId: string,
        ) => Promise<{ ok: true } | { ok: false; error: 'NO_SESSION' }>;
        isDedicatedOpen: (sessionId: string) => Promise<boolean>;
        focusDedicatedWindow: (sessionId: string) => Promise<void>;
        onTerminalWindowClosed: (cb: (sessionId: string) => void) => () => void;
      };
      planning: {
        start: () => Promise<PlanningStartResult>;
        stop: () => Promise<void>;
        get: () => Promise<PlanningSession | null>;
        write: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        onData: (cb: (data: string) => void) => () => void;
        onExit: (cb: (session: PlanningSession) => void) => () => void;
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
