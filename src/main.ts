import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore } from './main/ProjectStore';
import { McpServer } from './main/McpServer';
import { AppStateStore } from './main/AppStateStore';
import { LocalBindingStore } from './main/LocalBindingStore';
import { WorktreeService } from './main/WorktreeService';
import { DaemonClient } from './main/DaemonClient';
import {
  agentNotFoundMessage,
  agentSpawnSpec,
  ensurePlanningDirCursorMcp,
  planningSpawnSpec,
  taskInitialPrompt,
} from './main/agentSpawn';
import { AuthServer } from './main/AuthServer';
import { EmailService, type InviteEmailInput } from './main/EmailService';
import { createPlanningDocsWatcher } from './main/PlanningDocsWatcher';
import type {
  ActiveProjectKey,
  Agent,
  LocalProject,
  PlanningSession,
  Project,
  RepoConfig,
  Session,
  Task,
} from './types';

function isPlanningAgent(value: unknown): value is Agent {
  return value === 'claude-code' || value === 'codex' || value === 'cursor';
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

interface LegacyProjectsFile {
  schemaVersion?: number;
  projects?: unknown[];
  activeProjectKey?: { kind?: string; id?: string };
  activeProjectId?: string | null;
}

function parseLegacyLocalRow(value: unknown): { id: string; rootPath: string } | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.rootPath !== 'string') return null;
  return { id: p.id, rootPath: p.rootPath };
}

async function migrateLegacyProjectsJson(params: {
  userData: string;
  fluxBaseDir: string;
  appStateStore: AppStateStore;
  projectStore: ProjectStore;
  taskStore: TaskStore;
  worktreeService: WorktreeService;
}): Promise<void> {
  const { userData, appStateStore, projectStore, taskStore, worktreeService } = params;
  const s = appStateStore.get();
  if (s.lastOpenedProjectDir || s.activeProjectKey) return;

  const trySingleProjectJson = async (): Promise<boolean> => {
    try {
      const raw = await fs.readFile(path.join(userData, 'project.json'), 'utf8');
      const p = JSON.parse(raw) as { rootPath?: string };
      if (typeof p.rootPath !== 'string' || !p.rootPath) return false;
      try {
        await fs.access(path.join(p.rootPath, '.git'));
      } catch {
        return false;
      }
      const { project, projectDir } = await projectStore.create(p.rootPath);
      await taskStore.reinit(projectDir);
      await taskStore.migrateMissingProjectIds(project.id);
      worktreeService.setRootPath(project.rootPath);
      worktreeService.setProjectDir(projectDir);
      await appStateStore.set({
        lastOpenedProjectDir: projectDir,
        activeProjectKey: { kind: 'local', id: project.id },
      });
      return true;
    } catch {
      return false;
    }
  };

  const legacyPath = path.join(userData, 'projects.json');
  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, 'utf8');
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') {
      await trySingleProjectJson();
      return;
    }
    throw err;
  }

  let parsed: LegacyProjectsFile;
  try {
    parsed = JSON.parse(raw) as LegacyProjectsFile;
  } catch {
    await trySingleProjectJson();
    return;
  }

  if (!parsed || !Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    await trySingleProjectJson();
    return;
  }

  if (
    parsed.activeProjectKey &&
    typeof parsed.activeProjectKey === 'object' &&
    parsed.activeProjectKey.kind === 'cloud' &&
    typeof parsed.activeProjectKey.id === 'string' &&
    parsed.activeProjectKey.id
  ) {
    await appStateStore.set({
      lastOpenedProjectDir: null,
      activeProjectKey: { kind: 'cloud', id: parsed.activeProjectKey.id },
    });
    return;
  }

  const locals = parsed.projects
    .map(parseLegacyLocalRow)
    .filter((row): row is { id: string; rootPath: string } => row !== null);

  let activeId: string | null = null;
  if (
    parsed.activeProjectKey &&
    typeof parsed.activeProjectKey === 'object' &&
    parsed.activeProjectKey.kind === 'local' &&
    typeof parsed.activeProjectKey.id === 'string'
  ) {
    activeId = parsed.activeProjectKey.id;
  } else if (typeof parsed.activeProjectId === 'string' && parsed.activeProjectId) {
    activeId = parsed.activeProjectId;
  }

  const chosen = activeId ? locals.find((l) => l.id === activeId) : locals[0];
  if (!chosen) {
    await trySingleProjectJson();
    return;
  }

  try {
    await fs.access(path.join(chosen.rootPath, '.git'));
  } catch {
    return;
  }

  const { project, projectDir } = await projectStore.create(chosen.rootPath);
  await taskStore.reinit(projectDir);
  await taskStore.migrateMissingProjectIds(project.id);
  worktreeService.setRootPath(project.rootPath);
  worktreeService.setProjectDir(projectDir);
  await appStateStore.set({
    lastOpenedProjectDir: projectDir,
    activeProjectKey: { kind: 'local', id: project.id },
  });
}

// Matches renderer `bg-gray-950` (Tailwind default palette) so native chrome
// and any pre-paint window surface are not a contrasting light color.
const WINDOW_BACKGROUND = '#030712';

let mainWindow: BrowserWindow | null = null;

let fluxMcpServer: McpServer | null = null;

let planningDocsWatcher: ReturnType<typeof createPlanningDocsWatcher> | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Flux',
    backgroundColor: WINDOW_BACKGROUND,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // With `hiddenInset`, a light system appearance can leave a 1px bright seam on
    // the top edge (macOS + Electron; see electron/electron#51015). Dark window chrome
    // matches this app and removes that line.
    nativeTheme.themeSource = 'dark';
  }

  const fluxBaseDir = path.join(os.homedir(), '.flux');
  await fs.mkdir(fluxBaseDir, { recursive: true });

  const appStateStore = new AppStateStore();
  await appStateStore.init();

  const projectStore = new ProjectStore(fluxBaseDir);
  const taskStore = new TaskStore('');
  await taskStore.init();

  const worktreeService = new WorktreeService('', '');
  worktreeService.setRepoConfigGetter(async (rootPath) => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) return null;
    try {
      const repos = await projectStore.getReposAt(projectDir);
      return repos.find((r) => r.rootPath === rootPath) ?? null;
    } catch {
      return null;
    }
  });
  const daemonClient = new DaemonClient();
  try {
    await daemonClient.ensureRunning();
  } catch (err) {
    console.error('[main] failed to start flux-daemon', err);
  }

  const userData = app.getPath('userData');
  await migrateLegacyProjectsJson({
    userData,
    fluxBaseDir,
    appStateStore,
    projectStore,
    taskStore,
    worktreeService,
  });

  const { lastOpenedProjectDir, activeProjectKey } = appStateStore.get();

  const shouldRestoreLocal =
    activeProjectKey?.kind === 'local' &&
    typeof lastOpenedProjectDir === 'string' &&
    lastOpenedProjectDir.length > 0;

  if (shouldRestoreLocal) {
    try {
      await projectStore.init(lastOpenedProjectDir);
      const project = projectStore.get();
      if (project && project.id === activeProjectKey.id) {
        await taskStore.reinit(lastOpenedProjectDir);
        await projectStore.ensureLayoutForRoot(project.rootPath);
        worktreeService.setRootPath(project.rootPath);
        worktreeService.setProjectDir(lastOpenedProjectDir);
      } else {
        await appStateStore.set({
          lastOpenedProjectDir: null,
          activeProjectKey: null,
        });
        await projectStore.clear();
        await taskStore.reinit('');
      }
    } catch {
      await appStateStore.set({
        lastOpenedProjectDir: null,
        activeProjectKey: null,
      });
      await projectStore.clear();
      await taskStore.reinit('');
      worktreeService.setRootPath('');
      worktreeService.setProjectDir('');
    }
  } else if (!activeProjectKey && lastOpenedProjectDir) {
    try {
      await projectStore.init(lastOpenedProjectDir);
      const project = projectStore.get();
      if (project) {
        await taskStore.reinit(lastOpenedProjectDir);
        await projectStore.ensureLayoutForRoot(project.rootPath);
        worktreeService.setRootPath(project.rootPath);
        worktreeService.setProjectDir(lastOpenedProjectDir);
        await appStateStore.set({
          activeProjectKey: { kind: 'local', id: project.id },
        });
      }
    } catch {
      await appStateStore.set({ lastOpenedProjectDir: null });
      await projectStore.clear();
      await taskStore.reinit('');
      worktreeService.setRootPath('');
      worktreeService.setProjectDir('');
    }
  }

  const bindingStore = new LocalBindingStore();
  await bindingStore.init();

  let activeRootPath = projectStore.get()?.rootPath ?? '';
  if (activeProjectKey?.kind === 'cloud') {
    const binding = bindingStore.get(activeProjectKey.id);
    if (binding) {
      try {
        await fs.access(path.join(binding.rootPath, '.git'));
        activeRootPath = binding.rootPath;
      } catch {
        activeRootPath = '';
      }
    }
  }

  if (activeProjectKey?.kind === 'cloud' && activeRootPath) {
    try {
      const { projectDir } = await projectStore.ensureLayoutForRoot(activeRootPath);
      worktreeService.setRootPath(activeRootPath);
      worktreeService.setProjectDir(projectDir);
    } catch {
      worktreeService.setRootPath('');
      worktreeService.setProjectDir('');
    }
  }

  const authServer = new AuthServer();
  const emailService = new EmailService();

  async function pickDirectory(
    title: string,
  ): Promise<{ rootPath: string } | { error: 'NOT_GIT_REPO' } | null> {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const dialogOpts = {
      properties: ['openDirectory' as const],
      title,
      buttonLabel: 'Open project',
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    try {
      await fs.access(path.join(rootPath, '.git'));
    } catch {
      return { error: 'NOT_GIT_REPO' as const };
    }
    return { rootPath };
  }

  async function openLocalProjectFromRoot(rootPath: string): Promise<LocalProject> {
    const { project, projectDir } = await projectStore.create(rootPath);
    await taskStore.reinit(projectDir);
    await taskStore.migrateMissingProjectIds(project.id);
    worktreeService.setRootPath(rootPath);
    worktreeService.setProjectDir(projectDir);
    await appStateStore.set({
      lastOpenedProjectDir: projectDir,
      activeProjectKey: { kind: 'local', id: project.id },
    });
    return project;
  }

  async function clearLocalWorkspaceState(): Promise<void> {
    await projectStore.clear();
    await appStateStore.set({
      lastOpenedProjectDir: null,
      activeProjectKey: null,
    });
    await taskStore.reinit('');
    worktreeService.setRootPath('');
    worktreeService.setProjectDir('');
  }

  // ---- Project (legacy single-project API; returns the active LOCAL project) ----
  ipcMain.handle('project:get', () => projectStore.get());
  ipcMain.handle('project:getDir', () => projectStore.getProjectDir());
  ipcMain.handle(
    'project:setPlanningAgent',
    async (_e, agent: unknown): Promise<{ ok: true } | { error: string }> => {
      if (!isPlanningAgent(agent)) {
        return { error: 'INVALID_AGENT' };
      }
      try {
        await projectStore.setPlanningAgent(agent);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:open', async () => {
    const parent = mainWindow ?? BrowserWindow.getFocusedWindow();
    const dialogOpts = {
      properties: ['openDirectory' as const],
      title: 'Open project folder',
      buttonLabel: 'Open project',
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) return null;

    const rootPath = result.filePaths[0];
    try {
      await fs.access(path.join(rootPath, '.git'));
    } catch {
      return { error: 'NOT_GIT_REPO' as const };
    }

    const proj = await openLocalProjectFromRoot(rootPath);
    return proj;
  });
  ipcMain.handle('project:clear', async () => {
    await projectStore.clear();
    await appStateStore.set({
      lastOpenedProjectDir: null,
      activeProjectKey: null,
    });
  });

  // ---- Per-repo settings (works for both local and cloud projects) ----
  function activeProjectDir(): string {
    const local = projectStore.getProjectDir();
    if (local) return local;
    const fromWorktree = worktreeService.getProjectDir();
    if (fromWorktree) return fromWorktree;
    throw new Error('No active project');
  }

  ipcMain.handle('project:getRepos', async (): Promise<RepoConfig[]> => {
    return projectStore.getReposAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:updateRepo',
    async (
      _e,
      payload: {
        rootPath: string;
        patch: Partial<Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env'>>;
      },
    ): Promise<{ ok: true; repos: RepoConfig[] } | { error: string }> => {
      try {
        const repos = await projectStore.updateRepoAt(
          activeProjectDir(),
          payload.rootPath,
          payload.patch,
        );
        return { ok: true, repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  // ---- Projects (multi-project API) ----
  ipcMain.handle('projects:listLocal', () => projectStore.listDiscovered());
  ipcMain.handle('projects:addLocal', async () => {
    const picked = await pickDirectory('Open project folder');
    if (!picked || 'error' in picked) return picked;
    return openLocalProjectFromRoot(picked.rootPath);
  });
  ipcMain.handle(
    'projects:activateLocal',
    async (_e, id: string | null): Promise<LocalProject | null> => {
      if (id === null) {
        await clearLocalWorkspaceState();
        return null;
      }
      const current = projectStore.get();
      if (current?.id === id) {
        return current;
      }
      const projectDir = await projectStore.findProjectDirById(id);
      if (!projectDir) throw new Error(`Local project not found: ${id}`);
      await projectStore.init(projectDir);
      const project = projectStore.get();
      if (!project) throw new Error(`Local project not found: ${id}`);
      await projectStore.ensureLayoutForRoot(project.rootPath);
      await taskStore.reinit(projectDir);
      await taskStore.migrateMissingProjectIds(project.id);
      worktreeService.setRootPath(project.rootPath);
      worktreeService.setProjectDir(projectDir);
      await appStateStore.set({
        lastOpenedProjectDir: projectDir,
        activeProjectKey: { kind: 'local', id: project.id },
      });
      return project;
    },
  );
  ipcMain.handle('projects:removeLocal', async (_e, id: string) => {
    const current = projectStore.get();
    if (current?.id === id) {
      await clearLocalWorkspaceState();
    }
  });

  ipcMain.handle('projects:getActiveKey', (): ActiveProjectKey | null => {
    return appStateStore.get().activeProjectKey;
  });

  // ---- Tab strip restoration (per project open task tabs + active tab) ----
  ipcMain.handle(
    'projects:getTabs',
    (_e, key: ActiveProjectKey) => appStateStore.getProjectTabs(key),
  );
  ipcMain.handle(
    'projects:setTabs',
    async (
      _e,
      key: ActiveProjectKey,
      tabs: { openTaskIds: string[]; activeTaskId: string | null },
    ) => {
      await appStateStore.setProjectTabs(key, tabs);
    },
  );

  ipcMain.handle('projects:clearActive', async () => {
    await appStateStore.set({
      activeProjectKey: null,
      lastOpenedProjectDir: null,
    });
    await projectStore.clear();
    await taskStore.reinit('');
    worktreeService.setRootPath('');
    worktreeService.setProjectDir('');
  });

  // ---- Cloud project bindings (per-user local rootPath for a Firestore project) ----
  ipcMain.handle(
    'projects:getLocalBinding',
    async (_e, cloudProjectId: string) => bindingStore.get(cloudProjectId),
  );
  ipcMain.handle(
    'projects:pickDirectoryForCloud',
    async (_e, cloudProjectId: string) => {
      const picked = await pickDirectory('Pick the local folder for this project');
      if (!picked || 'error' in picked) return picked;
      const binding = await bindingStore.set(cloudProjectId, picked.rootPath);
      return { rootPath: binding.rootPath };
    },
  );
  ipcMain.handle(
    'projects:activateCloud',
    async (_e, payload: { id: string; rootPath: string }) => {
      try {
        await fs.access(path.join(payload.rootPath, '.git'));
      } catch {
        return { error: 'NOT_GIT_REPO' as const };
      }
      await bindingStore.set(payload.id, payload.rootPath);
      await projectStore.clear();
      await taskStore.reinit('');
      const { projectDir } = await projectStore.ensureLayoutForRoot(payload.rootPath);
      worktreeService.setRootPath(payload.rootPath);
      worktreeService.setProjectDir(projectDir);
      await appStateStore.set({
        activeProjectKey: { kind: 'cloud', id: payload.id },
      });
      return { ok: true as const };
    },
  );
  ipcMain.handle('projects:clearLocalBinding', async (_e, cloudProjectId: string) => {
    await bindingStore.remove(cloudProjectId);
  });

  // ---- Auth ----
  ipcMain.handle('auth:startGoogleLogin', async () => authServer.startGoogleLogin());

  // ---- OS (external browser) ----
  ipcMain.handle('openExternalUrl', async (_e, raw: unknown): Promise<void> => {
    if (typeof raw !== 'string' || raw.length === 0) return;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    try {
      await shell.openExternal(parsed.href);
    } catch (err) {
      console.error('[openExternalUrl]', err);
    }
  });

  // ---- Email (Resend) ----
  console.log(
    `[email] Resend ${emailService.isConfigured() ? 'configured' : 'NOT configured'}`,
  );
  ipcMain.handle('email:isConfigured', () => emailService.isConfigured());
  ipcMain.handle(
    'email:sendInvite',
    async (_e, input: InviteEmailInput): Promise<{ ok: true } | { error: string }> => {
      console.log(`[email:sendInvite] -> ${input.to} (${input.projectName})`);
      try {
        await emailService.sendInviteEmail(input);
        console.log(`[email:sendInvite] sent to ${input.to}`);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[email:sendInvite] failed', msg);
        return { error: msg };
      }
    },
  );

  // ---- Tasks (local-only; cloud tasks live in Firestore in the renderer) ----
  ipcMain.handle('tasks:getAll', async () => {
    const project = projectStore.get();
    if (!project) return [];
    return taskStore.getAll(project.id);
  });

  ipcMain.handle('tasks:create', async (_e, input: { title: string; agent: Agent }) => {
    const project = projectStore.get();
    if (!project) {
      throw new Error('No local project open');
    }
    return taskStore.create({ ...input, projectId: project.id });
  });
  ipcMain.handle('tasks:update', async (_e, id, patch) =>
    taskStore.update(id, patch),
  );
  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  async function resolveProjectForStart(): Promise<Project> {
    const activeKey = appStateStore.get().activeProjectKey;
    if (!activeKey) throw new Error('No project open');
    if (activeKey.kind === 'local') {
      const project = projectStore.get();
      if (!project) throw new Error('No local project open');
      return project;
    }
    const binding = bindingStore.get(activeKey.id);
    if (!binding) throw new Error('Cloud project is not bound to a local folder');
    return {
      id: activeKey.id,
      kind: 'cloud',
      name: path.basename(binding.rootPath),
      rootPath: binding.rootPath,
      ownerId: '',
      memberIds: [],
      createdAt: '',
    };
  }

  async function startSessionForTask(
    task: Task,
  ): Promise<
    | Session
    | { error: 'AGENT_NOT_FOUND' | 'WORKTREE_FAILED'; message: string }
  > {
    const project = await resolveProjectForStart();

    // Dedup against the daemon's live registry.
    const existing = (await daemonClient.listSessions()).find(
      (s) => s.taskId === task.id && s.status === 'running',
    );
    if (existing) return existing;

    let worktreePath = '';
    let branch = '';
    try {
      const created = await worktreeService.create(task.id);
      worktreePath = created.worktreePath;
      branch = created.branch;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[session:start] worktree create failed', {
        taskId: task.id,
        projectId: project.id,
        message,
      });
      return { error: 'WORKTREE_FAILED', message };
    }

    const initialPrompt = taskInitialPrompt(task);
    const { command, args } = agentSpawnSpec(task.agent, initialPrompt);
    const result = await daemonClient.createSession({
      worktreePath,
      branch,
      taskId: task.id,
      projectId: project.id,
      agent: task.agent,
      command,
      args,
      cols: 80,
      rows: 24,
    });
    if ('error' in result) {
      console.error('[session:start] daemon spawn failed', {
        taskId: task.id,
        command,
        args,
        error: result.error,
        message: result.message,
      });
      try {
        await worktreeService.remove(worktreePath);
      } catch (removeErr: unknown) {
        console.error('[session:start] cleanup worktree after spawn failure', removeErr);
      }
      if (result.error === 'AGENT_NOT_FOUND') {
        return {
          error: 'AGENT_NOT_FOUND',
          message: agentNotFoundMessage(task.agent, command),
        };
      }
      return { error: 'AGENT_NOT_FOUND', message: result.message };
    }
    return result;
  }

  ipcMain.handle('session:start', async (_e, task: Task) => startSessionForTask(task));

  ipcMain.handle('session:archive', async (_e, sessionId: string) => {
    await daemonClient.closeShellsForSession(sessionId);
    await daemonClient.stopSession(sessionId);
  });

  ipcMain.handle('session:delete', async (_e, sessionId: string) => {
    const sessions = await daemonClient.listSessions();
    const target = sessions.find((s) => s.id === sessionId);
    await daemonClient.closeShellsForSession(sessionId);
    await daemonClient.stopSession(sessionId);
    if (target?.worktreePath) {
      try {
        await worktreeService.remove(target.worktreePath);
      } catch (err: unknown) {
        console.error('[session:delete] worktree remove failed', {
          sessionId,
          err,
        });
      }
    }
  });

  ipcMain.handle('session:get', async (_e, taskId: string) => {
    const sessions = await daemonClient.listSessions();
    return sessions.find((s) => s.taskId === taskId) ?? null;
  });

  ipcMain.handle('session:getAll', async () => daemonClient.listSessions());

  ipcMain.handle('session:attach', async (_e, sessionId: string) =>
    daemonClient.attachSession(sessionId),
  );

  ipcMain.on('session:write', (_e, sessionId: string, data: string) => {
    daemonClient.writeSession(sessionId, data);
  });

  ipcMain.on('session:resize', (_e, sessionId: string, cols: number, rows: number) => {
    daemonClient.resizeSession(sessionId, cols, rows);
  });

  fluxMcpServer = new McpServer(taskStore, projectStore, () => mainWindow);
  fluxMcpServer.start();

  ipcMain.handle(
    'planning:start',
    async (_e, requestedAgent: unknown) => {
      const activeKey = appStateStore.get().activeProjectKey;
      if (!activeKey) {
        return { error: 'No project open' };
      }

      let project: Project;
      let projectDir: string;
      let planningAgent: Agent;

      if (activeKey.kind === 'local') {
        const local = projectStore.get();
        projectDir = projectStore.getProjectDir() ?? '';
        if (!local || !projectDir) {
          return { error: 'No project open' };
        }
        planningAgent = isPlanningAgent(requestedAgent)
          ? requestedAgent
          : local.planningAgent;
        try {
          await projectStore.setPlanningAgent(planningAgent);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: 'CONFIG_WRITE_FAILED', message };
        }
        const updated = projectStore.get();
        project = updated ?? local;
      } else {
        const binding = bindingStore.get(activeKey.id);
        projectDir = worktreeService.getProjectDir();
        if (!binding || !projectDir) {
          return { error: 'No project open' };
        }
        project = {
          id: activeKey.id,
          kind: 'cloud',
          name: path.basename(binding.rootPath),
          rootPath: binding.rootPath,
          ownerId: '',
          memberIds: [],
          createdAt: '',
        };
        planningAgent = 'claude-code';
      }

      // If the daemon already has a planning session running, reuse it.
      const existing = await daemonClient.getPlanning();
      if (existing) return existing;

      const planningDir = path.join(projectDir, 'planning');
      const mcpConfigPath = path.join(projectDir, 'mcp.json');
      await fs.mkdir(planningDir, { recursive: true });
      const { ensurePlanningAssistantMarkdownFiles } = await import(
        './main/ProjectStore'
      );
      await ensurePlanningAssistantMarkdownFiles(
        planningDir,
        project.name,
        project.rootPath,
      );
      try {
        await fs.access(mcpConfigPath);
      } catch {
        await fs.writeFile(
          mcpConfigPath,
          `${JSON.stringify(
            {
              mcpServers: {
                flux: { type: 'sse', url: 'http://localhost:47432/sse' },
              },
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      }
      if (planningAgent === 'cursor') {
        await ensurePlanningDirCursorMcp(planningDir);
      }

      const { command, args } = planningSpawnSpec(planningAgent, mcpConfigPath);
      const result = await daemonClient.startPlanning({
        projectId: project.id,
        agent: planningAgent,
        planningDir,
        command,
        args,
        cols: 220,
        rows: 50,
      });
      if ('error' in result) {
        console.error('[planning:start] daemon spawn failed', {
          projectId: project.id,
          command,
          args,
          error: result.error,
          message: result.message,
        });
        if (result.error === 'AGENT_NOT_FOUND') {
          return {
            error: 'AGENT_NOT_FOUND',
            message: agentNotFoundMessage(planningAgent, command),
          };
        }
        return { error: result.error, message: result.message };
      }
      return result;
    },
  );

  ipcMain.handle('planning:stop', async () => daemonClient.stopPlanning());

  ipcMain.handle('planning:get', async () => daemonClient.getPlanning());

  ipcMain.handle(
    'planning:attach',
    async (): Promise<
      | {
          replay: string;
          cols: number;
          rows: number;
          session: PlanningSession;
        }
      | null
    > => daemonClient.attachPlanning(),
  );

  ipcMain.on('planning:write', (_e, data: string) => {
    daemonClient.writePlanning(data);
  });

  ipcMain.on('planning:resize', (_e, cols: number, rows: number) => {
    daemonClient.resizePlanning(cols, rows);
  });

  function fluxProjectDirOrNull(): string | null {
    const fromStore = projectStore.getProjectDir();
    if (fromStore) return fromStore;
    const fromWorktree = worktreeService.getProjectDir();
    return fromWorktree || null;
  }

  function resolvePlanningDocsDir(): string | null {
    const projectDir = fluxProjectDirOrNull();
    if (!projectDir) return null;
    return path.join(projectDir, 'planning');
  }

  async function collectMarkdownRelPaths(dir: string, base: string): Promise<string[]> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of sorted) {
      const rel = base ? `${base}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out.push(...(await collectMarkdownRelPaths(full, rel)));
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
    return out;
  }

  function safePlanningMarkdownPath(planningDir: string, relativePath: string): string | null {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) return null;
    const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const candidate = path.resolve(planningDir, rel);
    const resolvedRoot = path.resolve(planningDir);
    if (candidate === resolvedRoot) return null;
    const relCheck = path.relative(resolvedRoot, candidate);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
    return candidate;
  }

  ipcMain.handle('planningDocs:list', async () => {
    const planningDir = resolvePlanningDocsDir();
    if (!planningDir) {
      return { error: 'NO_PROJECT' as const };
    }
    try {
      await fs.mkdir(planningDir, { recursive: true });
    } catch {
      return { error: 'IO_ERROR' as const };
    }
    planningDocsWatcher?.sync();
    const relativePaths = await collectMarkdownRelPaths(planningDir, '');
    return { files: relativePaths.map((p) => ({ relativePath: p })) };
  });

  ipcMain.handle(
    'planningDocs:read',
    async (
      _e,
      relativePath: string,
    ): Promise<{ content: string } | { error: string }> => {
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) {
        return { error: 'NO_PROJECT' };
      }
      const filePath = safePlanningMarkdownPath(planningDir, relativePath);
      if (!filePath) {
        return { error: 'INVALID_PATH' };
      }
      try {
        const content = await fs.readFile(filePath, 'utf8');
        return { content };
      } catch (err: unknown) {
        if (errnoCode(err) === 'ENOENT') return { error: 'NOT_FOUND' };
        return { error: 'READ_FAILED' };
      }
    },
  );

  planningDocsWatcher = createPlanningDocsWatcher(resolvePlanningDocsDir);
  planningDocsWatcher.sync();

  // ---- Shells: plain terminals spawned inside a session's worktree ----
  ipcMain.handle('shell:open', async (_e, sessionId: string) => {
    const sessions = await daemonClient.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`No session for id: ${sessionId}`);
    }
    return daemonClient.createShell({
      sessionId: session.id,
      worktreePath: session.worktreePath,
      cols: 80,
      rows: 24,
    });
  });

  ipcMain.handle('shell:close', async (_e, shellId: string) => {
    await daemonClient.closeShell(shellId);
  });

  ipcMain.handle('shell:list', async (_e, sessionId: string) =>
    daemonClient.listShells(sessionId),
  );

  ipcMain.handle('shell:attach', async (_e, shellId: string) =>
    daemonClient.attachShell(shellId),
  );

  ipcMain.on('shell:write', (_e, shellId: string, data: string) => {
    daemonClient.writeShell(shellId, data);
  });

  ipcMain.on('shell:resize', (_e, shellId: string, cols: number, rows: number) => {
    daemonClient.resizeShell(shellId, cols, rows);
  });

  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  fluxMcpServer?.stop();
  planningDocsWatcher?.dispose();
  planningDocsWatcher = null;
  // Intentionally do NOT shut down the flux-daemon here; that's the whole
  // point of the daemon architecture. Quitting Flux must leave live PTYs
  // running so the next launch can warm-reattach. See 0001-session-daemon.md.
});

// In this file you can include the rest of your app's specific main process
// code. You can put them in the end of other files and import them here.
