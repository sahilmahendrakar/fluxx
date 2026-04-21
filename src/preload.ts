import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ActiveProjectKey, Agent, LocalProject, PlanningSession, Session, Task } from './types';

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

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  project: {
    get: () => ipcRenderer.invoke('project:get') as Promise<LocalProject | null>,
    getDir: () => ipcRenderer.invoke('project:getDir') as Promise<string | null>,
    open: () =>
      ipcRenderer.invoke('project:open') as Promise<
        LocalProject | { error: 'NOT_GIT_REPO' } | null
      >,
    clear: () => ipcRenderer.invoke('project:clear') as Promise<void>,
  },
  projects: {
    listLocal: () =>
      ipcRenderer.invoke('projects:listLocal') as Promise<LocalProject[]>,
    addLocal: () =>
      ipcRenderer.invoke('projects:addLocal') as Promise<
        LocalProject | { error: 'NOT_GIT_REPO' } | null
      >,
    activateLocal: (id: string | null) =>
      ipcRenderer.invoke('projects:activateLocal', id) as Promise<LocalProject | null>,
    removeLocal: (id: string) =>
      ipcRenderer.invoke('projects:removeLocal', id) as Promise<void>,
    getActiveKey: () =>
      ipcRenderer.invoke('projects:getActiveKey') as Promise<ActiveProjectKey | null>,
    clearActive: () => ipcRenderer.invoke('projects:clearActive') as Promise<void>,
    getLocalBinding: (cloudProjectId: string) =>
      ipcRenderer.invoke('projects:getLocalBinding', cloudProjectId) as Promise<
        { rootPath: string; lastOpenedAt: string } | null
      >,
    pickDirectoryForCloud: (cloudProjectId: string) =>
      ipcRenderer.invoke(
        'projects:pickDirectoryForCloud',
        cloudProjectId,
      ) as Promise<DirPickResult>,
    activateCloud: (payload: { id: string; rootPath: string }) =>
      ipcRenderer.invoke('projects:activateCloud', payload) as Promise<ActivateCloudResult>,
    clearLocalBinding: (cloudProjectId: string) =>
      ipcRenderer.invoke('projects:clearLocalBinding', cloudProjectId) as Promise<void>,
  },
  auth: {
    startGoogleLogin: () =>
      ipcRenderer.invoke('auth:startGoogleLogin') as Promise<{
        idToken: string;
      }>,
  },
  email: {
    isConfigured: () =>
      ipcRenderer.invoke('email:isConfigured') as Promise<boolean>,
    sendInvite: (input: {
      to: string;
      projectName: string;
      inviterName?: string;
      inviterEmail?: string;
    }) =>
      ipcRenderer.invoke('email:sendInvite', input) as Promise<
        { ok: true } | { error: string }
      >,
  },
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll') as Promise<Task[]>,
    create: (input: { title: string; agent: Agent }) =>
      ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
    update: (
      id: string,
      patch: Partial<
        Pick<Task, 'title' | 'status' | 'agent' | 'description' | 'orderKey'>
      >,
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
  planning: {
    start: () => ipcRenderer.invoke('planning:start') as Promise<PlanningStartResult>,
    stop: () => ipcRenderer.invoke('planning:stop') as Promise<void>,
    get: () => ipcRenderer.invoke('planning:get') as Promise<PlanningSession | null>,
    write: (data: string) => ipcRenderer.send('planning:write', data),
    resize: (cols: number, rows: number) => ipcRenderer.send('planning:resize', cols, rows),
    onData: (cb: (data: string) => void) => {
      ipcRenderer.on('planning:data', (_e, data) => cb(data));
      return () => ipcRenderer.removeAllListeners('planning:data');
    },
    onExit: (cb: (session: PlanningSession) => void) => {
      ipcRenderer.on('planning:exited', (_e, session) => cb(session));
      return () => ipcRenderer.removeAllListeners('planning:exited');
    },
  },
});
