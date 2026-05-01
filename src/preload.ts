import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ActiveProjectKey,
  Agent,
  CloudProjectLocalBinding,
  LocalProject,
  PlanningSession,
  ProjectTabState,
  RepoConfig,
  Session,
  SessionStartResult,
  Shell,
  Task,
  TaskSessionStartProgress,
} from './types';
import type { AgentState, AttachResult, PlanningAttachResult } from './daemon/protocol';
import {
  MCP_BRIDGE_READY_CHANNEL,
  MCP_BRIDGE_REQUEST_CHANNEL,
  MCP_BRIDGE_RESPONSE_CHANNEL,
  type McpBridgeRequest,
  type McpBridgeResponse,
} from './mcpBridge';

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

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('openExternalUrl', url) as Promise<void>,
  project: {
    get: () => ipcRenderer.invoke('project:get') as Promise<LocalProject | null>,
    getDir: () => ipcRenderer.invoke('project:getDir') as Promise<string | null>,
    open: () =>
      ipcRenderer.invoke('project:open') as Promise<
        LocalProject | { error: 'NOT_GIT_REPO' } | null
      >,
    clear: () => ipcRenderer.invoke('project:clear') as Promise<void>,
    setPlanningAgent: (agent: Agent) =>
      ipcRenderer.invoke('project:setPlanningAgent', agent) as Promise<
        { ok: true } | { error: string }
      >,
    setDefaultTaskAgent: (agent: Agent) =>
      ipcRenderer.invoke('project:setDefaultTaskAgent', agent) as Promise<
        { ok: true } | { error: string }
      >,
    getRepos: () =>
      ipcRenderer.invoke('project:getRepos') as Promise<RepoConfig[]>,
    updateRepo: (payload: {
      rootPath: string;
      patch: Partial<Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env'>>;
    }) =>
      ipcRenderer.invoke('project:updateRepo', payload) as Promise<
        { ok: true; repos: RepoConfig[] } | { error: string }
      >,
    getAutoStartSessionOnInProgress: () =>
      ipcRenderer.invoke('project:getAutoStartSessionOnInProgress') as Promise<boolean>,
    setAutoStartSessionOnInProgress: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoStartSessionOnInProgress', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
    getAutoStartWhenUnblocked: () =>
      ipcRenderer.invoke('project:getAutoStartWhenUnblocked') as Promise<boolean>,
    setAutoStartWhenUnblocked: (enabled: boolean) =>
      ipcRenderer.invoke('project:setAutoStartWhenUnblocked', enabled) as Promise<
        { ok: true; enabled: boolean } | { error: string }
      >,
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
    /** Per-project tab strip state, for session-continuity restoration. */
    getTabs: (key: ActiveProjectKey) =>
      ipcRenderer.invoke('projects:getTabs', key) as Promise<ProjectTabState>,
    setTabs: (key: ActiveProjectKey, tabs: ProjectTabState) =>
      ipcRenderer.invoke('projects:setTabs', key, tabs) as Promise<void>,
    getLocalBinding: (cloudProjectId: string) =>
      ipcRenderer.invoke('projects:getLocalBinding', cloudProjectId) as Promise<
        CloudProjectLocalBinding | null
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
    create: (input: {
      title: string;
      agent: Agent;
      blockedByTaskIds?: string[];
      labels?: string[];
    }) => ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
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
    ) => ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task>,
    delete: (id: string) =>
      ipcRenderer.invoke('tasks:delete', id) as Promise<void>,
    cleanupResources: (id: string) =>
      ipcRenderer.invoke('tasks:cleanupResources', id) as Promise<{ errors: string[] }>,
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('tasks:changed', handler);
      return () => ipcRenderer.removeListener('tasks:changed', handler);
    },
  },
  sessions: {
    start: (task: Task, projectTasks?: Task[]) =>
      ipcRenderer.invoke('session:start', task, projectTasks) as Promise<SessionStartResult>,
    archive: (sessionId: string) =>
      ipcRenderer.invoke('session:archive', sessionId) as Promise<void>,
    deleteWorkspace: (sessionId: string) =>
      ipcRenderer.invoke('session:delete', sessionId) as Promise<void>,
    get: (taskId: string) =>
      ipcRenderer.invoke('session:get', taskId) as Promise<Session | null>,
    getAll: () => ipcRenderer.invoke('session:getAll') as Promise<Session[]>,
    /** Warm-reattach: daemon attach payload (`replay` and optional `snapshot`). */
    attach: (sessionId: string) =>
      ipcRenderer.invoke('session:attach', sessionId) as Promise<AttachResult | null>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('session:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('session:resize', sessionId, cols, rows),
    onData: (
      sessionId: string,
      cb: (data: string, streamSeq?: number) => void,
    ) => {
      const channel = `session:data:${sessionId}`;
      const handler = (
        _e: unknown,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeAllListeners(channel);
    },
    onExit: (cb: (session: Session) => void) => {
      ipcRenderer.on('session:exited', (_event, session: Session) => cb(session));
      return () => ipcRenderer.removeAllListeners('session:exited');
    },
    onAgentState: (sessionId: string, cb: (state: AgentState) => void) => {
      const channel = `session:agent-state:${sessionId}`;
      const handler = (_e: unknown, payload: { state: AgentState }) => cb(payload.state);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onTaskStartProgress: (cb: (p: TaskSessionStartProgress) => void) => {
      const ch = 'session:taskStartProgress' as const;
      const handler = (
        _e: IpcRendererEvent,
        p: TaskSessionStartProgress,
      ) => {
        cb(p);
      };
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
  },
  shells: {
    open: (sessionId: string) =>
      ipcRenderer.invoke('shell:open', sessionId) as Promise<Shell>,
    close: (shellId: string) =>
      ipcRenderer.invoke('shell:close', shellId) as Promise<void>,
    list: (sessionId: string) =>
      ipcRenderer.invoke('shell:list', sessionId) as Promise<Shell[]>,
    attach: (shellId: string) =>
      ipcRenderer.invoke('shell:attach', shellId) as Promise<AttachResult | null>,
    write: (shellId: string, data: string) =>
      ipcRenderer.send('shell:write', shellId, data),
    resize: (shellId: string, cols: number, rows: number) =>
      ipcRenderer.send('shell:resize', shellId, cols, rows),
    onData: (shellId: string, cb: (data: string, streamSeq?: number) => void) => {
      const channel = `shell:data:${shellId}`;
      const handler = (
        _e: unknown,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeAllListeners(channel);
    },
    onExit: (cb: (shell: Shell) => void) => {
      ipcRenderer.on('shell:exited', (_event, shell: Shell) => cb(shell));
      return () => ipcRenderer.removeAllListeners('shell:exited');
    },
  },
  planning: {
    list: () =>
      ipcRenderer.invoke('planning:list') as Promise<PlanningSession[]>,
    start: (agent: Agent) =>
      ipcRenderer.invoke('planning:start', agent) as Promise<PlanningStartResult>,
    stop: (sessionId: string) =>
      ipcRenderer.invoke('planning:stop', sessionId) as Promise<void>,
    get: (sessionId: string) =>
      ipcRenderer.invoke('planning:get', sessionId) as Promise<PlanningSession | null>,
    attach: (sessionId: string) =>
      ipcRenderer.invoke('planning:attach', sessionId) as Promise<PlanningAttachResult | null>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('planning:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('planning:resize', sessionId, cols, rows),
    onData: (
      sessionId: string,
      cb: (data: string, streamSeq?: number) => void,
    ) => {
      const channel = `planning:data:${sessionId}`;
      const handler = (
        _e: IpcRendererEvent,
        arg: string | { data: string; seq?: number },
      ) => {
        if (typeof arg === 'string') cb(arg);
        else cb(arg.data, arg.seq);
      };
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeAllListeners(channel);
    },
    onExit: (cb: (session: PlanningSession) => void) => {
      const handler = (_e: IpcRendererEvent, session: PlanningSession) =>
        cb(session);
      ipcRenderer.on('planning:exited', handler);
      return () => ipcRenderer.removeListener('planning:exited', handler);
    },
  },
  cursorAgent: {
    listModels: () =>
      ipcRenderer.invoke('cursor:listAgentModels') as Promise<ListCursorAgentModelsResult>,
  },
  planningDocs: {
    list: () =>
      ipcRenderer.invoke('planningDocs:list') as Promise<
        | { files: { relativePath: string }[] }
        | { error: 'NO_PROJECT' | 'IO_ERROR' }
      >,
    read: (relativePath: string) =>
      ipcRenderer.invoke('planningDocs:read', relativePath) as Promise<
        { content: string } | { error: string }
      >,
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('planningDocs:changed', handler);
      return () => ipcRenderer.removeListener('planningDocs:changed', handler);
    },
  },
  mcpBridge: {
    signalReady: () => ipcRenderer.send(MCP_BRIDGE_READY_CHANNEL),
    onRequest: (cb: (req: McpBridgeRequest) => void) => {
      const handler = (_e: IpcRendererEvent, req: McpBridgeRequest) => cb(req);
      ipcRenderer.on(MCP_BRIDGE_REQUEST_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(MCP_BRIDGE_REQUEST_CHANNEL, handler);
    },
    respond: (resp: McpBridgeResponse) => {
      ipcRenderer.send(MCP_BRIDGE_RESPONSE_CHANNEL, resp);
    },
  },
});
