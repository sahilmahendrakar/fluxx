// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors shared Task shape (status uses TaskStatus)
import type { Task, Agent, TaskStatus, Project, Session } from './types';

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
      };
    };
  }
}

export {};
