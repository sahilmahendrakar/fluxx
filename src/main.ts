import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore } from './main/ProjectStore';
import {
  effectiveTaskRepoId,
  nextPersistedRepoIdAfterPatch,
  persistedRepoIdsEqual,
  repoDisplayLabel,
  resolveLocalTaskRepoIdForCreate,
  resolvePrimaryRepoId,
  resolveRepoForBranchDiscovery,
  validateTaskRepoIdPatchValue,
} from './repoIdentity';
import { McpServer } from './main/McpServer';
import { McpRendererBridge } from './main/McpRendererBridge';
import { AppStateStore } from './main/AppStateStore';
import { repoConfigsFromCloudSharedAndBinding } from './cloudRepoDiskSync';
import { hydrateCloudProject } from './cloudBindingPrefs';
import {
  migrateLegacyCloudBinding,
  primaryRootPathFromCloudBinding,
} from './cloudLocalBindingMigration';
import { LocalBindingStore } from './main/LocalBindingStore';
import { WorktreeService } from './main/WorktreeService';
import {
  cwdUnderTrustPromptAutorespondRoots,
  trustPromptAutorespondRootsForProject,
} from './main/trustPromptAutorespondRoots';
import { DaemonClient } from './main/DaemonClient';
import { removeFluxOwnedLocalState } from './main/projectFluxRemoval';
import { applyShellEnvToProcess } from './main/userShellEnv';
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
import { openWorkspacePath, pickSessionForTaskWorktree, resolveTaskWorktreePath } from './main/openWorkspacePath';
import {
  discoverGithubPrForTaskWorktree,
  ghPrViewJson,
  prMetadataRefMismatchWarning,
  readOriginRemote,
  resolveGithubPrGitOperationPaths,
  validateGithubPrMatchesTaskRemote,
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
import {
  createPlanningDocsWatcher,
  notifyPlanningDocsChanged,
} from './main/PlanningDocsWatcher';
import {
  applyFirestorePlanningDocsSnapshot,
  persistPlanningDocsConflictLocal,
  recordPlanningDocsPushSuccess,
} from './main/planningDocsFirestoreHydrate';
import { listPlanningDocsPushCandidates } from './main/planningDocsFirestorePush';
import {
  planningDocsSyncFolderAbs,
  resolvePlanningDocConflictMarkMerged,
  resolvePlanningDocConflictResumePush,
  resolvePlanningDocConflictTakeRemote,
} from './main/planningDocsConflictResolve';
import { enrichPlanningDocsListForCloudWorkspace } from './main/planningDocsListEnrichment';
import {
  applyPlanningDocsFirestoreHydrationPlan,
  patchPlanningDocsCloudMigrationState,
  readPlanningDocsCloudMigrationState,
} from './main/planningDocsMigrationDisk';
import type { FirestoreHydrationWritePlan } from './planningDocs/cloudPlanningDocsMigration';
import type {
  PlanningDocsApplyFirestoreSnapshotResult,
  PlanningDocsConflictRecordV1,
  PlanningDocsListPushCandidatesResult,
  PlanningDocsPersistConflictPayload,
  PlanningDocsRecordPushSuccessPayload,
  PlanningDocsRecordPushSuccessResult,
  PlanningDocsResolveConflictIpcResult,
  PlanningDocsResolveConflictPayload,
  PlanningDocsRevealSyncFolderResult,
} from './planningDocs/syncTypes';
import type {
  PlanningDocsCloudMigrationPersistedV1,
  PlanningDocsWriteResult,
} from './planningDocs/types';
import {
  createPlanningDocsProviderBundle,
  planningDocsProviderForActiveProject,
} from './planningDocs/selectPlanningDocsProvider';
import { normalizePlanningDocRelativePath } from './planningDocs/path';
import type { PlanningDocsProvider } from './planningDocs/FilesystemPlanningDocsProvider';
import type {
  ActiveProjectKey,
  Agent,
  AgentSpawnDefaultsPatch,
  CloudProjectLocalBinding,
  CloudRepoBindingOverview,
  CloudSharedRepo,
  ProjectTabState,
  LocalProject,
  Project,
  RepoBranchDiscovery,
  RepoBranchDiscoveryRequest,
  RepoBranchDiscoveryResponse,
  RepoConfig,
  RepoManagementState,
  RepoSettingsPatch,
  Session,
  SessionStartOptions,
  SessionStartResult,
  Task,
  TaskAttachedPlanningDoc,
  TaskGithubPr,
  TaskPullRequestIpcResult,
  TaskRequestPullRequestFromAgentResult,
  ResolveTaskWorktreeIpcResult,
} from './types';
import {
  mergeTaskRowWithPullRequestAgentPayload,
  parseTaskRequestPullRequestFromAgentPayload,
} from './taskRequestPullRequestFromAgentContext';
import {
  classifyGitBranchPresence,
  effectiveTaskSourceBranchShort,
  nextPersistedSourceBranchShortAfterPatch,
  planTaskSourceBranchFieldsForCreate,
  resolveCreateSourceBranchIfMissingForStart,
  validateStoredTaskSourceBranchName,
} from './taskBranches';
import { collectRepoBranchDiscovery } from './main/repoGit';
import { isWorktreeCreateError, WorktreeCreateError } from './main/worktreeCreateError';
import {
  taskHasBlockingWorkspaceState,
  taskSourceBranchSettingsWouldChange,
} from './main/taskSourceBranchGuard';
import { registerAppUpdater } from './main/AppUpdater';
import { expectedFluxWorkBranchForTask } from './main/fluxTaskBranch';
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
      await migrateTaskRepoIdsForProject(taskStore, project);
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
  await migrateTaskRepoIdsForProject(taskStore, project);
  worktreeService.setRootPath(project.rootPath);
  worktreeService.setProjectDir(projectDir);
  await appStateStore.set({
    lastOpenedProjectDir: projectDir,
    activeProjectKey: { kind: 'local', id: project.id },
  });
}

/**
 * Multi-repo2 task migration: backfill `Task.repoId` to the project's
 * primary repo for legacy rows. Lifted out so every taskStore.reinit
 * site can call it consistently.
 */
async function migrateTaskRepoIdsForProject(
  taskStore: TaskStore,
  project: LocalProject,
): Promise<void> {
  const primary = resolvePrimaryRepoId(project);
  if (!primary) return;
  await taskStore.migrateMissingRepoIds(primary);
}

// Matches renderer `bg-gray-950` (Tailwind default palette) so native chrome
// and any pre-paint window surface are not a contrasting light color.
const WINDOW_BACKGROUND = '#030712';

/** PNG copied next to `main.js` by `vite.main.config.ts` for dev + packaged builds. */
function resolveWindowIconPath(): string | undefined {
  const nextToMain = path.join(__dirname, 'app-icon.png');
  if (existsSync(nextToMain)) return nextToMain;
  const dev = path.resolve(process.cwd(), '.vite/build/app-icon.png');
  if (existsSync(dev)) return dev;
  return undefined;
}

let mainWindow: BrowserWindow | null = null;

let fluxMcpServer: McpServer | null = null;
let fluxMcpRendererBridge: McpRendererBridge | null = null;

let planningDocsWatcher: ReturnType<typeof createPlanningDocsWatcher> | null = null;

const createWindow = () => {
  const windowIcon = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Flux',
    backgroundColor: WINDOW_BACKGROUND,
    ...(windowIcon ? { icon: windowIcon } : {}),
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[mainWindow] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[mainWindow] render-process-gone', details);
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

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
  // Resolve the user's interactive-login-shell env BEFORE the daemon
  // spawns. In packaged macOS GUI launches the parent inherits launchd's
  // minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), which makes `agent`,
  // `claude`, `codex`, `gh`, etc. unreachable from PTY children — node-pty
  // surfaces ENOENT as an immediate PTY exit, and the renderer renders
  // "This planning session has ended" the moment the user starts one.
  // Side-effecting `process.env` here means the daemon (and every PTY
  // it ever spawns) inherits the corrected env without per-call wiring.
  // See `docs/daemon-packaging.md` and `src/main/userShellEnv.ts`.
  await applyShellEnvToProcess();

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
        const { projectDir: materialisedDir } = await projectStore.ensureLayoutForRoot(
          project.rootPath,
        );
        if (materialisedDir !== lastOpenedProjectDir) {
          await projectStore.init(materialisedDir);
        }
        await taskStore.reinit(materialisedDir);
        await migrateTaskRepoIdsForProject(taskStore, project);
        worktreeService.setRootPath(project.rootPath);
        worktreeService.setProjectDir(materialisedDir);
        await appStateStore.set({
          lastOpenedProjectDir: materialisedDir,
          activeProjectKey: { kind: 'local', id: project.id },
        });
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
        const { projectDir: materialisedDir } = await projectStore.ensureLayoutForRoot(
          project.rootPath,
        );
        if (materialisedDir !== lastOpenedProjectDir) {
          await projectStore.init(materialisedDir);
        }
        await taskStore.reinit(materialisedDir);
        await migrateTaskRepoIdsForProject(taskStore, project);
        worktreeService.setRootPath(project.rootPath);
        worktreeService.setProjectDir(materialisedDir);
        await appStateStore.set({
          activeProjectKey: { kind: 'local', id: project.id },
          lastOpenedProjectDir: materialisedDir,
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
      const boundRoot = primaryRootPathFromCloudBinding(activeProjectKey.id, binding);
      if (boundRoot) {
        try {
          await fs.access(path.join(boundRoot, '.git'));
          activeRootPath = boundRoot;
        } catch {
          activeRootPath = '';
        }
      }
    }
  }

  if (activeProjectKey?.kind === 'cloud' && activeRootPath) {
    try {
      const { projectDir } = await projectStore.ensureCloudLayoutForRoot(
        activeProjectKey.id,
        activeRootPath,
      );
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
    buttonLabel = 'Open project',
  ): Promise<{ rootPath: string } | { error: 'NOT_GIT_REPO' } | null> {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const dialogOpts = {
      properties: ['openDirectory' as const],
      title,
      buttonLabel,
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
    await migrateTaskRepoIdsForProject(taskStore, project);
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

  registerAppUpdater();

  function parseActiveProjectKeyPayload(raw: unknown): ActiveProjectKey | null {
    if (!raw || typeof raw !== 'object') return null;
    const k = raw as Partial<ActiveProjectKey>;
    if (k.kind !== 'local' && k.kind !== 'cloud') return null;
    if (typeof k.id !== 'string' || !k.id.trim()) return null;
    return { kind: k.kind, id: k.id.trim() };
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

  async function repoPathStatus(rootPath: string): Promise<RepoManagementState['pathStatus']> {
    const resolved = path.resolve(rootPath);
    try {
      await fs.access(resolved);
    } catch {
      return 'missing';
    }
    try {
      await fs.access(path.join(resolved, '.git'));
      return 'valid';
    } catch {
      return 'not_git';
    }
  }

  const UNBOUND_REPO_BRANCH_DISCOVERY =
    'No local clone is bound for this repository. Open Project settings → Project Config and use “Bind local folder” for that repository.';

  function parseCloudSharedReposArg(raw: unknown): CloudSharedRepo[] {
    if (!Array.isArray(raw)) return [];
    const out: CloudSharedRepo[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (
        typeof o.id !== 'string' ||
        typeof o.name !== 'string' ||
        typeof o.baseBranch !== 'string'
      ) {
        continue;
      }
      const repo: CloudSharedRepo = {
        id: o.id.trim(),
        name: o.name,
        baseBranch: o.baseBranch,
      };
      if (typeof o.remoteUrl === 'string' && o.remoteUrl.trim() !== '') {
        repo.remoteUrl = o.remoteUrl.trim();
      }
      out.push(repo);
    }
    return out;
  }

  async function syncCloudReposDiskFromBinding(params: {
    cloudProjectId: string;
    projectDir: string;
    sharedRepos: CloudSharedRepo[];
  }): Promise<void> {
    const binding = bindingStore.get(params.cloudProjectId);
    if (!binding) return;
    const built = repoConfigsFromCloudSharedAndBinding(
      params.cloudProjectId,
      params.sharedRepos,
      binding,
    );
    if (!built || built.repos.length === 0) return;
    await projectStore.applyCloudRepoBindings(
      params.projectDir,
      built.primaryRootPath,
      built.repos,
    );
  }

  async function activeConfigProjectId(projectDir: string): Promise<string> {
    const loaded = projectStore.get()?.id ?? '';
    if (loaded) return loaded;
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(projectDir, 'config.json'), 'utf8'),
      ) as { id?: string };
      if (typeof parsed.id === 'string') return parsed.id;
    } catch {
      // Fall through to the shared validation error below.
    }
    throw new Error('Invalid project configuration');
  }

  async function repoRemovalBlockers(params: {
    configProjectId: string;
    repoId: string;
    repos: RepoConfig[];
  }): Promise<{ taskCount: number; workspaceCount: number }> {
    const primaryRepoId = params.repos[0]?.id;
    if (!primaryRepoId) {
      throw new Error('No repositories configured');
    }

    const localProject = projectStore.get();
    const tasks =
      localProject?.id === params.configProjectId
        ? taskStore.getAll(params.configProjectId)
        : [];

    const taskCount = tasks.filter(
      (t) => effectiveTaskRepoId(t, primaryRepoId) === params.repoId,
    ).length;

    const sessions = await daemonClient.listSessions();
    let workspaceCount = 0;
    for (const s of sessions) {
      if (s.projectId !== params.configProjectId) continue;

      let effectiveRepo = s.repoId?.trim();
      if (!effectiveRepo || effectiveRepo.length === 0) {
        const task = tasks.find((x) => x.id === s.taskId);
        effectiveRepo = task
          ? effectiveTaskRepoId(task, primaryRepoId)
          : primaryRepoId;
      }
      if (effectiveRepo === params.repoId) {
        workspaceCount += 1;
      }
    }

    return { taskCount, workspaceCount };
  }

  function normalizeBranchDiscoveryArg(
    raw: unknown,
  ): { repoId?: string; classifyBranch?: string } {
    if (raw == null) return {};
    if (typeof raw === 'string') {
      return { classifyBranch: raw };
    }
    if (typeof raw === 'object') {
      const o = raw as RepoBranchDiscoveryRequest;
      const repoId =
        typeof o.repoId === 'string' && o.repoId.trim() !== ''
          ? o.repoId.trim()
          : undefined;
      const classifyBranch =
        typeof o.classifyBranch === 'string' ? o.classifyBranch : undefined;
      return { ...(repoId !== undefined ? { repoId } : {}), classifyBranch };
    }
    return {};
  }

  async function assertRepoUnusedForRemoval(params: {
    configProjectId: string;
    repoId: string;
    repos: RepoConfig[];
  }): Promise<void> {
    const blockers = await repoRemovalBlockers(params);
    if (blockers.taskCount > 0) {
      throw new Error(
        `Cannot remove repository: ${blockers.taskCount} task(s) still reference it.`,
      );
    }

    if (blockers.workspaceCount > 0) {
      throw new Error(
        `Cannot remove repository: ${blockers.workspaceCount} workspace(s) still reference it.`,
      );
    }
  }

  ipcMain.handle(
    'project:getRepoManagementStates',
    async (): Promise<
      | Record<string, RepoManagementState>
      | { error: string }
    > => {
      try {
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        const projectId = await activeConfigProjectId(projectDir);
        const entries = await Promise.all(
          repos.map(async (repo): Promise<[string, RepoManagementState]> => {
            const [pathState, blockers] = await Promise.all([
              repoPathStatus(repo.rootPath),
              repoRemovalBlockers({
                configProjectId: projectId,
                repoId: repo.id,
                repos,
              }),
            ]);
            return [
              repo.id,
              {
                pathStatus: pathState,
                removalBlocked: blockers.taskCount > 0 || blockers.workspaceCount > 0,
                blockingTaskCount: blockers.taskCount,
                blockingWorkspaceCount: blockers.workspaceCount,
              },
            ];
          }),
        );
        return Object.fromEntries(entries);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    'project:pickRepoDirectory',
    async (): Promise<
      | { rootPath: string }
      | { error: 'NOT_GIT_REPO' }
      | { error: string }
      | null
    > => {
      return pickDirectory('Add repository to project', 'Add repository');
    },
  );

  ipcMain.handle(
    'project:getCloudRepoBindingOverview',
    async (_e, rawSharedRepos: unknown): Promise<
      CloudRepoBindingOverview | { error: string; code?: string }
    > => {
      const key = appStateStore.get().activeProjectKey;
      if (key?.kind !== 'cloud') {
        return { error: 'No cloud project is open.', code: 'NOT_CLOUD' };
      }
      const sharedRepos = parseCloudSharedReposArg(rawSharedRepos);
      const binding = bindingStore.get(key.id);
      const migrated = binding ? migrateLegacyCloudBinding(key.id, binding) : null;
      const rb = migrated?.repoBindings ?? {};
      const out: CloudRepoBindingOverview = {};
      for (const sr of sharedRepos) {
        const machine = rb[sr.id];
        if (!machine?.rootPath) {
          out[sr.id] = { kind: 'missing_binding' };
          continue;
        }
        const pathStatus = await repoPathStatus(machine.rootPath);
        out[sr.id] = {
          kind: 'bound',
          rootPath: machine.rootPath,
          pathStatus,
        };
      }
      return out;
    },
  );

  ipcMain.handle(
    'project:bindCloudSharedRepo',
    async (
      _e,
      payload: unknown,
    ): Promise<
      | { ok: true; binding: CloudProjectLocalBinding }
      | { error: string; code?: 'NOT_GIT_REPO' }
    > => {
      const key = appStateStore.get().activeProjectKey;
      if (key?.kind !== 'cloud') {
        return { error: 'No cloud project is open.' };
      }
      if (!payload || typeof payload !== 'object') {
        return { error: 'Invalid payload' };
      }
      const p = payload as Record<string, unknown>;
      const repoId = typeof p.repoId === 'string' ? p.repoId.trim() : '';
      const rootPath = typeof p.rootPath === 'string' ? p.rootPath.trim() : '';
      const sharedRepos = parseCloudSharedReposArg(p.sharedRepos);
      if (!repoId) return { error: 'repoId is required' };
      if (!rootPath) return { error: 'rootPath is required' };
      try {
        await fs.access(path.join(rootPath, '.git'));
      } catch {
        return { error: 'That folder is not a git repository.', code: 'NOT_GIT_REPO' };
      }
      const binding = await bindingStore.setRepoMachineBinding(key.id, repoId, rootPath);
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) {
        return { error: 'No active workspace directory.' };
      }
      await syncCloudReposDiskFromBinding({
        cloudProjectId: key.id,
        projectDir,
        sharedRepos,
      });
      return { ok: true, binding };
    },
  );

  ipcMain.handle(
    'project:syncCloudSharedRepos',
    async (_e, rawSharedRepos: unknown): Promise<{ ok: true } | { error: string }> => {
      const key = appStateStore.get().activeProjectKey;
      if (key?.kind !== 'cloud') return { error: 'No cloud project is open.' };
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) return { error: 'No workspace' };
      const sharedRepos = parseCloudSharedReposArg(rawSharedRepos);
      await syncCloudReposDiskFromBinding({
        cloudProjectId: key.id,
        projectDir,
        sharedRepos,
      });
      return { ok: true };
    },
  );

  ipcMain.handle(
    'repo:getBranchDiscovery',
    async (
      _e,
      arg?: string | RepoBranchDiscoveryRequest,
    ): Promise<RepoBranchDiscoveryResponse | { error: string }> => {
      try {
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        const { repoId, classifyBranch } = normalizeBranchDiscoveryArg(arg);
        const repo = resolveRepoForBranchDiscovery(repos, repoId);
        if (!repo?.rootPath) {
          const explicit = repoId != null && repoId.trim().length > 0;
          const activeKey = appStateStore.get().activeProjectKey;
          return {
            error: explicit
              ? activeKey?.kind === 'cloud'
                ? UNBOUND_REPO_BRANCH_DISCOVERY
                : `Unknown repository id "${repoId?.trim()}" for this local project. Open Project settings → Project Config and choose a repository that exists on this project.`
              : 'No repository root configured for this project',
          };
        }
        let base: RepoBranchDiscovery;
        try {
          base = await collectRepoBranchDiscovery(repo.rootPath, repo.baseBranch);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const label = repoDisplayLabel(repo);
          return { error: `${label}: ${msg}` };
        }
        if (classifyBranch == null || classifyBranch.trim() === '') {
          return base;
        }
        const { normalizedShort, presence } = classifyGitBranchPresence(
          classifyBranch,
          base.localBranches,
          base.remoteBranches,
        );
        return {
          ...base,
          classification: {
            raw: classifyBranch,
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
        patch: RepoSettingsPatch;
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
  ipcMain.handle(
    'project:updateRepoById',
    async (
      _e,
      payload: { repoId: string; patch: RepoSettingsPatch },
    ): Promise<
      | { ok: true; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        const rid = (payload.repoId ?? '').trim();
        if (!rid) {
          return { error: 'repoId is required' };
        }
        const repos = await projectStore.updateRepoByIdAt(
          activeProjectDir(),
          rid,
          payload.patch,
        );
        return { ok: true, repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:addRepo',
    async (
      _e,
      payload: { rootPath: string },
    ): Promise<
      | { ok: true; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        const root = (payload.rootPath ?? '').trim();
        if (!root) {
          return { error: 'rootPath is required' };
        }
        const repos = await projectStore.addRepoAt(activeProjectDir(), root);
        return { ok: true, repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:removeRepo',
    async (
      _e,
      payload: { repoId: string },
    ): Promise<
      | { ok: true; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        const rid = (payload.repoId ?? '').trim();
        if (!rid) {
          return { error: 'repoId is required' };
        }
        const projectDir = activeProjectDir();
        const reposBefore = await projectStore.getReposAt(projectDir);
        const projectId = await activeConfigProjectId(projectDir);
        await assertRepoUnusedForRemoval({
          configProjectId: projectId,
          repoId: rid,
          repos: reposBefore,
        });
        const repos = await projectStore.removeRepoAt(projectDir, rid);
        return { ok: true, repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:setPrimaryRepo',
    async (
      _e,
      payload: { repoId: string },
    ): Promise<
      | { ok: true; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        const rid = (payload.repoId ?? '').trim();
        if (!rid) {
          return { error: 'repoId is required' };
        }
        const repos = await projectStore.setPrimaryRepoAt(
          activeProjectDir(),
          rid,
        );
        return { ok: true, repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'project:getPrimaryRepoId',
    async (): Promise<{ ok: true; repoId: string | null } | { error: string }> => {
      try {
        const repos = await projectStore.getReposAt(activeProjectDir());
        return { ok: true, repoId: repos[0]?.id ?? null };
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
        if (next === true) {
          const activeProject = projectStore.get();
          if (activeProject) {
            const cleared = await taskStore.bulkClearAutoStartOnUnblockForBlockedTasks(activeProject.id);
            if (cleared > 0) {
              broadcastLocalTasksChanged();
            }
          }
        }
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getAutoRespondToTrustPrompts', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).autoRespondToTrustPrompts;
    }
    return projectStore.getAutoRespondToTrustPromptsAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setAutoRespondToTrustPrompts',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            autoRespondToTrustPrompts: enabled === true,
          });
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).autoRespondToTrustPrompts,
          };
        }
        const next = await projectStore.setAutoRespondToTrustPromptsAt(activeProjectDir(), enabled);
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
      const { projectDir: materialisedDir } = await projectStore.ensureLayoutForRoot(
        project.rootPath,
      );
      if (materialisedDir !== projectDir) {
        await projectStore.init(materialisedDir);
      }
      await taskStore.reinit(materialisedDir);
      await taskStore.migrateMissingProjectIds(project.id);
      await migrateTaskRepoIdsForProject(taskStore, project);
      worktreeService.setRootPath(project.rootPath);
      worktreeService.setProjectDir(materialisedDir);
      await appStateStore.set({
        lastOpenedProjectDir: materialisedDir,
        activeProjectKey: { kind: 'local', id: project.id },
      });
      return project;
    },
  );
  ipcMain.handle('projects:removeLocal', async (_e, id: string) => {
    const result = await removeFluxOwnedLocalState({
      key: { kind: 'local', id },
      fluxBaseDir,
      projectStore,
      daemonClient,
      appStateStore,
      bindingStore,
      clearInMemoryWorkspaceIfActive: clearLocalWorkspaceState,
    });
    if (!result.ok) {
      console.error('[projects:removeLocal] incomplete', result.errors, result.warnings);
    }
  });
  ipcMain.handle('projects:removeFluxOwnedLocalState', async (_e, raw: unknown) => {
    const key = parseActiveProjectKeyPayload(raw);
    if (!key) {
      return {
        ok: false,
        warnings: [],
        errors: ['Invalid project key'],
        deletedMaterializationDirs: [],
      };
    }
    return removeFluxOwnedLocalState({
      key,
      fluxBaseDir,
      projectStore,
      daemonClient,
      appStateStore,
      bindingStore,
      clearInMemoryWorkspaceIfActive: clearLocalWorkspaceState,
    });
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
      const primary =
        primaryRootPathFromCloudBinding(cloudProjectId, binding) ?? picked.rootPath;
      return { rootPath: primary };
    },
  );
  ipcMain.handle(
    'projects:activateCloud',
    async (
      _e,
      payload: { id: string; rootPath: string; sharedRepos?: CloudSharedRepo[] },
    ) => {
      try {
        await fs.access(path.join(payload.rootPath, '.git'));
      } catch {
        return { error: 'NOT_GIT_REPO' as const };
      }
      await bindingStore.set(payload.id, payload.rootPath);
      await projectStore.clear();
      await taskStore.reinit('');
      const { projectDir } = await projectStore.ensureCloudLayoutForRoot(
        payload.id,
        payload.rootPath,
      );
      worktreeService.setRootPath(payload.rootPath);
      worktreeService.setProjectDir(projectDir);
      await appStateStore.set({
        activeProjectKey: { kind: 'cloud', id: payload.id },
      });
      if (payload.sharedRepos && payload.sharedRepos.length > 0) {
        await syncCloudReposDiskFromBinding({
          cloudProjectId: payload.id,
          projectDir,
          sharedRepos: payload.sharedRepos,
        });
      }
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
  ipcMain.handle(
    'workspace:resolveTaskWorktree',
    async (_e, payload: unknown): Promise<ResolveTaskWorktreeIpcResult> => {
      const parsed = parseResolveTaskWorktreePayload(payload);
      const taskId = parsed.taskId;
      if (!taskId) {
        return {
          path: null,
          detail: { code: 'no-worktree', message: 'Invalid task id.' },
        };
      }
      const projectDir = worktreeService.getProjectDir();
      const project = projectStore.get();
      const row = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      const resolved = await resolveTaskWorktreePath(
        taskId,
        () => daemonClient.listSessions(),
        projectDir ?? '',
        parsed.repoId,
        parsed.fluxWorkBranch ?? row?.fluxWorkBranch,
      );
      if (resolved) {
        return { path: resolved };
      }
      const detail = await detailWhenResolveFailed(parsed.repoId, projectDir);
      return { path: null, detail };
    },
  );

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
        repoId?: string;
        attachedPlanningDocs?: TaskAttachedPlanningDoc[];
      },
    ) => {
      const project = projectStore.get();
      if (!project) {
        throw new Error('No local project open');
      }
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const repoResolved = resolveLocalTaskRepoIdForCreate(repos, input.repoId);
      if (!repoResolved.ok) {
        throw new Error(repoResolved.message);
      }
      const repo = resolveRepoForBranchDiscovery(repos, repoResolved.repoId);
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
        repoId: repoResolved.repoId,
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
          ? (previousFields as Pick<
              Task,
              'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId' | 'fluxWorkBranch'
            > & {
              githubPr?: TaskGithubPr;
            })
          : {};
      const patch =
        patchFields && typeof patchFields === 'object'
          ? (patchFields as Pick<Task, 'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId'>)
          : {};
      try {
        const project = projectStore.get();
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        if (patch.repoId !== undefined) {
          const vrRepo = validateTaskRepoIdPatchValue(repos, patch.repoId);
          if (!vrRepo.ok) {
            return { ok: false, message: vrRepo.message };
          }
        }
        const repoIdForDiscovery =
          patch.repoId !== undefined
            ? nextPersistedRepoIdAfterPatch(prev.repoId, patch.repoId)
            : prev.repoId;
        const repoCfg = resolveRepoForBranchDiscovery(repos, repoIdForDiscovery);
        if (!repoCfg?.rootPath) {
          return {
            ok: false,
            message:
              repoIdForDiscovery != null && String(repoIdForDiscovery).trim() !== ''
                ? 'Unknown repository id for this project'
                : 'No repository root configured for this project',
          };
        }
        const discovery = await collectRepoBranchDiscovery(repoCfg.rootPath, repoCfg.baseBranch);
        const localRow =
          project && project.kind === 'local'
            ? taskStore.getAll(project.id).find((t) => t.id === tid)
            : undefined;
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
        const linkedPrUrl = (localRow?.githubPr?.url ?? prev.githubPr?.url)?.trim();
        if (linkedPrUrl) {
          return {
            ok: false,
            message:
              'Cannot change this task\'s source branch while a GitHub pull request is linked. Clear the pull request metadata on the task first, then you can change the base branch.',
          };
        }
        const repoGitRootsForGuard = [...new Set(repos.map((r) => path.resolve(r.rootPath)))];
        const locked = await taskHasBlockingWorkspaceState({
          taskId: tid,
          fluxWorkBranch: localRow?.fluxWorkBranch,
          repoId: prev.repoId,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsForGuard,
        });
        if (locked) {
          const fluxBranch = expectedFluxWorkBranchForTask({
            id: tid,
            fluxWorkBranch: localRow?.fluxWorkBranch,
          });
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
  ipcMain.handle(
    'tasks:assertRepoIdEditable',
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
          ? (previousFields as Pick<Task, 'repoId' | 'fluxWorkBranch'> & { githubPr?: TaskGithubPr })
          : {};
      const patch =
        patchFields && typeof patchFields === 'object'
          ? (patchFields as Pick<Task, 'repoId'>)
          : {};
      if (patch.repoId === undefined) {
        return { ok: true };
      }
      try {
        const projectDir = activeProjectDir();
        const repos = await projectStore.getReposAt(projectDir);
        const vr = validateTaskRepoIdPatchValue(repos, patch.repoId);
        if (!vr.ok) {
          return { ok: false, message: vr.message };
        }
        const nextRepoId = nextPersistedRepoIdAfterPatch(prev.repoId, patch.repoId);
        if (persistedRepoIdsEqual(prev.repoId, nextRepoId)) {
          return { ok: true };
        }
        const linkedPrUrl = (prev.githubPr?.url ?? '').trim();
        if (linkedPrUrl) {
          return {
            ok: false,
            message:
              'Cannot change this task\'s repository while a GitHub pull request is linked. Clear the pull request metadata on the task first, then you can change the repository.',
          };
        }
        const project = projectStore.get();
        const localRow =
          project && project.kind === 'local'
            ? taskStore.getAll(project.id).find((t) => t.id === tid)
            : undefined;
        const repoGitRootsForRepoPatch = [...new Set(repos.map((r) => path.resolve(r.rootPath)))];
        const locked = await taskHasBlockingWorkspaceState({
          taskId: tid,
          fluxWorkBranch: localRow?.fluxWorkBranch,
          repoId: prev.repoId,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsForRepoPatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxWorkBranchForTask({
            id: tid,
            fluxWorkBranch: localRow?.fluxWorkBranch,
          });
          return {
            ok: false,
            message: `Cannot change this task's repository while a Flux workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
          };
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
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const project = projectStore.get();
      const taskRow = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      const taskRepoId = taskRow?.repoId?.trim() || null;
      const errors = await teardownEphemeralResourcesForTask(
        daemonClient,
        worktreeService,
        taskId,
        repos,
        taskRepoId,
        taskRow?.fluxWorkBranch?.trim() || null,
      );
      return { errors };
    },
  );

  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  ipcMain.handle('tasks:resolveWorktrees', async (_e, raw: unknown): Promise<Record<string, boolean>> => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) return {};
    let entries: { taskId: string; repoId?: string | null; fluxWorkBranch?: string | null }[] = [];
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (
        first &&
        typeof first === 'object' &&
        typeof (first as { taskId?: unknown }).taskId === 'string'
      ) {
        entries = raw
          .filter((x): x is { taskId: string; repoId?: unknown; fluxWorkBranch?: unknown } => {
            return Boolean(
              x &&
                typeof x === 'object' &&
                typeof (x as { taskId?: unknown }).taskId === 'string' &&
                String((x as { taskId: string }).taskId).trim().length > 0,
            );
          })
          .map((x) => {
            const repoId = x.repoId;
            const fluxRaw = x.fluxWorkBranch;
            return {
              taskId: String(x.taskId).trim(),
              repoId:
                typeof repoId === 'string' ? repoId : repoId === null ? null : undefined,
              fluxWorkBranch:
                typeof fluxRaw === 'string'
                  ? fluxRaw.trim()
                  : fluxRaw === null
                    ? null
                    : undefined,
            };
          });
      } else {
        entries = raw
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => ({ taskId: x.trim() }));
      }
    }
    const capped = entries.slice(0, 400);
    const out: Record<string, boolean> = {};
    const project = projectStore.get();
    const byId =
      project && project.kind === 'local'
        ? new Map(taskStore.getAll(project.id).map((t) => [t.id, t]))
        : null;
    for (const { taskId, repoId, fluxWorkBranch } of capped) {
      const fw = fluxWorkBranch ?? byId?.get(taskId)?.fluxWorkBranch ?? null;
      const p = await resolveTaskWorktreePath(
        taskId,
        () => daemonClient.listSessions(),
        projectDir,
        repoId,
        fw,
      );
      out[taskId] = Boolean(p);
    }
    return out;
  });

  /**
   * Task UX when the user (or automation) submits a line to a task session PTY
   * (`\r` / `\n`). Kept separate from {@link sendTaskSessionTerminalInput} so
   * `tasks:requestPullRequestFromAgent` can await daemon writes then apply the
   * same effects without double-sending bytes.
   */
  function applyTaskSessionSubmitSideEffects(sessionId: string): void {
    const taskId = sessionTaskMap.get(sessionId);
    if (!taskId) return;

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

    const submitted = data.includes('\r') || data.includes('\n');
    if (!submitted) return;
    applyTaskSessionSubmitSideEffects(sessionId);
  }

  ipcMain.handle(
    'tasks:requestPullRequestFromAgent',
    async (_e, raw: unknown): Promise<TaskRequestPullRequestFromAgentResult> => {
      const parsed = parseTaskRequestPullRequestFromAgentPayload(raw);
      if (!parsed.ok) {
        return { ok: false, code: 'NO_PROJECT', message: parsed.message };
      }
      const { taskId, title: payloadTitle } = parsed.payload;
      const rootPath = worktreeService.getRootPath();
      if (!rootPath) {
        return { ok: false, code: 'NO_PROJECT', message: 'No git project open' };
      }
      const project = projectStore.get();
      const taskRow = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      let title = (payloadTitle ?? '').trim();
      if (taskRow) {
        if (!title) title = taskRow.title.trim();
      }
      const mergedTaskFields = mergeTaskRowWithPullRequestAgentPayload(taskRow, parsed.payload);
      if (!title) {
        return {
          ok: false,
          code: 'TASK_METADATA_REQUIRED',
          message: 'Task title is required (open a local task or pass title in the payload)',
        };
      }

      const sessions = await daemonClient.listSessions();
      const session = pickSessionForTaskWorktree(
        sessions,
        taskId,
        mergedTaskFields.repoId?.trim() || undefined,
      );
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

      const repos = project ? await projectStore.getReposAt(activeProjectDir()) : [];
      const primaryRepoId = resolvePrimaryRepoId(repos) ?? '';
      const repoDefaultBranch = await resolveProjectRepoDefaultBranchShort({
        projectStore,
        activeProjectDir,
        rootPath,
        repoId: effectiveTaskRepoId(mergedTaskFields, primaryRepoId),
      });
      const { baseBranch, headBranch } = resolveAgentPullRequestBranchContext({
        task: mergedTaskFields,
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
      const repoCfg = resolveRepoForBranchDiscovery(repos, mergedTaskFields.repoId);
      const payload = buildTaskAgentPullRequestPrompt({
        taskId,
        taskTitle: title,
        headBranch,
        baseBranch,
        instructionsAbsolutePath: instructionsPath,
        repoDisplayLabel: repoCfg ? repoDisplayLabel(repoCfg) : undefined,
        repoRootPath: repoCfg?.rootPath,
      });
      // Bracketed paste + submit must be **two awaited daemon writes**. Reasons:
      // - One chunk ending in `\x1b[201~\r` often leaves multiline text in the
      //   agent input without submitting (Cursor agent CLI; others).
      // - `daemonClient.writeSession` is fire-and-forget; a lone `\r` after paste
      //   can be dropped or reordered relative to PTY consumption without await.
      // - Paste must not go through `sendTaskSessionTerminalInput` alone: the
      //   prompt body contains `\n`, which would trigger false "submit" side effects.
      const pasteInput = wrapAsXtermBracketedPaste(payload);
      const submitInput = '\r';
      if (isSessionInputDebugEnabled()) {
        const tid = sessionTaskMap.get(session.id) ?? session.taskId;
        console.log('[session:input]', {
          sessionId: session.id,
          taskId: tid,
          codeUnits: pasteInput.length,
          repr: describeSessionInputForLog(pasteInput),
        });
        console.log('[session:input]', {
          sessionId: session.id,
          taskId: tid,
          codeUnits: submitInput.length,
          repr: describeSessionInputForLog(submitInput),
        });
      }
      await daemonClient.writeSessionAwait(session.id, pasteInput);
      await daemonClient.writeSessionAwait(session.id, submitInput);
      applyTaskSessionSubmitSideEffects(session.id);
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
      const project = projectStore.get();
      const row = project ? taskStore.getAll(project.id).find((t) => t.id === taskId) : undefined;
      const worktreePath = await resolveTaskWorktreePath(
        taskId,
        () => daemonClient.listSessions(),
        projectDir,
        row?.repoId,
        row?.fluxWorkBranch,
      );
      const repos = await projectStore.getReposAt(projectDir);
      const resolvedPaths = await resolveGithubPrGitOperationPaths({
        repos,
        taskRepoId: row?.repoId,
        worktreePath,
      });
      if (!resolvedPaths.ok) {
        return resolvedPaths;
      }
      const { ghCwd, gitRootPath } = resolvedPaths;

      let prUrl = '';
      const fromPayload =
        o.githubPr && typeof o.githubPr === 'object' && typeof (o.githubPr as TaskGithubPr).url === 'string'
          ? String((o.githubPr as TaskGithubPr).url).trim()
          : '';
      if (fromPayload) prUrl = fromPayload;
      if (!prUrl && project) {
        prUrl = row?.githubPr?.url?.trim() ?? '';
      }
      const viewed = prUrl
        ? await ghPrViewJson(ghCwd, prUrl)
        : worktreePath
          ? await discoverGithubPrForTaskWorktree(worktreePath)
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

      const origin = await readOriginRemote(gitRootPath);
      if (!origin.ok) return origin;
      const mismatch = validateGithubPrMatchesTaskRemote(viewed.githubPr.url, origin.url);
      if (mismatch) return mismatch;

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
              task: rowForAuto,
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
    const primaryPath = primaryRootPathFromCloudBinding(activeKey.id, binding);
    if (!primaryPath) throw new Error('Cloud project is not bound to a local folder');
    return hydrateCloudProject(
      {
        id: activeKey.id,
        name: path.basename(primaryPath),
        ownerId: '',
        memberIds: [],
        createdAt: '',
      },
      binding,
    );
  }

  function parseResolveTaskWorktreePayload(raw: unknown): {
    taskId: string;
    repoId?: string | null;
    fluxWorkBranch?: string | null;
  } {
    if (typeof raw === 'string') {
      return { taskId: raw.trim() };
    }
    if (raw && typeof raw === 'object' && typeof (raw as { taskId?: unknown }).taskId === 'string') {
      const o = raw as { taskId: string; repoId?: unknown; fluxWorkBranch?: unknown };
      const repoId = o.repoId;
      const fluxRaw = o.fluxWorkBranch;
      return {
        taskId: o.taskId.trim(),
        repoId: typeof repoId === 'string' || repoId === null ? repoId : undefined,
        fluxWorkBranch:
          typeof fluxRaw === 'string' ? fluxRaw.trim() : fluxRaw === null ? null : undefined,
      };
    }
    return { taskId: '' };
  }

  async function detailWhenResolveFailed(
    repoId: string | null | undefined,
    projectDir: string | null,
  ): Promise<NonNullable<ResolveTaskWorktreeIpcResult['detail']>> {
    if (!projectDir?.trim()) {
      return {
        code: 'no-project-dir',
        message: 'No Flux project directory is open.',
      };
    }
    const rid = repoId?.trim();
    if (!rid) {
      return {
        code: 'no-worktree',
        message:
          "No workspace folder yet. Start this task's agent session to create a worktree.",
      };
    }
    let project: Project;
    try {
      project = await resolveProjectForStart();
    } catch {
      return {
        code: 'no-project-dir',
        message: 'No project is open.',
      };
    }
    const repos = await projectStore.getReposAt(activeProjectDir());
    const repoCfg = resolveRepoForBranchDiscovery(repos, rid);
    if (!repoCfg) {
      return {
        code: 'repo-unknown',
        message:
          'Unknown repository for this task. Choose a repository that exists under Project settings.',
      };
    }
    if (project.kind === 'cloud') {
      const mb = project.repoMachineBindings?.[repoCfg.id];
      if (!mb?.rootPath?.trim()) {
        return {
          code: 'repo-not-bound',
          message: `This machine has no local clone bound for repository "${repoDisplayLabel(repoCfg)}". Bind the repository in Project settings before opening the workspace.`,
        };
      }
    }
    const resolvedClone = path.resolve(repoCfg.rootPath);
    try {
      await fs.access(resolvedClone);
    } catch {
      return {
        code: 'repo-path-missing',
        message: `The repository clone path does not exist: ${resolvedClone}`,
      };
    }
    try {
      await fs.access(path.join(resolvedClone, '.git'));
    } catch {
      return {
        code: 'repo-not-git',
        message: `Expected a Git repository at ${resolvedClone}, but no .git entry was found.`,
      };
    }
    return {
      code: 'no-worktree',
      message:
        "No workspace folder yet. Start this task's agent session to create a worktree.",
    };
  }

  async function gitRootForDaemonSession(session: Session): Promise<string | null> {
    try {
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const cfg = resolveRepoForBranchDiscovery(repos, session.repoId);
      const rp = cfg?.rootPath?.trim();
      if (rp) {
        try {
          await fs.access(path.join(path.resolve(rp), '.git'));
          return path.resolve(rp);
        } catch {
          /* fall through */
        }
      }
    } catch {
      /* fall through */
    }
    const fallback = worktreeService.getRootPath()?.trim();
    return fallback ? path.resolve(fallback) : null;
  }

  /**
   * Resolves {@link RepoConfig} for the clone worktrees and agent sessions use.
   * Validates cloud machine bindings and filesystem paths before session start.
   */
  async function resolveRepoConfigForTaskSession(
    project: Project,
    task: Task,
    projectDir: string,
  ): Promise<RepoConfig> {
    const repos = await projectStore.getReposAt(projectDir);
    const primaryId = resolvePrimaryRepoId(repos);
    if (!primaryId) {
      throw new WorktreeCreateError(
        'WORKTREE_REPO_INVALID_STATE',
        'No repository is configured for this project.',
      );
    }

    const discoveryKey = task.repoId;
    const repoCfg = resolveRepoForBranchDiscovery(repos, discoveryKey);

    if (!repoCfg) {
      const rid = discoveryKey?.trim();
      throw new WorktreeCreateError(
        'WORKTREE_REPO_UNKNOWN',
        rid
          ? `Unknown repository "${rid}" on this project. Pick a repository that exists under Project settings.`
          : 'No repository root configured for this project.',
      );
    }

    if (project.kind === 'cloud') {
      const mb = project.repoMachineBindings?.[repoCfg.id];
      if (!mb?.rootPath?.trim()) {
        throw new WorktreeCreateError(
          'WORKTREE_REPO_NOT_BOUND',
          `This machine has no local clone bound for repository "${repoDisplayLabel(repoCfg)}". Bind the repository before starting a task.`,
        );
      }
    }

    const resolvedClone = path.resolve(repoCfg.rootPath);
    try {
      await fs.access(resolvedClone);
    } catch {
      throw new WorktreeCreateError(
        'WORKTREE_REPO_PATH_MISSING',
        `The repository clone path does not exist: ${resolvedClone}`,
      );
    }
    try {
      await fs.access(path.join(resolvedClone, '.git'));
    } catch {
      throw new WorktreeCreateError(
        'WORKTREE_REPO_NOT_GIT',
        `Expected a Git repository at ${resolvedClone}, but no .git entry was found.`,
      );
    }

    return repoCfg;
  }

  async function worktreeSourceOptsForTaskSession(
    task: Task,
    repoCfg: RepoConfig,
  ): Promise<{ sourceBranchShort: string; createSourceBranchIfMissing: boolean }> {
    const discovery = await collectRepoBranchDiscovery(
      repoCfg.rootPath,
      repoCfg.baseBranch,
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
      let sessionRepoCfg: RepoConfig | null = null;
      try {
        const projectDir = activeProjectDir();
        sessionRepoCfg = await resolveRepoConfigForTaskSession(project, merged, projectDir);
        const sourceOpts = await worktreeSourceOptsForTaskSession(merged, sessionRepoCfg);
        const layout = 'repo-scoped' as const;
        const created = await worktreeService.create({
          task: {
            id: merged.id,
            title: merged.title,
            fluxWorkBranch: merged.fluxWorkBranch,
          },
          repo: {
            repoId: sessionRepoCfg.id,
            gitRootPath: sessionRepoCfg.rootPath,
            baseBranch: sessionRepoCfg.baseBranch,
            setupScript: sessionRepoCfg.setupScript,
            env: sessionRepoCfg.env,
          },
          source: sourceOpts,
          layout,
        });
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

      if (!sessionRepoCfg) {
        return finish({
          error: 'INTERNAL',
          message: 'Session start did not resolve a repository configuration.',
        });
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
      const projectDirForTrust = activeProjectDir();
      const trustRoots = projectDirForTrust
        ? trustPromptAutorespondRootsForProject(projectDirForTrust)
        : [];
      const trustAutorespondArg =
        project.autoRespondToTrustPrompts === true &&
        cwdUnderTrustPromptAutorespondRoots(worktreePath, trustRoots)
          ? { trustPromptAutorespond: true as const, trustPromptAutorespondRoots: trustRoots }
          : {};

      const result = await daemonClient.createSession({
        worktreePath,
        branch,
        taskId: task.id,
        projectId: project.id,
        repoId: sessionRepoCfg.id,
        agent: merged.agent,
        command,
        args,
        cols: 80,
        rows: 24,
        ...trustAutorespondArg,
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
          await worktreeService.remove(
            worktreePath,
            path.resolve(sessionRepoCfg.rootPath),
          );
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
      const priorFw = (merged.fluxWorkBranch ?? '').trim();
      if (priorFw !== branch) {
        if (project.kind === 'local') {
          const p = projectStore.get();
          if (p && taskStore.getAll(p.id).some((t) => t.id === task.id)) {
            try {
              await taskStore.update(task.id, { fluxWorkBranch: branch });
              broadcastLocalTasksChanged();
            } catch (err) {
              console.warn('[session:start] failed to persist fluxWorkBranch', err);
            }
          }
        } else if (project.kind === 'cloud') {
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            win.webContents.send('task:persistFluxWorkBranch', {
              taskId: task.id,
              fluxWorkBranch: branch,
            });
          }
        }
      }
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
      | 'sourceBranch'
      | 'createSourceBranchIfMissing'
      | 'repoId'
      | 'fluxWorkBranch'
    >
  > & {
    githubPr?: TaskGithubPr | null;
    /** `null` clears stored attachments. */
    attachedPlanningDocs?: TaskAttachedPlanningDoc[] | null;
    /** `null` clears stored value (inherit project default for when-unblocked). */
    autoStartOnUnblock?: boolean | null;
  };

  const unblockAutostartInFlight = new Set<string>();

  async function maybeAutoStartSessionOnInProgressTransition(
    previous: Task,
    updated: Task,
    source: string,
    options?: { skipInProgressAutostart?: boolean },
  ): Promise<void> {
    if (options?.skipInProgressAutostart) return;
    const backlogToInProgress =
      previous.status === 'backlog' && updated.status === 'in-progress';
    if (!backlogToInProgress) return;

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
      if (patchToApply.repoId !== undefined) {
        const vrBranchRepo = validateTaskRepoIdPatchValue(repos, patchToApply.repoId);
        if (!vrBranchRepo.ok) {
          throw new Error(vrBranchRepo.message);
        }
      }
      const repoIdForDiscovery =
        patchToApply.repoId !== undefined
          ? nextPersistedRepoIdAfterPatch(previous.repoId, patchToApply.repoId)
          : previous.repoId;
      const repoCfg = resolveRepoForBranchDiscovery(repos, repoIdForDiscovery);
      if (!repoCfg?.rootPath) {
        throw new Error(
          repoIdForDiscovery != null && String(repoIdForDiscovery).trim() !== ''
            ? 'Unknown repository id for this project'
            : 'No repository root configured for this project',
        );
      }
      const discovery = await collectRepoBranchDiscovery(repoCfg.rootPath, repoCfg.baseBranch);
      if (taskSourceBranchSettingsWouldChange(previous, patchToApply, discovery.defaultBranchShort)) {
        if (previous.githubPr?.url?.trim()) {
          throw new Error(
            'Cannot change this task\'s source branch while a GitHub pull request is linked. Clear the pull request metadata on the task first.',
          );
        }
        const repoGitRootsSourcePatch = [...new Set(repos.map((r) => path.resolve(r.rootPath)))];
        const locked = await taskHasBlockingWorkspaceState({
          taskId: id,
          fluxWorkBranch: previous.fluxWorkBranch,
          repoId: previous.repoId,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsSourcePatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxWorkBranchForTask(previous);
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

    if (patchToApply.repoId !== undefined) {
      const projectDir = activeProjectDir();
      const repos = await projectStore.getReposAt(projectDir);
      const vr = validateTaskRepoIdPatchValue(repos, patchToApply.repoId);
      if (!vr.ok) {
        throw new Error(vr.message);
      }
      const nextRepoId = nextPersistedRepoIdAfterPatch(previous.repoId, patchToApply.repoId);
      if (!persistedRepoIdsEqual(previous.repoId, nextRepoId)) {
        if (previous.githubPr?.url?.trim()) {
          throw new Error(
            'Cannot change this task\'s repository while a GitHub pull request is linked. Clear the pull request metadata on the task first, then you can change the repository.',
          );
        }
        const repoGitRootsPersistPatch = [...new Set(repos.map((r) => path.resolve(r.rootPath)))];
        const locked = await taskHasBlockingWorkspaceState({
          taskId: id,
          fluxWorkBranch: previous.fluxWorkBranch,
          repoId: previous.repoId,
          listSessions: () => daemonClient.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsPersistPatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxWorkBranchForTask(previous);
          throw new Error(
            `Cannot change this task's repository while a Flux workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
          );
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
        const cleanupRepos = await projectStore.getReposAt(activeProjectDir());
        const errors = await teardownEphemeralResourcesForTask(
          daemonClient,
          worktreeService,
          id,
          cleanupRepos,
          updated.repoId?.trim() ?? null,
          updated.fluxWorkBranch?.trim() ?? null,
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
    await deleteSessionWorkspaceAndStop(
      daemonClient,
      worktreeService,
      sessionId,
      gitRootForDaemonSession,
    );
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
        let binding = bindingStore.get(activeKey.id);
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
        binding = bindingStore.get(activeKey.id);
        if (!binding) {
          return { error: 'No project open' };
        }
        const primaryPath = primaryRootPathFromCloudBinding(activeKey.id, binding);
        if (!primaryPath) {
          return { error: 'No project open' };
        }
        project = hydrateCloudProject(
          {
            id: activeKey.id,
            name: path.basename(primaryPath),
            ownerId: '',
            memberIds: [],
            createdAt: '',
          },
          binding,
        );
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
      const trustRoots = trustPromptAutorespondRootsForProject(projectDir);
      const trustAutorespondArg =
        project.autoRespondToTrustPrompts === true &&
        cwdUnderTrustPromptAutorespondRoots(planningDir, trustRoots)
          ? { trustPromptAutorespond: true as const, trustPromptAutorespondRoots: trustRoots }
          : {};

      const result = await daemonClient.startPlanning({
        projectId: project.id,
        agent: planningAgent,
        planningDir,
        command,
        args,
        cols: 220,
        rows: 50,
        ...trustAutorespondArg,
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

  const planningDocsBundle = createPlanningDocsProviderBundle(resolvePlanningDocsDir);

  function activePlanningDocsProvider(): PlanningDocsProvider {
    return planningDocsProviderForActiveProject(appStateStore.get().activeProjectKey, planningDocsBundle);
  }

  ipcMain.handle('planningDocs:list', async () => {
    const result = await activePlanningDocsProvider().list();
    const key = appStateStore.get().activeProjectKey;
    const planningDir = resolvePlanningDocsDir();
    const enriched =
      planningDir && key?.kind === 'cloud' && 'files' in result
        ? await enrichPlanningDocsListForCloudWorkspace(planningDir, key.id, result)
        : result;
    planningDocsWatcher?.sync();
    return enriched;
  });

  ipcMain.handle(
    'planningDocs:read',
    async (
      _e,
      relativePath: string,
    ): Promise<{ content: string } | { error: string }> => {
      return activePlanningDocsProvider().read(relativePath);
    },
  );

  ipcMain.handle(
    'planningDocs:write',
    async (_e, relativePath: unknown, content: unknown): Promise<PlanningDocsWriteResult> => {
      if (typeof relativePath !== 'string' || typeof content !== 'string') {
        return { error: 'INVALID_CONTENT' };
      }
      const result = await activePlanningDocsProvider().write(relativePath, content);
      if ('ok' in result && result.ok) {
        notifyPlanningDocsChanged();
        planningDocsWatcher?.sync();
      }
      return result;
    },
  );

  ipcMain.handle('planningDocs:cloudMigration:getState', async (_e, cloudProjectId: string) => {
    const key = appStateStore.get().activeProjectKey;
    if (!key || key.kind !== 'cloud' || key.id !== cloudProjectId) {
      return { error: 'NOT_ACTIVE_CLOUD' as const };
    }
    const dir = resolvePlanningDocsDir();
    if (!dir) return { error: 'NO_PLANNING_DIR' as const };
    const state = await readPlanningDocsCloudMigrationState(dir, cloudProjectId);
    return { state };
  });

  ipcMain.handle(
    'planningDocs:cloudMigration:patchState',
    async (
      _e,
      cloudProjectId: string,
      patch: Partial<
        Pick<
          PlanningDocsCloudMigrationPersistedV1,
          'didInitialHydrateFromCloud' | 'seedOfferResolved'
        >
      >,
    ) => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== cloudProjectId) {
        return { error: 'NOT_ACTIVE_CLOUD' as const };
      }
      const dir = resolvePlanningDocsDir();
      if (!dir) return { error: 'NO_PLANNING_DIR' as const };
      const state = await patchPlanningDocsCloudMigrationState(dir, cloudProjectId, patch);
      return { ok: true as const, state };
    },
  );

  ipcMain.handle(
    'planningDocs:cloudMigration:applyHydration',
    async (_e, payload: { cloudProjectId: string; plan: FirestoreHydrationWritePlan }) => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== payload.cloudProjectId) {
        return { error: 'Active cloud project mismatch.' };
      }
      const dir = resolvePlanningDocsDir();
      if (!dir) return { error: 'No planning directory.' };
      planningDocsWatcher?.suppressFsNotifications(600);
      const result = await applyPlanningDocsFirestoreHydrationPlan(dir, payload.plan);
      if ('error' in result) return result;
      notifyPlanningDocsChanged();
      planningDocsWatcher?.sync();
      return { ok: true as const };
    },
  );

  ipcMain.handle(
    'planningDocs:applyFirestoreSnapshot',
    async (_e, payload: unknown): Promise<PlanningDocsApplyFirestoreSnapshotResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!payload || typeof payload !== 'object') {
        return { ok: false, code: 'INVALID_PAYLOAD' };
      }
      const projectId = (payload as { projectId?: unknown }).projectId;
      if (typeof projectId !== 'string') {
        return { ok: false, code: 'INVALID_PAYLOAD' };
      }
      if (key?.kind !== 'cloud' || key.id !== projectId) {
        return { ok: false, code: 'PROJECT_MISMATCH' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) {
        return { ok: false, code: 'NO_PROJECT' };
      }
      planningDocsWatcher?.suppressFsNotifications(600);
      const applied = await applyFirestorePlanningDocsSnapshot(planningDir, payload);
      if (!applied.ok) {
        return { ok: false, code: 'INVALID_PAYLOAD' };
      }
      if (applied.changed) {
        notifyPlanningDocsChanged();
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    'planningDocs:listPushCandidates',
    async (_e, projectId: string): Promise<PlanningDocsListPushCandidatesResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== projectId) {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      const candidates = await listPlanningDocsPushCandidates(planningDir, projectId);
      return { ok: true, candidates };
    },
  );

  ipcMain.handle(
    'planningDocs:recordPushSuccess',
    async (_e, payload: PlanningDocsRecordPushSuccessPayload): Promise<PlanningDocsRecordPushSuccessResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== payload.projectId) {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const norm = normalizePlanningDocRelativePath(payload.relativePath);
      if (!norm) return { ok: false, code: 'INVALID_PATH' };
      if (typeof payload.contentSha256 !== 'string' || typeof payload.newRemoteRevision !== 'string') {
        return { ok: false, code: 'INVALID_PATH' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      await recordPlanningDocsPushSuccess(planningDir, norm, payload.contentSha256, payload.newRemoteRevision);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'planningDocs:persistConflict',
    async (_e, payload: PlanningDocsPersistConflictPayload) => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== payload.projectId) {
        return { ok: false as const, code: 'NOT_ACTIVE_CLOUD' };
      }
      const rec = payload.record as PlanningDocsConflictRecordV1;
      if (
        !rec ||
        rec.schemaVersion !== 1 ||
        typeof rec.relativePath !== 'string' ||
        typeof rec.createdAt !== 'string' ||
        !(rec.baseRemoteRevision === null || typeof rec.baseRemoteRevision === 'string') ||
        typeof rec.localMarkdown !== 'string' ||
        typeof rec.remoteMarkdown !== 'string' ||
        typeof rec.remoteRevision !== 'string' ||
        typeof rec.remoteUpdatedBy !== 'string' ||
        typeof rec.localUpdatedBy !== 'string'
      ) {
        return { ok: false as const, code: 'INVALID_RECORD' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false as const, code: 'NO_PLANNING_DIR' };
      const conflictFileBasename = await persistPlanningDocsConflictLocal(planningDir, rec);
      return { ok: true as const, conflictFileBasename };
    },
  );

  ipcMain.handle(
    'planningDocs:resolveConflict',
    async (_e, payload: unknown): Promise<PlanningDocsResolveConflictIpcResult> => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false, code: 'INVALID_PAYLOAD' };
      }
      const p = payload as Partial<PlanningDocsResolveConflictPayload>;
      if (
        typeof p.projectId !== 'string' ||
        typeof p.relativePath !== 'string' ||
        (p.action !== 'take_remote' && p.action !== 'resume_push' && p.action !== 'mark_merged')
      ) {
        return { ok: false, code: 'INVALID_PAYLOAD' };
      }
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== p.projectId) {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      planningDocsWatcher?.suppressFsNotifications(600);
      let inner: { ok: true } | { ok: false; code: 'INVALID_PATH' | 'NO_RECORD' | 'WRITE_FAILED' };
      if (p.action === 'take_remote') {
        inner = await resolvePlanningDocConflictTakeRemote(
          planningDir,
          p.relativePath,
          typeof p.conflictArtifactBasename === 'string' ? p.conflictArtifactBasename : undefined,
        );
      } else if (p.action === 'resume_push') {
        inner = await resolvePlanningDocConflictResumePush(planningDir, p.relativePath);
      } else {
        inner = await resolvePlanningDocConflictMarkMerged(
          planningDir,
          p.relativePath,
          typeof p.conflictArtifactBasename === 'string' ? p.conflictArtifactBasename : undefined,
        );
      }
      if (inner.ok) {
        notifyPlanningDocsChanged();
        planningDocsWatcher?.sync();
      }
      return inner.ok ? { ok: true } : { ok: false, code: inner.code };
    },
  );

  ipcMain.handle(
    'planningDocs:revealSyncFolder',
    async (): Promise<PlanningDocsRevealSyncFolderResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud') {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      const folder = planningDocsSyncFolderAbs(planningDir);
      try {
        await fs.mkdir(folder, { recursive: true });
      } catch {
        return { ok: false, code: 'OPEN_FAILED', message: 'Could not create sync folder.' };
      }
      const err = await shell.openPath(folder);
      if (err) {
        return { ok: false, code: 'OPEN_FAILED', message: err };
      }
      return { ok: true };
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
