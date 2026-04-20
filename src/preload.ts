import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Agent, Project, Session, Task } from './types';

type SessionStartResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'WORKTREE_FAILED'; message: string };

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  project: {
    get: () => ipcRenderer.invoke('project:get') as Promise<Project | null>,
    open: () =>
      ipcRenderer.invoke('project:open') as Promise<
        Project | { error: string } | null
      >,
    clear: () => ipcRenderer.invoke('project:clear') as Promise<void>,
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list') as Promise<Project[]>,
    add: () =>
      ipcRenderer.invoke('projects:add') as Promise<
        Project | { error: string } | null
      >,
    activate: (id: string | null) =>
      ipcRenderer.invoke('projects:activate', id) as Promise<Project | null>,
    remove: (id: string) =>
      ipcRenderer.invoke('projects:remove', id) as Promise<void>,
  },
  auth: {
    startGoogleLogin: () =>
      ipcRenderer.invoke('auth:startGoogleLogin') as Promise<{
        idToken: string;
      }>,
  },
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll') as Promise<Task[]>,
    create: (input: { title: string; agent: Agent }) =>
      ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
    update: (
      id: string,
      patch: Partial<Pick<Task, 'title' | 'status' | 'agent' | 'description'>>,
    ) => ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task>,
    delete: (id: string) =>
      ipcRenderer.invoke('tasks:delete', id) as Promise<void>,
  },
  sessions: {
    start: (task: Task) =>
      ipcRenderer.invoke('session:start', task) as Promise<SessionStartResult>,
    stop: (sessionId: string) =>
      ipcRenderer.invoke('session:stop', sessionId) as Promise<void>,
    get: (taskId: string) =>
      ipcRenderer.invoke('session:get', taskId) as Promise<Session | null>,
    getAll: () => ipcRenderer.invoke('session:getAll') as Promise<Session[]>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('session:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('session:resize', sessionId, cols, rows),
    onData: (sessionId: string, cb: (data: string) => void) => {
      const channel = `session:data:${sessionId}`;
      ipcRenderer.on(channel, (_event, data: string) => cb(data));
      return () => ipcRenderer.removeAllListeners(channel);
    },
    onExit: (cb: (session: Session) => void) => {
      ipcRenderer.on('session:exited', (_event, session: Session) => cb(session));
      return () => ipcRenderer.removeAllListeners('session:exited');
    },
    openDedicatedWindow: (sessionId: string) =>
      ipcRenderer.invoke('session:openDedicatedWindow', sessionId) as Promise<
        { ok: true } | { ok: false; error: 'NO_SESSION' }
      >,
    isDedicatedOpen: (sessionId: string) =>
      ipcRenderer.invoke('session:isDedicatedOpen', sessionId) as Promise<boolean>,
    focusDedicatedWindow: (sessionId: string) =>
      ipcRenderer.invoke('session:focusDedicatedWindow', sessionId) as Promise<void>,
    onTerminalWindowClosed: (cb: (sessionId: string) => void) => {
      const handler = (_event: IpcRendererEvent, id: string) => cb(id);
      ipcRenderer.on('session:terminalWindowClosed', handler);
      return () => ipcRenderer.removeListener('session:terminalWindowClosed', handler);
    },
  },
});
