// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors shared Task shape (status uses TaskStatus)
import type { Task, Agent, TaskStatus } from './types';

declare global {
  interface Window {
    electronAPI: {
      platform: string;
      tasks: {
        getAll: () => Promise<Task[]>;
        create: (input: { title: string; agent: Agent }) => Promise<Task>;
        update: (
          id: string,
          patch: Partial<Pick<Task, 'title' | 'status' | 'agent'>>,
        ) => Promise<Task>;
        delete: (id: string) => Promise<void>;
      };
    };
  }
}

export {};
