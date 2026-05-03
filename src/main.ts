import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore } from './main/ProjectStore';
import { McpServer } from './main/McpServer';
import { McpRendererBridge } from './main/McpRendererBridge';
import { AppStateStore } from './main/AppStateStore';
import { LocalBindingStore } from './main/LocalBindingStore';
import { WorktreeService } from './main/WorktreeService';
import { DaemonClient } from './main/DaemonClient';
import {
  deleteSessionWorkspaceAndStop,
  teardownEphemeralResourcesForTask,
} from './main/taskEphemeralTeardown';
import {
  agentNotFoundMessage,
  agentSpawnResumeSpec,
  agentSpawnSpec,
  ensurePlanningDirCursorMcp,
  planningSpawnSpec,
  taskInitialPrompt,
} from './main/agentSpawn';
import { listCursorAgentModels } from './main/listCursorAgentModels';
import { openWorkspacePath, resolveTaskWorktreePath } from './main/openWorkspacePath';
import {
  ghPrViewCurrentBranchOpen,
  ghPrViewJson,
  prMetadataRefMismatchWarning,
} from './main/githubTaskPr';
import { resolveProjectRepoDefaultBranchShort } from './main/resolveProjectRepoDefaultBranch';
import {
  describeSessionInputForLog,
  isSessionInputDebugEnabled,
  wrapAsXtermBracketedPaste,
} from './main/sessionInputDebug';
import { githubPrRefreshViewEqual } from './githubPrMetadata';
import { shouldAutoMarkDoneAfterPrMergeRefresh } from './autoMarkDoneWhenPrMerged';
import { shouldAutoMoveTaskToReviewForOpenPr } from './githubPrReviewWhenOpenAutomation';
import { keyForInsert, sortColumn } from './renderer/tasks/orderKey';
import { AuthServer } from './main/AuthServer';
import { EmailService, type InviteEmailInput } from './main/EmailService';
import { createPlanningDocsWatcher } from './main/PlanningDocsWatcher';
import type {
  ActiveProjectKey,
  Agent,
  AgentSpawnDefaultsPatch,
  ProjectTabState,
  LocalProject,
  Project,
  RepoBranchDiscoveryResponse,
  RepoConfig,
  SessionStartOptions,
  SessionStartResult,
  Task,
  TaskGithubPr,
  TaskPullRequestIpcResult,
  TaskRequestPullRequestFromAgentResult,
} from './types';
import {
  classifyGitBranchPresence,
  effectiveTaskSourceBranchShort,
  nextPersistedSourceBranchShortAfterPatch,
  planTaskSourceBranchFieldsForCreate,
  resolveCreateSourceBranchIfMissingForStart,
  validateStoredTaskSourceBranchName,
} from './taskBranches';
import { collectRepoBranchDiscovery } from './main/repoGit';
import { isWorktreeCreateError } from './main/worktreeCreateError';
import {
  taskHasBlockingWorkspaceState,
  taskSourceBranchSettingsWouldChange,
} from './main/taskSourceBranchGuard';
import { fluxTaskWorkBranchName } from './main/fluxTaskBranch';
import {
  buildCreatePrInstructionsMarkdown,
  buildTaskAgentPullRequestPrompt,
  resolveAgentPullRequestBranchContext,
} from './taskAgentPullRequestPrompt';
import {
  mergedTaskCreateAgentFields,
  resolvedPlanningModelForSpawn,
  resolvedPlanningYoloForSpawn,
} from './projectAgentDefaults';
import {
  getTaskBlockedStartInfo,
  isTaskBlocked,
  validateBlockedByTaskIds,
} from './taskDependencies';
import { applyUnblockAutostartForCompletedBlocker } from './unblockAutostartApply';
import type { UnblockAutostartPolicy } from './unblockAutostart';
import type { AgentState, AttachResult, PlanningAttachResult } from './daemon/protocol';

function isPlanningAgent(value: unknown): value is Agent {
  return value === 'claude-code' || value === 'codex' || value === 'cursor';
}

function parsePlanningStartPayload(payload: unknown): {
  agent: Agent;
  agentModel?: string;
  agentYolo?: boolean;
} | null {
  if (isPlanningAgent(payload)) {
    return { agent: payload };
  }
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as { agent?: unknown; agentModel?: unknown; agentYolo?: unknown };
  if (!isPlanningAgent(o.agent)) return null;
  const agentModel =
    typeof o.agentModel === 'string' ? o.agentModel : undefined;
  const agentYolo = typeof o.agentYolo === 'boolean' ? o.agentYolo : undefined;
  return { agent: o.agent, agentModel, agentYolo };
}

function parseAgentSpawnDefaultsPatch(payload: unknown): AgentSpawnDefaultsPatch | null {
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const patch: AgentSpawnDefaultsPatch = {};
  if (o.planningModels && typeof o.planningModels === 'object') {
    const pm = o.planningModels as Record<string, unknown>;
    const next: AgentSpawnDefaultsPatch['planningModels'] = {};
    if (typeof pm['claude-code'] === 'string') {
      next['claude-code'] = pm['claude-code'];
    }
    if (typeof pm.cursor === 'string') {
      next.cursor = pm.cursor;
    }
    if (Object.keys(next).length > 0) {
      patch.planningModels = next;
    }
  }
  if (o.taskDefaultModels && typeof o.taskDefaultModels === 'object') {
    const tm = o.taskDefaultModels as Record<string, unknown>;
    const next: AgentSpawnDefaultsPatch['taskDefaultModels'] = {};
    if (typeof tm['claude-code'] === 'string') {
      next['claude-code'] = tm['claude-code'];
    }
    if (typeof tm.cursor === 'string') {
      next.cursor = tm.cursor;
    }
    if (Object.keys(next).length > 0) {
      patch.taskDefaultModels = next;
    }
  }
  if (typeof o.planningAgentYolo === 'boolean') {
    patch.planningAgentYolo = o.planningAgentYolo;
  }
  if (typeof o.defaultTaskAgentYolo === 'boolean') {
    patch.defaultTaskAgentYolo = o.defaultTaskAgentYolo;
  }
  return Object.keys(patch).length > 0 ? patch : null;
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
let fluxMcpRendererBridge: McpRendererBridge | null = null;

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

  // Map session ID → task ID for silence-based status transitions.
  // Seeded eagerly here; also re-seeded from getSessionSilenceStates() during
  // startup catchup so a listSessions() failure does not silently break catchup.
  const sessionTaskMap = new Map<string, string>();
  try {
    const existing = await daemonClient.listSessions();
    for (const s of existing) {
      if (s.taskId) sessionTaskMap.set(s.id, s.taskId);
    }
  } catch (err) {
    console.warn('[main] listSessions failed — will re-seed from getSessionSilenceStates()', err);
  }

  async function applyAgentState(sessionId: string, state: AgentState): Promise<void> {
    // Only handle the silent transition. needs-input → in-progress is
    // triggered exclusively by session:write (user submitting a query).
    if (state !== 'silent') return;

    const taskId = sessionTaskMap.get(sessionId);
    if (!taskId) return;

    const project = projectStore.get();
    // Cloud project (no local projectStore) — the renderer owns the Firestore write.
    if (!project) return;

    const task = taskStore.getAll(project.id).find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === 'in-progress') {
      console.log('[task:status] in-progress → needs-input (silence detected, local)', { taskId });
      await taskStore.update(taskId, { status: 'needs-input' });
      broadcastLocalTasksChanged();
    }
  }

  daemonClient.onAgentState = applyAgentState;

  async function reconcileSilenceStatesFromDaemon(
    states: { id: string; taskId?: string; state: AgentState }[],
    meta?: unknown,
  ): Promise<void> {
    void meta;
    for (const { id, taskId, state } of states) {
      if (taskId && !sessionTaskMap.has(id)) sessionTaskMap.set(id, taskId);
      await applyAgentState(id, state);
    }
  }

  daemonClient.onSilenceStatesSnapshot = reconcileSilenceStatesFromDaemon;
  daemonClient.startSilencePolling();

  // Session-exit → needs-input transition for local projects.
  // When an agent exits cleanly (code 0 → status 'stopped'), move the task
  // to needs-input so the user knows it finished or is waiting for review.
  daemonClient.onSessionExit = (session) => {
    const taskId = sessionTaskMap.get(session.id);
    if (!taskId) return;

    const project = projectStore.get();
    // Cloud projects handled in renderer.
    if (!project) return;

    if (session.status === 'stopped') {
      const task = taskStore.getAll(project.id).find((t) => t.id === taskId);
      if (task && task.status === 'in-progress') {
        console.log('[task:status] in-progress → needs-input (agent exited cleanly, local)', { taskId });
        void taskStore.update(taskId, { status: 'needs-input' }).then(() => {
          broadcastLocalTasksChanged();
        });
      }
    } else if (session.status === 'error') {
      console.warn('[task:status] agent exited with error, not transitioning task', {
        taskId,
        sessionId: session.id,
      });
    }
  };

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

  // Catchup: for sessions already silent (or already exited) when this process
  // connects to the daemon, no stream event will fire. Also re-run after
  // stream reconnect so a brief disconnect doesn't permanently miss events.
  async function runSilenceCatchup(): Promise<void> {
    try {
      const silenceStates = await daemonClient.getSessionSilenceStates();
      for (const { id, taskId, state } of silenceStates) {
        // Re-seed the map in case listSessions() failed earlier.
        if (taskId && !sessionTaskMap.has(id)) sessionTaskMap.set(id, taskId);
        await applyAgentState(id, state);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNKNOWN_METHOD')) {
        console.warn(
          '[main] daemon does not support getSessionSilenceStates — running sessions may not ' +
          'auto-transition to needs-input; restart Flux to upgrade the daemon',
        );
      } else {
        console.warn('[main] catchup getSessionSilenceStates failed', err);
      }
    }
  }

  await runSilenceCatchup();

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
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, { planningAgent: agent });
          return { ok: true };
        }
        await projectStore.setPlanningAgent(agent);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:setDefaultTaskAgent',
    async (_e, agent: unknown): Promise<{ ok: true } | { error: string }> => {
      if (!isPlanningAgent(agent)) {
        return { error: 'INVALID_AGENT' };
      }
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, { defaultTaskAgent: agent });
          return { ok: true };
        }
        await projectStore.setDefaultTaskAgent(agent);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:patchAgentSpawnDefaults',
    async (
      _e,
      raw: unknown,
    ): Promise<{ ok: true } | { error: string }> => {
      const patch = parseAgentSpawnDefaultsPatch(raw);
      if (!patch) {
        return { error: 'INVALID_PAYLOAD' };
      }
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            ...(patch.planningModels !== undefined ? { planningModels: patch.planningModels } : {}),
            ...(patch.planningAgentYolo !== undefined
              ? { planningAgentYolo: patch.planningAgentYolo }
              : {}),
            ...(patch.taskDefaultModels !== undefined
              ? { taskDefaultModels: patch.taskDefaultModels }
              : {}),
            ...(patch.defaultTaskAgentYolo !== undefined
              ? { defaultTaskAgentYolo: patch.defaultTaskAgentYolo }
              : {}),
          });
          return { ok: true };
        }
        await projectStore.patchAgentSpawnDefaults(patch);
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

  async function readAutoMoveToReviewWhenPrOpen(): Promise<boolean> {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoMoveToReviewWhenPrOpen;
    }
    try {
      return await projectStore.getAutoMoveToReviewWhenPrOpenAt(activeProjectDir());
    } catch {
      return false;
    }
  }

  ipcMain.handle('project:getRepos', async (): Promise<RepoConfig[]> => {
    return projectStore.getReposAt(activeProjectDir());
  });

  ipcMain.handle(
    'repo:getBranchDiscovery',
    async (
      _e,
      requestedBranch?: string,
    ): Promise<RepoBranchDiscoveryResponse | { error: string }> => {
      try {
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        const repo = repos[0];
        if (!repo?.rootPath) {
          return { error: 'No repository root configured for this project' };
        }
        const base = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
        if (requestedBranch == null || requestedBranch.trim() === '') {
          return base;
        }
        const { normalizedShort, presence } = classifyGitBranchPresence(
          requestedBranch,
          base.localBranches,
          base.remoteBranches,
        );
        return {
          ...base,
          classification: {
            raw: requestedBranch,
            normalizedShort,
            presence,
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
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
  ipcMain.handle('project:getAutoStartSessionOnInProgress', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoStartSessionOnInProgress;
    }
    return projectStore.getAutoStartSessionOnInProgressAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoStartSessionOnInProgress',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoStartSessionOnInProgress: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoStartSessionOnInProgress,
          };
        }
        const next = await projectStore.setAutoStartSessionOnInProgressAt(
          activeProjectDir(),
          enabled,
        );
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getAutoStartWhenUnblocked', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoStartWhenUnblocked;
    }
    return projectStore.getAutoStartWhenUnblockedAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoStartWhenUnblocked',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoStartWhenUnblocked: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoStartWhenUnblocked,
          };
        }
        const next = await projectStore.setAutoStartWhenUnblockedAt(activeProjectDir(), enabled);
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getAutoCleanupWorkspaceWhenDone', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoCleanupWorkspaceWhenDone;
    }
    return projectStore.getAutoCleanupWorkspaceWhenDoneAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoCleanupWorkspaceWhenDone',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoCleanupWorkspaceWhenDone: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoCleanupWorkspaceWhenDone,
          };
        }
        const next = await projectStore.setAutoCleanupWorkspaceWhenDoneAt(
          activeProjectDir(),
          enabled,
        );
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getAutoMarkDoneWhenPrMerged', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoMarkDoneWhenPrMerged;
    }
    return projectStore.getAutoMarkDoneWhenPrMergedAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoMarkDoneWhenPrMerged',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoMarkDoneWhenPrMerged: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoMarkDoneWhenPrMerged,
          };
        }
        const next = await projectStore.setAutoMarkDoneWhenPrMergedAt(activeProjectDir(), enabled);
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getAutoMoveToReviewWhenPrOpen', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoMoveToReviewWhenPrOpen;
    }
    return projectStore.getAutoMoveToReviewWhenPrOpenAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoMoveToReviewWhenPrOpen',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoMoveToReviewWhenPrOpen: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoMoveToReviewWhenPrOpen,
          };
        }
        const next = await projectStore.setAutoMoveToReviewWhenPrOpenAt(
          activeProjectDir(),
          enabled,
        );
        return { ok: true, enabled: next };
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
    async (_e, key: ActiveProjectKey, tabs: ProjectTabState) => {
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

  ipcMain.handle('workspace:openPath', async (_e, rawPath: unknown, rawTarget: unknown) =>
    openWorkspacePath(rawPath, rawTarget),
  );
  ipcMain.handle('workspace:resolveTaskWorktree', async (_e, taskId: unknown) => {
    if (typeof taskId !== 'string' || !taskId.trim()) return null;
    return resolveTaskWorktreePath(
      taskId.trim(),
      () => daemonClient.listSessions(),
      worktreeService.getProjectDir(),
    );
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

  ipcMain.handle(
    'tasks:create',
    async (
      _e,
      input: {
        title: string;
        agent: Agent;
        blockedByTaskIds?: string[];
        labels?: string[];
        sourceBranch?: string;
        createSourceBranchIfMissing?: boolean;
        agentModel?: string;
        agentYolo?: boolean;
      },
    ) => {
      const project = projectStore.get();
      if (!project) {
        throw new Error('No local project open');
      }
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const repo = repos.find((r) => r.rootPath === project.rootPath) ?? repos[0];
      if (!repo?.rootPath) {
        throw new Error('No repository root configured for this project');
      }
      const discovery = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
      const planned = planTaskSourceBranchFieldsForCreate(discovery, {
        sourceBranch: input.sourceBranch,
        createSourceBranchIfMissing: input.createSourceBranchIfMissing,
      });
      const branchOk = validateStoredTaskSourceBranchName(planned.sourceBranch);
      if (!branchOk.ok) {
        throw new Error(branchOk.message);
      }
      const extra = mergedTaskCreateAgentFields(
        project,
        input.agent,
        input.agentModel,
        input.agentYolo,
      );
      return taskStore.create({
        ...input,
        ...extra,
        projectId: project.id,
        sourceBranch: planned.sourceBranch,
        createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
      });
    },
  );
  ipcMain.handle(
    'tasks:assertSourceBranchEditable',
    async (
      _e,
      taskId: unknown,
      previousFields: unknown,
      patchFields: unknown,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return { ok: false, message: 'Invalid task id' };
      }
      const tid = taskId.trim();
      const prev =
        previousFields && typeof previousFields === 'object'
          ? (previousFields as Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'> & {
              githubPr?: TaskGithubPr;
            })
          : {};
      const patch =
        patchFields && typeof patchFields === 'object'
          ? (patchFields as Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing'>)
          : {};
      try {
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        const project = projectStore.get();
        const rootPathForRepo =
          project?.rootPath ?? repos.find((r) => r.rootPath)?.rootPath ?? repos[0]?.rootPath;
        if (!rootPathForRepo) {
          return { ok: false, message: 'No repository root configured for this project' };
        }
        const repo = repos.find((r) => r.rootPath === rootPathForRepo) ?? repos[0];
        const discovery = await collectRepoBranchDiscovery(
          rootPathForRepo,
          repo?.baseBranch ?? 'main',
        );
        const previousTask = {
          id: tid,
          title: '',
          status: 'backlog' as const,
          agent: 'claude-code' as const,
          createdAt: '',
          projectId: project?.id ?? 'cloud',
          ...prev,
        } as Task;
        if (!taskSourceBranchSettingsWouldChange(previousTask, patch, discovery.defaultBranchShort)) {
          return { ok: true };
        }
        const localRow =
          project && project.kind === 'local'
            ? taskStore.getAll(project.id).find((t) => t.id === tid)
            : undefined;
        const linkedPrUrl = (localRow?.githubPr?.url ?? prev.githubPr?.url)?.trim();
        if (linkedPrUrl) {
          return {
            ok: false,
            message:
              'Cannot change this task\'s source branch while a GitHub pull request is linked. Clear the pull request metadata on the task first, then you can change the base branch.',
          };
        }
        const locked = await taskHasBlockingWorkspaceState({
          taskId: tid,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir(),
          rootPath: worktreeService.getRootPath(),
        });
        if (locked) {
          const fluxBranch = fluxTaskWorkBranchName(tid);
          return {
            ok: false,
            message: `Cannot change this task's source branch while a Flux workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
          };
        }
        const candidate = nextPersistedSourceBranchShortAfterPatch(previousTask, patch);
        if (candidate !== undefined) {
          const v = validateStoredTaskSourceBranchName(candidate);
          if (!v.ok) {
            return { ok: false, message: v.message };
          }
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, message };
      }
    },
  );
  ipcMain.handle('tasks:update', async (_e, id, patch) =>
    updateTaskWithTransitionHandling(id, patch, 'ipc:tasks:update'),
  );
  ipcMain.handle(
    'tasks:cleanupResources',
    async (_e, taskId: string): Promise<{ errors: string[] }> => {
      const errors = await teardownEphemeralResourcesForTask(
        daemonClient,
        worktreeService,
        taskId,
      );
      return { errors };
    },
  );

  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  ipcMain.handle('tasks:resolveWorktrees', async (_e, raw: unknown): Promise<Record<string, boolean>> => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) return {};
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
      : [];
    const capped = ids.slice(0, 400);
    const out: Record<string, boolean> = {};
    for (const taskId of capped) {
      const p = await resolveTaskWorktreePath(taskId, () => daemonClient.listSessions(), projectDir);
      out[taskId] = Boolean(p);
    }
    return out;
  });

  /**
   * Writes PTY input and mirrors `session:write` side effects (task status / cloud notify).
   * Submission detection matches the renderer: only CR/LF breaks silence / needs-input.
   */
  function sendTaskSessionTerminalInput(sessionId: string, data: string): void {
    if (isSessionInputDebugEnabled()) {
      const taskId = sessionTaskMap.get(sessionId) ?? null;
      console.log('[session:input]', {
        sessionId,
        taskId,
        codeUnits: data.length,
        repr: describeSessionInputForLog(data),
      });
    }

    daemonClient.writeSession(sessionId, data);

    const taskId = sessionTaskMap.get(sessionId);
    if (!taskId) return;

    const submitted = data.includes('\r') || data.includes('\n');
    if (!submitted) return;

    const project = projectStore.get();
    if (project) {
      const task = taskStore.getAll(project.id).find((t) => t.id === taskId);
      if (task?.status === 'needs-input' || task?.status === 'review') {
        console.log('[task:status] needs-input/review → in-progress (user submitted query, local)', {
          taskId,
          from: task.status,
        });
        void taskStore.update(taskId, { status: 'in-progress' }).then(() => {
          broadcastLocalTasksChanged();
        });
      }
      return;
    }

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('task:userInput', { sessionId, taskId });
    }
  }

  ipcMain.handle(
    'tasks:requestPullRequestFromAgent',
    async (_e, raw: unknown): Promise<TaskRequestPullRequestFromAgentResult> => {
      if (!raw || typeof raw !== 'object') {
        return { ok: false, code: 'NO_PROJECT', message: 'Invalid payload' };
      }
      const o = raw as { taskId?: unknown; title?: unknown; description?: unknown };
      const taskId = typeof o.taskId === 'string' ? o.taskId.trim() : '';
      if (!taskId) {
        return { ok: false, code: 'NO_PROJECT', message: 'taskId is required' };
      }
      const rootPath = worktreeService.getRootPath();
      if (!rootPath) {
        return { ok: false, code: 'NO_PROJECT', message: 'No git project open' };
      }
      const project = projectStore.get();
      let title = typeof o.title === 'string' ? o.title.trim() : '';
      let description = typeof o.description === 'string' ? o.description : '';
      if (project) {
        const row = taskStore.getAll(project.id).find((t) => t.id === taskId);
        if (row) {
          if (!title) title = row.title.trim();
          if (o.description === undefined && row.description) {
            description = row.description;
          }
        }
      }
      if (!title) {
        return {
          ok: false,
          code: 'TASK_METADATA_REQUIRED',
          message: 'Task title is required (open a local task or pass title in the payload)',
        };
      }

      const sessions = await daemonClient.listSessions();
      const session = sessions.find((s) => s.taskId === taskId);
      if (!session) {
        return {
          ok: false,
          code: 'NO_AGENT_SESSION',
          message:
            "Start this task's agent session first so it can commit and open the PR.",
        };
      }
      if (session.status !== 'running') {
        return {
          ok: false,
          code: 'AGENT_SESSION_NOT_RUNNING',
          message:
            "This task's agent session is not running. Start or resume the session, then try opening the PR again.",
        };
      }

      const wt = session.worktreePath?.trim() ?? '';
      if (!wt) {
        return {
          ok: false,
          code: 'NO_WORKTREE',
          message:
            "Start this task's agent session first so it can commit and open the PR.",
        };
      }
      try {
        const st = await fs.stat(wt);
        if (!st.isDirectory()) {
          return {
            ok: false,
            code: 'NO_WORKTREE',
            message:
              "The task worktree folder is missing. Start this task's agent session again.",
          };
        }
      } catch {
        return {
          ok: false,
          code: 'NO_WORKTREE',
          message:
            "The task worktree folder is missing. Start this task's agent session again.",
        };
      }

      const headBranchRaw = session.branch?.trim() ?? '';
      if (!headBranchRaw) {
        return {
          ok: false,
          code: 'PR_CREATE_FAILED',
          message: 'Could not determine the task work branch for this session.',
        };
      }

      const repoDefaultBranch = await resolveProjectRepoDefaultBranchShort({
        projectStore,
        activeProjectDir,
        rootPath,
      });
      const taskRow = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      const { baseBranch, headBranch } = resolveAgentPullRequestBranchContext({
        task: taskRow ?? {},
        projectDefaultBranchShort: repoDefaultBranch,
        sessionBranch: headBranchRaw,
      });
      if (!baseBranch.trim()) {
        return {
          ok: false,
          code: 'PR_CREATE_FAILED',
          message: 'Pull request base branch resolved to an empty name.',
        };
      }

      const prBody = description.trim() || `_Task_: ${title}`;
      let instructionsPath: string;
      try {
        const instructionsDir = path.join(activeProjectDir(), 'agent-instructions');
        instructionsPath = path.join(instructionsDir, 'create-pr.md');
        await fs.mkdir(instructionsDir, { recursive: true });
        await fs.writeFile(instructionsPath, buildCreatePrInstructionsMarkdown(), 'utf8');
      } catch (err) {
        console.warn('[tasks:requestPullRequestFromAgent] failed to write PR instructions file', err);
        return {
          ok: false,
          code: 'PR_CREATE_FAILED',
          message:
            'Could not write PR instructions for the agent. Ensure a Flux project directory is available.',
        };
      }
      const payload = buildTaskAgentPullRequestPrompt({
        taskId,
        taskTitle: title,
        headBranch,
        baseBranch,
        prTitle: title,
        prBody,
        instructionsAbsolutePath: instructionsPath,
      });
      const pasteInput = wrapAsXtermBracketedPaste(payload);
      const submitInput = '\r';
      const combinedInput = `${pasteInput}${submitInput}`;
      const useCursorSplitPasteSubmit = taskRow?.agent === 'cursor';
      // Multiline paste uses bracketed paste markers; `\n` inside the body must not hit
      // `sendTaskSessionTerminalInput` alone (it treats `\n` as submit). Cursor: one
      // chunk `\x1b[201~\r` left the prompt in the input without submitting — paste then
      // await RPC, then `\r` only (Claude: single combined write still works).
      if (useCursorSplitPasteSubmit) {
        await daemonClient.writeSessionAwait(session.id, pasteInput);
        sendTaskSessionTerminalInput(session.id, submitInput);
      } else {
        sendTaskSessionTerminalInput(session.id, combinedInput);
      }
      return { ok: true, sessionId: session.id };
    },
  );

  ipcMain.handle(
    'tasks:refreshPullRequest',
    async (_e, raw: unknown): Promise<TaskPullRequestIpcResult> => {
      if (!raw || typeof raw !== 'object') {
        return { ok: false, code: 'NO_PROJECT', message: 'Invalid payload' };
      }
      const o = raw as { taskId?: unknown; githubPr?: unknown };
      const taskId = typeof o.taskId === 'string' ? o.taskId.trim() : '';
      if (!taskId) {
        return { ok: false, code: 'NO_PROJECT', message: 'taskId is required' };
      }
      const rootPath = worktreeService.getRootPath();
      const projectDir = worktreeService.getProjectDir();
      if (!rootPath || !projectDir) {
        return { ok: false, code: 'NO_PROJECT', message: 'No git project open' };
      }
      const worktreePath = await resolveTaskWorktreePath(
        taskId,
        () => daemonClient.listSessions(),
        projectDir,
      );
      const ghCwd = worktreePath || rootPath || projectDir;
      const project = projectStore.get();
      let prUrl = '';
      const fromPayload =
        o.githubPr && typeof o.githubPr === 'object' && typeof (o.githubPr as TaskGithubPr).url === 'string'
          ? String((o.githubPr as TaskGithubPr).url).trim()
          : '';
      if (fromPayload) prUrl = fromPayload;
      const row = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      if (!prUrl && project) {
        prUrl = row?.githubPr?.url?.trim() ?? '';
      }
      const viewed = prUrl
        ? await ghPrViewJson(ghCwd, prUrl)
        : worktreePath
          ? await ghPrViewCurrentBranchOpen(worktreePath)
          : ({
              ok: false,
              code: 'NO_WORKTREE',
              message: 'No task worktree found to discover a pull request',
            } as const);
      if (!viewed.ok) {
        if (viewed.code === 'NO_OPEN_PR' || viewed.code === 'NO_WORKTREE') {
          return viewed;
        }
        console.warn('[tasks:refreshPullRequest] gh view failed', taskId, viewed.message);
        return viewed;
      }

      const metadataMismatchWarning = row?.githubPr
        ? prMetadataRefMismatchWarning(row.githubPr, viewed.githubPr)
        : undefined;

      let persisted = false;
      if (project && row) {
        const prChanged = !githubPrRefreshViewEqual(row.githubPr, viewed.githubPr);
        if (prChanged) {
          await taskStore.update(taskId, { githubPr: viewed.githubPr });
          persisted = true;
          broadcastLocalTasksChanged();
        }

        let autoMarkPref = false;
        try {
          autoMarkPref = await projectStore.getAutoMarkDoneWhenPrMergedAt(activeProjectDir());
        } catch (err) {
          console.warn('[tasks:refreshPullRequest] failed to read autoMarkDoneWhenPrMerged', err);
        }
        const allTasks = taskStore.getAll(project.id);
        const rowForAuto = allTasks.find((t) => t.id === taskId) ?? row;

        if (
          shouldAutoMarkDoneAfterPrMergeRefresh({
            task: rowForAuto,
            refreshedGithubPr: viewed.githubPr,
            prefEnabled: autoMarkPref,
            allTasks,
          })
        ) {
          const destCol = sortColumn(
            allTasks.filter((t) => t.id !== taskId),
            'done',
          );
          let nextOrderKey: string;
          try {
            nextOrderKey = keyForInsert(destCol, destCol.length);
          } catch (err) {
            console.error('[tasks:refreshPullRequest] keyForInsert failed; using fallback', err);
            nextOrderKey = String(Date.now());
          }
          try {
            await updateTaskWithTransitionHandling(
              taskId,
              { status: 'done', orderKey: nextOrderKey },
              'pr:mergedRefresh',
            );
            broadcastLocalTasksChanged();
          } catch (err) {
            console.warn('[tasks:refreshPullRequest] auto-mark done failed', taskId, err);
          }
        } else {
          const autoReview = await readAutoMoveToReviewWhenPrOpen();
          if (
            shouldAutoMoveTaskToReviewForOpenPr({
              enabled: autoReview,
              taskStatus: rowForAuto.status,
              githubPr: viewed.githubPr,
              taskId,
            })
          ) {
            try {
              await updateTaskWithTransitionHandling(
                taskId,
                { status: 'review' },
                'github-pr:refresh-open',
              );
              broadcastLocalTasksChanged();
            } catch (err: unknown) {
              console.warn('[github-pr:auto-review] move after refresh failed', taskId, err);
            }
          }
        }
      }
      return {
        ok: true,
        githubPr: viewed.githubPr,
        persisted,
        ...(metadataMismatchWarning ? { metadataMismatchWarning } : {}),
      };
    },
  );

  ipcMain.handle('cursor:listAgentModels', async () => listCursorAgentModels());

  function broadcastLocalTasksChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('tasks:changed');
    }
  }

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
    const prefs = bindingStore.getPrefs(activeKey.id);
    return {
      id: activeKey.id,
      kind: 'cloud',
      name: path.basename(binding.rootPath),
      rootPath: binding.rootPath,
      ownerId: '',
      memberIds: [],
      createdAt: '',
      ...prefs,
    };
  }

  async function worktreeSourceOptsForTaskSession(
    task: Task,
    project: Project,
  ): Promise<{ sourceBranchShort: string; createSourceBranchIfMissing: boolean }> {
    const projectDir = activeProjectDir();
    const repos = await projectStore.getReposAt(projectDir);
    const repo = repos.find((r) => r.rootPath === project.rootPath) ?? repos[0];
    const discovery = await collectRepoBranchDiscovery(
      project.rootPath,
      repo?.baseBranch ?? 'main',
    );
    const sourceEff =
      effectiveTaskSourceBranchShort(task, discovery.defaultBranchShort) ||
      discovery.defaultBranchShort ||
      'main';
    const { presence } = classifyGitBranchPresence(
      sourceEff,
      discovery.localBranches,
      discovery.remoteBranches,
    );
    return {
      sourceBranchShort: sourceEff,
      createSourceBranchIfMissing: resolveCreateSourceBranchIfMissingForStart(
        task,
        presence,
      ),
    };
  }

  /** Remove stopped/error daemon rows for this task so `session:get` and tabs stay unambiguous. */
  async function archiveNonRunningSessionsForTask(taskId: string): Promise<void> {
    const sessions = await daemonClient.listSessions();
    const stale = sessions.filter(
      (s) => s.taskId === taskId && s.status !== 'running',
    );
    for (const s of stale) {
      sessionTaskMap.delete(s.id);
      await daemonClient.closeShellsForSession(s.id);
      await daemonClient.stopSession(s.id);
    }
  }

  async function startSessionForTask(
    task: Task,
    projectTasks?: Task[],
    requesterUid?: string | null,
    options?: SessionStartOptions,
  ): Promise<SessionStartResult> {
    const project = await resolveProjectForStart();

    const fromStore = taskStore.getAll(project.id);
    const passedOk =
      Array.isArray(projectTasks) &&
      projectTasks.length > 0 &&
      projectTasks.every((t) => t.projectId === project.id) &&
      projectTasks.some((t) => t.id === task.id);
    let allProjectTasks = passedOk ? projectTasks : fromStore;
    if (
      allProjectTasks.length === 0 &&
      (task.blockedByTaskIds?.length ?? 0) > 0
    ) {
      return {
        error: 'TASK_BLOCKED',
        message:
          'This task has dependencies but the task list is unavailable. Return to the board and try again.',
        blockerIds: task.blockedByTaskIds ?? [],
        blockers: [],
      };
    }
    let merged = allProjectTasks.find((t) => t.id === task.id) ?? task;
    if (isTaskBlocked(merged, allProjectTasks)) {
      const info = getTaskBlockedStartInfo(merged, allProjectTasks);
      const titles = info.blockers.map((b) => b.title).join(', ');
      return {
        error: 'TASK_BLOCKED',
        message: titles
          ? `Complete blocking task(s) first: ${titles}`
          : 'Complete blocking task(s) before starting a session.',
        blockerIds: info.blockerIds,
        blockers: info.blockers,
      };
    }

    if (
      project.kind === 'cloud' &&
      requesterUid &&
      typeof requesterUid === 'string' &&
      requesterUid.trim() !== ''
    ) {
      const assignee = merged.assigneeId?.trim();
      if (assignee && assignee !== requesterUid.trim()) {
        return {
          error: 'NOT_TASK_ASSIGNEE',
          message: 'Only the task assignee can start a session for this task.',
        };
      }
    }

    // Local tasks.json: a started session should match the "In progress" column.
    if (
      project.kind === 'local' &&
      fromStore.some((t) => t.id === task.id)
    ) {
      const row = fromStore.find((t) => t.id === task.id) ?? merged;
      if (row.status !== 'done' && row.status !== 'in-progress') {
        await taskStore.update(task.id, { status: 'in-progress' });
        const all = taskStore.getAll(project.id);
        allProjectTasks = all;
        const nextMerged = all.find((t) => t.id === task.id);
        if (nextMerged) {
          merged = nextMerged;
        }
        broadcastLocalTasksChanged();
      }
    }

    // Dedup against the daemon's live registry.
    const existing = (await daemonClient.listSessions()).find(
      (s) => s.taskId === task.id && s.status === 'running',
    );
    if (existing) {
      // Ensure the mapping exists even if this session was created after startup seeding.
      if (!sessionTaskMap.has(existing.id)) sessionTaskMap.set(existing.id, task.id);
      return existing;
    }

    const taskId = task.id;
    const sendTaskStartProgress = (payload: {
      taskId: string;
      phase: 'starting' | 'settled';
      outcome?: SessionStartResult;
    }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        win.webContents.send('session:taskStartProgress', payload);
      }
    };

    sendTaskStartProgress({ taskId, phase: 'starting' });
    let startOutcome: SessionStartResult | undefined;
    const finish = (r: SessionStartResult): SessionStartResult => {
      startOutcome = r;
      return r;
    };
    try {
      let worktreePath = '';
      let branch = '';
      try {
        const sourceOpts = await worktreeSourceOptsForTaskSession(merged, project);
        const created = await worktreeService.create(task.id, sourceOpts);
        worktreePath = created.worktreePath;
        branch = created.branch;
      } catch (err: unknown) {
        if (isWorktreeCreateError(err)) {
          console.error('[session:start] worktree create failed', {
            taskId: task.id,
            projectId: project.id,
            code: err.code,
            branchName: err.branchName,
            message: err.message,
          });
          return finish({ error: err.code, message: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error('[session:start] worktree create failed', {
          taskId: task.id,
          projectId: project.id,
          message,
        });
        return finish({ error: 'WORKTREE_FAILED', message });
      }

      await archiveNonRunningSessionsForTask(task.id);

      const { command, args } = options?.resume
        ? agentSpawnResumeSpec(merged)
        : agentSpawnSpec(merged, taskInitialPrompt(merged));
      console.log('[session:start] spawn', {
        taskId: task.id,
        command,
        args,
        resume: Boolean(options?.resume),
      });
      const result = await daemonClient.createSession({
        worktreePath,
        branch,
        taskId: task.id,
        projectId: project.id,
        agent: merged.agent,
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
          return finish({
            error: 'AGENT_NOT_FOUND',
            message: agentNotFoundMessage(task.agent, command),
          });
        }
        return finish({ error: 'AGENT_NOT_FOUND', message: result.message });
      }
      sessionTaskMap.set(result.id, task.id);
      return finish(result);
    } finally {
      const outcome: SessionStartResult = startOutcome ?? {
        error: 'INTERNAL',
        message: 'Session start did not return a result',
      };
      sendTaskStartProgress({ taskId, phase: 'settled', outcome });
    }
  }

  type TaskUpdatePatch = Partial<
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
      | 'sourceBranch'
      | 'createSourceBranchIfMissing'
    >
  > & { githubPr?: TaskGithubPr | null };

  const unblockAutostartInFlight = new Set<string>();

  async function maybeAutoStartSessionOnInProgressTransition(
    previous: Task,
    updated: Task,
    source: string,
    options?: { skipInProgressAutostart?: boolean },
  ): Promise<void> {
    if (options?.skipInProgressAutostart) return;
    const becameInProgress =
      previous.status !== 'in-progress' && updated.status === 'in-progress';
    if (!becameInProgress) return;

    let enabled = false;
    try {
      enabled = await projectStore.getAutoStartSessionOnInProgressAt(activeProjectDir());
    } catch (err) {
      console.error('[task:auto-start] failed to read setting', {
        source,
        taskId: updated.id,
        err,
      });
      return;
    }
    if (!enabled) return;

    const project = projectStore.get();
    if (!project) return;
    const columnTasks = taskStore.getAll(project.id);
    if (isTaskBlocked(updated, columnTasks)) {
      console.warn('[task:auto-start] skipped — task has incomplete blockers', {
        source,
        taskId: updated.id,
      });
      return;
    }

    try {
      const started = await startSessionForTask(updated, columnTasks);
      if ('error' in started) {
        console.error('[task:auto-start] session start failed', {
          source,
          taskId: updated.id,
          error: started.error,
          message: started.message,
        });
      }
    } catch (err) {
      console.error('[task:auto-start] unexpected failure', {
        source,
        taskId: updated.id,
        err,
      });
    }
  }

  async function processDependentsUnblockedAfterBlockerDone(
    previous: Task,
    completed: Task,
    source: string,
  ): Promise<void> {
    if (completed.status !== 'done' || previous.status === 'done') {
      return;
    }
    const project = projectStore.get();
    if (!project) {
      return;
    }
    const allAfter = taskStore.getAll(project.id);
    const allBefore = allAfter.map((t) => (t.id === completed.id ? previous : t));
    let inProg = false;
    let whenUnb = false;
    try {
      const projectDir = activeProjectDir();
      inProg = await projectStore.getAutoStartSessionOnInProgressAt(projectDir);
      whenUnb = await projectStore.getAutoStartWhenUnblockedAt(projectDir);
    } catch (err) {
      console.error('[task:unblock-autostart] failed to read settings', { source, err });
      return;
    }
    const policy: UnblockAutostartPolicy = {
      autoStartSessionOnInProgress: inProg,
      autoStartWhenUnblocked: whenUnb,
    };
    await applyUnblockAutostartForCompletedBlocker(previous, completed, allBefore, allAfter, policy, {
      inFlight: unblockAutostartInFlight,
      source: `unblock:${source}`,
      logError: (msg, data) => console.error(msg, data),
      getCurrentList: () => {
        const p = projectStore.get();
        return p ? taskStore.getAll(p.id) : [];
      },
      startSession: (task, all) => startSessionForTask(task, all),
      moveBacklogToInProgress: async (id) => {
        await updateTaskWithTransitionHandling(
          id,
          { status: 'in-progress' },
          `unblock-backlog:${source}`,
        );
      },
      moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: async (id) => {
        await updateTaskWithTransitionHandling(
          id,
          { status: 'in-progress' },
          `unblock-backlog:${source}`,
          { skipInProgressAutostart: true },
        );
        const p = projectStore.get();
        if (!p) return;
        const all = taskStore.getAll(p.id);
        const fresh = all.find((t) => t.id === id);
        if (fresh) {
          const s = await startSessionForTask(fresh, all);
          if (s && typeof s === 'object' && 'error' in s) {
            console.error('[task:unblock-autostart] session start failed (after backlog skip)', {
              source: `unblock-backlog:${source}`,
              taskId: fresh.id,
              error: (s as { error: string }).error,
              message: (s as { message?: string }).message,
            });
          }
        }
      },
    });
    broadcastLocalTasksChanged();
  }

  async function updateTaskWithTransitionHandling(
    id: string,
    patch: TaskUpdatePatch,
    source: string,
    options?: { skipInProgressAutostart?: boolean },
  ): Promise<Task> {
    const project = projectStore.get();
    if (!project) {
      throw new Error('No local project open');
    }
    const previous = taskStore.getAll(project.id).find((t) => t.id === id);
    if (!previous) {
      throw new Error(`Task not found: ${id}`);
    }
    let patchToApply = patch;
    if (patch.blockedByTaskIds !== undefined) {
      const all = taskStore.getAll(project.id);
      const v = validateBlockedByTaskIds(id, patch.blockedByTaskIds, all, false);
      if (!v.ok) {
        throw new Error(v.message);
      }
      patchToApply = { ...patch, blockedByTaskIds: v.normalized };
    }
    const touchesSourceBranch =
      patchToApply.sourceBranch !== undefined ||
      patchToApply.createSourceBranchIfMissing !== undefined;
    if (touchesSourceBranch) {
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const repo = repos.find((r) => r.rootPath === project.rootPath) ?? repos[0];
      const discovery = await collectRepoBranchDiscovery(
        project.rootPath,
        repo?.baseBranch ?? 'main',
      );
      if (taskSourceBranchSettingsWouldChange(previous, patchToApply, discovery.defaultBranchShort)) {
        if (previous.githubPr?.url?.trim()) {
          throw new Error(
            'Cannot change this task\'s source branch while a GitHub pull request is linked. Clear the pull request metadata on the task first.',
          );
        }
        const locked = await taskHasBlockingWorkspaceState({
          taskId: id,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir(),
          rootPath: worktreeService.getRootPath(),
        });
        if (locked) {
          const fluxBranch = fluxTaskWorkBranchName(id);
          throw new Error(
            `Cannot change this task's source branch while a Flux workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
          );
        }
      }
      const candidate = nextPersistedSourceBranchShortAfterPatch(previous, patchToApply);
      if (candidate !== undefined) {
        const v = validateStoredTaskSourceBranchName(candidate);
        if (!v.ok) {
          throw new Error(v.message);
        }
      }
    }

    const updated = await taskStore.update(id, patchToApply);
    await maybeAutoStartSessionOnInProgressTransition(previous, updated, source, options);
    if (updated.status === 'done' && previous.status !== 'done') {
      await processDependentsUnblockedAfterBlockerDone(previous, updated, source);
    }
    if (updated.status === 'done' && previous.status !== 'done' && !updated.workspaceCleanedAt) {
      let autoCleanup = false;
      try {
        autoCleanup = await projectStore.getAutoCleanupWorkspaceWhenDoneAt(activeProjectDir());
      } catch (err) {
        console.error('[task:auto-cleanup-workspace-on-done] failed to read setting', {
          source,
          taskId: updated.id,
          err,
        });
      }
      if (autoCleanup) {
        const errors = await teardownEphemeralResourcesForTask(
          daemonClient,
          worktreeService,
          id,
        );
        if (errors.length > 0) {
          console.error('[task:auto-cleanup-workspace-on-done] teardown', {
            source,
            taskId: id,
            errors,
          });
        }
        const cleaned = await taskStore.update(id, {
          workspaceCleanedAt: new Date().toISOString(),
        });
        broadcastLocalTasksChanged();
        return cleaned;
      }
    }
    return updated;
  }

  async function runStartSessionForTaskWithLogging(
    task: Task,
    source: string,
    projectTasks?: Task[],
  ): Promise<void> {
    try {
      const started = await startSessionForTask(task, projectTasks);
      if ('error' in started) {
        console.error('[task:start] session start failed', {
          source,
          taskId: task.id,
          error: started.error,
          message: started.message,
        });
      }
    } catch (err) {
      console.error('[task:start] unexpected session start failure', {
        source,
        taskId: task.id,
        err,
      });
    }
  }

  async function startTaskAndSession(id: string, source: string): Promise<Task> {
    const project = projectStore.get();
    if (!project) {
      throw new Error('No local project open');
    }
    const existing = taskStore.getAll(project.id).find((t) => t.id === id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }
    const columnTasks = taskStore.getAll(project.id);
    if (isTaskBlocked(existing, columnTasks)) {
      throw new Error(
        'Task is blocked by incomplete dependencies. Finish blocking tasks first.',
      );
    }
    const updated = await taskStore.update(id, { status: 'in-progress' });
    await runStartSessionForTaskWithLogging(updated, source, columnTasks);
    return updated;
  }

  ipcMain.handle(
    'session:start',
    async (
      _e,
      task: Task,
      projectTasks?: Task[],
      requesterUid?: string | null,
      options?: SessionStartOptions,
    ) => startSessionForTask(task, projectTasks, requesterUid, options),
  );

  ipcMain.handle('session:archive', async (_e, sessionId: string) => {
    sessionTaskMap.delete(sessionId);
    await daemonClient.closeShellsForSession(sessionId);
    await daemonClient.stopSession(sessionId);
  });

  ipcMain.handle('session:delete', async (_e, sessionId: string) => {
    sessionTaskMap.delete(sessionId);
    await deleteSessionWorkspaceAndStop(daemonClient, worktreeService, sessionId);
  });

  ipcMain.handle('session:get', async (_e, taskId: string) => {
    const sessions = await daemonClient.listSessions();
    const forTask = sessions.filter((s) => s.taskId === taskId);
    const running = forTask.find((s) => s.status === 'running');
    if (running) return running;
    const terminal = forTask.filter((s) => s.status === 'stopped' || s.status === 'error');
    if (terminal.length === 0) return null;
    terminal.sort((a, b) => {
      const ta = a.stoppedAt ?? a.startedAt ?? '';
      const tb = b.stoppedAt ?? b.startedAt ?? '';
      return ta.localeCompare(tb);
    });
    return terminal[terminal.length - 1] ?? null;
  });

  ipcMain.handle('session:getAll', async () => daemonClient.listSessions());

  ipcMain.handle(
    'session:attach',
    async (_e, sessionId: string): Promise<AttachResult | null> =>
      daemonClient.attachSession(sessionId),
  );

  ipcMain.on('session:write', (_e, sessionId: string, data: string) => {
    sendTaskSessionTerminalInput(sessionId, data);
  });

  ipcMain.on('session:resize', (_e, sessionId: string, cols: number, rows: number) => {
    daemonClient.resizeSession(sessionId, cols, rows);
  });

  ipcMain.handle('session:getSilenceStates', async () => {
    try {
      return await daemonClient.getSessionSilenceStates();
    } catch {
      return [];
    }
  });

  const mcpRendererBridge = new McpRendererBridge(() => mainWindow);
  mcpRendererBridge.install();
  fluxMcpRendererBridge = mcpRendererBridge;

  fluxMcpServer = new McpServer(
    taskStore,
    projectStore,
    appStateStore,
    bindingStore,
    mcpRendererBridge,
    () => mainWindow,
    {
      updateTask: (id, patch) =>
        updateTaskWithTransitionHandling(id, patch, 'mcp:flux__update_task'),
      startTask: (id) => startTaskAndSession(id, 'mcp:flux__start_task'),
      startSessionForExistingTask: (task) =>
        runStartSessionForTaskWithLogging(task, 'mcp:flux__start_task'),
      autoStartIfTransitionedToInProgress: (previous, updated) =>
        maybeAutoStartSessionOnInProgressTransition(
          previous,
          updated,
          'mcp:flux__update_task',
        ),
    },
  );
  fluxMcpServer.start();

  async function activeProjectIdForPlanning(): Promise<string | null> {
    const activeKey = appStateStore.get().activeProjectKey;
    if (!activeKey) return null;
    if (activeKey.kind === 'local') {
      return projectStore.get()?.id ?? null;
    }
    return activeKey.id;
  }

  ipcMain.handle('planning:list', async () => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return [];
    const all = await daemonClient.listPlanning();
    return all.filter((s) => s.projectId === pid);
  });

  ipcMain.handle(
    'planning:start',
    async (_e, payload: unknown) => {
      const parsed = parsePlanningStartPayload(payload);
      if (!parsed) {
        return { error: 'INVALID_PARAMS', message: 'Invalid planning start payload' };
      }
      const {
        agent: requestedAgent,
        agentModel: requestedModel,
        agentYolo: requestedYolo,
      } = parsed;

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
        const prefs = bindingStore.getPrefs(activeKey.id);
        planningAgent = isPlanningAgent(requestedAgent)
          ? requestedAgent
          : prefs.planningAgent;
        try {
          await bindingStore.setPrefs(activeKey.id, { planningAgent });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: 'CONFIG_WRITE_FAILED', message };
        }
        project = {
          id: activeKey.id,
          kind: 'cloud',
          name: path.basename(binding.rootPath),
          rootPath: binding.rootPath,
          ownerId: '',
          memberIds: [],
          createdAt: '',
          ...prefs,
          planningAgent,
        };
      }

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

      const spawnModel = resolvedPlanningModelForSpawn(
        project,
        planningAgent,
        requestedModel,
      );
      const spawnYolo = resolvedPlanningYoloForSpawn(project, requestedYolo);
      const { command, args } = planningSpawnSpec(
        planningAgent,
        mcpConfigPath,
        spawnModel,
        spawnYolo,
      );
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

  ipcMain.handle('planning:stop', async (_e, sessionId: string) => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return;
    const s = await daemonClient.getPlanning(sessionId);
    if (!s || s.projectId !== pid) return;
    await daemonClient.stopPlanning(sessionId);
  });

  ipcMain.handle('planning:get', async (_e, sessionId: string) => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return null;
    const s = await daemonClient.getPlanning(sessionId);
    if (!s || s.projectId !== pid) return null;
    return s;
  });

  ipcMain.handle(
    'planning:attach',
    async (_e, sessionId: string): Promise<PlanningAttachResult | null> => {
      const pid = await activeProjectIdForPlanning();
      if (!pid) return null;
      const s = await daemonClient.getPlanning(sessionId);
      if (!s || s.projectId !== pid) return null;
      return daemonClient.attachPlanning(sessionId);
    },
  );

  ipcMain.on('planning:write', (_e, sessionId: string, data: string) => {
    void (async () => {
      const pid = await activeProjectIdForPlanning();
      if (!pid) return;
      const s = await daemonClient.getPlanning(sessionId);
      if (!s || s.projectId !== pid) return;
      daemonClient.writePlanning(sessionId, data);
    })();
  });

  ipcMain.on(
    'planning:resize',
    (_e, sessionId: string, cols: number, rows: number) => {
      void (async () => {
        const pid = await activeProjectIdForPlanning();
        if (!pid) return;
        const s = await daemonClient.getPlanning(sessionId);
        if (!s || s.projectId !== pid) return;
        daemonClient.resizePlanning(sessionId, cols, rows);
      })();
    },
  );

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

  ipcMain.handle(
    'shell:attach',
    async (_e, shellId: string): Promise<AttachResult | null> =>
      daemonClient.attachShell(shellId),
  );

  ipcMain.on('shell:write', (_e, shellId: string, data: string) => {
    daemonClient.writeShell(shellId, data);
  });

  ipcMain.on('shell:resize', (_e, shellId: string, cols: number, rows: number) => {
    daemonClient.resizeShell(shellId, cols, rows);
  });

  createWindow();
  if (mainWindow && fluxMcpRendererBridge) {
    fluxMcpRendererBridge.attachWindow(mainWindow);
  }
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
    if (mainWindow && fluxMcpRendererBridge) {
      fluxMcpRendererBridge.attachWindow(mainWindow);
    }
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
