/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors shared Task shape (status uses TaskStatus)
import type { Task, Agent, TaskStatus, LocalProject, Session, Shell } from './types';

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

type SessionStartResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'WORKTREE_FAILED'; message: string };

type ActiveProjectKey = { kind: 'local' | 'cloud'; id: string };

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
        open: () => Promise<LocalProject | { error: string } | null>;
        clear: () => Promise<void>;
      };
      projects: {
        listLocal: () => Promise<LocalProject[]>;
        addLocal: () => Promise<LocalProject | { error: string } | null>;
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
      };
      sessions: {
        start: (task: Task) => Promise<SessionStartResult>;
        archive: (sessionId: string) => Promise<void>;
        deleteWorkspace: (sessionId: string) => Promise<void>;
        get: (taskId: string) => Promise<Session | null>;
        getAll: () => Promise<Session[]>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        onData: (sessionId: string, cb: (data: string) => void) => () => void;
        onExit: (cb: (session: Session) => void) => () => void;
      };
      shells: {
        open: (sessionId: string) => Promise<Shell>;
        close: (shellId: string) => Promise<void>;
        list: (sessionId: string) => Promise<Shell[]>;
        write: (shellId: string, data: string) => void;
        resize: (shellId: string, cols: number, rows: number) => void;
        onData: (shellId: string, cb: (data: string) => void) => () => void;
        onExit: (cb: (shell: Shell) => void) => () => void;
      };
    };
  }
}

export {};
