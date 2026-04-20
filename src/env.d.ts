/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors shared Task shape (status uses TaskStatus)
import type { Task, Agent, TaskStatus, Project, Session } from './types';

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

type SessionStartResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'WORKTREE_FAILED'; message: string };

declare global {
  interface Window {
    electronAPI: {
      platform: string;
      project: {
        get: () => Promise<Project | null>;
        open: () => Promise<Project | { error: string } | null>;
        clear: () => Promise<void>;
      };
      projects: {
        list: () => Promise<Project[]>;
        add: () => Promise<Project | { error: string } | null>;
        activate: (id: string | null) => Promise<Project | null>;
        remove: (id: string) => Promise<void>;
      };
      auth: {
        startGoogleLogin: () => Promise<{ idToken: string }>;
      };
      tasks: {
        getAll: () => Promise<Task[]>;
        create: (input: { title: string; agent: Agent }) => Promise<Task>;
        update: (
          id: string,
          patch: Partial<Pick<Task, 'title' | 'status' | 'agent' | 'description'>>,
        ) => Promise<Task>;
        delete: (id: string) => Promise<void>;
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
    };
  }
}

export {};
