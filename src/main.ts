import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore, ensurePlanningAssistantMarkdownFiles } from './main/ProjectStore';
import {
  VALIDATION_DISABLED_CODE,
  VALIDATION_DISABLED_MESSAGE,
} from './validation/validationEnabled';
import {
  getPlanningInitStatus,
  planningDocsAreInitialized,
  setPlanningInitStatus,
  shouldShowPlanningInitCallout,
  writeOnboardingPending,
} from './main/projectOnboarding';
import {
  normalizeProjectCreateInput,
  validateLocalProjectCreateInput,
  type ProjectCreateInput,
  type ProjectCreateResult,
  type ProjectCreateWizardPayload,
} from './projectCreate';
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
import { AutomationHttpServer } from './main/AutomationHttpServer';
import {
  invokeFluxAutomationRequest,
  type FluxAutomationHostDeps,
} from './main/fluxAutomationHost';
import { RendererAutomationBridge } from './main/RendererAutomationBridge';
import {
  fluxAutomationPtyEnv,
  newFluxAutomationToken,
  resolveFluxCliBinDir,
  writeFluxCliBridgeConfig,
} from './main/fluxAutomationBridge';
import { AppStateStore } from './main/AppStateStore';
import { repoConfigsFromCloudSharedAndBinding } from './cloudRepoDiskSync';
import { parseFirestoreRepos } from './cloudFirestoreRepoParse';
import { isCloudShellRootPath } from './cloudProjectActivation';
import { hydrateCloudProject } from './cloudBindingPrefs';
import {
  migrateLegacyCloudBinding,
  primaryRootPathFromCloudBinding,
} from './cloudLocalBindingMigration';
import { canonicalCloudProjectDir } from './main/projectDirLayout';
import { LocalBindingStore } from './main/LocalBindingStore';
import {
  bindingEnvFilesForRepo,
  detectAndPersistRepoEnvFiles,
  detectRepoEnvFilesForSettings,
  envFilesWithEnablement,
  persistRepoEnvFilesForCloudBinding,
  persistRepoEnvFilesForLocalProject,
} from './main/repoEnvFileSettings';
import { isRepoEnvFileName } from './repoEnvFiles';
import { DeviceStore } from './main/DeviceStore';
import { DeviceProbeService } from './main/ssh/DeviceProbeService';
import { GitRemoteWorkspaceProvider } from './main/ssh/GitRemoteWorkspaceProvider';
import { RemoteHelperClient } from './main/ssh/RemoteHelperClient';
import {
  formatRemoteSshReconcileLogLine,
  reconcileRemoteSshTerminalsForProject,
} from './main/ssh/remoteSshTerminalReconcile';
import { mapRemoteLifecycleToEndedReason } from './main/ssh/remoteSessionLifecycle';
import { startSshTaskSession } from './main/ssh/startSshTaskSession';
import { RemoteRepoBindingService } from './main/ssh/RemoteRepoBindingService';
import { resolveRemoteRepoForTaskSession } from './main/ssh/resolveRemoteRepoForTask';
import { syncRemoteSshTaskToLocal } from './main/ssh/remoteSshBranchSync';
import { resolveSshLocalWorktreePath, readRemoteSshSyncMetadata } from './main/ssh/remoteSshSyncMetadata';
import {
  type ExecutionDeviceHostContext,
  inferLegacyLocalTmuxForDeviceBootstrap,
  parseAndValidateExecutionDeviceInput,
  resolveDefaultExecutionDeviceForNewTaskInContext,
  resolveEffectiveExecutionDeviceForTaskInContext,
  validateExecutionDeviceRefForStore,
} from './main/executionDeviceContext';
import type { TaskExecutionDeviceRef } from './types';
import { ensureFluxxBaseDirMigrated } from './main/fluxxBaseDir';
import { WorktreeService } from './main/WorktreeService';
import {
  cwdUnderTrustPromptAutorespondRoots,
  trustPromptAutorespondRootsForProject,
} from './main/trustPromptAutorespondRoots';
import { removeFluxxOwnedLocalState } from './main/projectFluxxRemoval';
import {
  buildPickerLastOpenedAtMap,
  touchPickerProjectLastOpened,
} from './main/projectPickerLastOpened';
import {
  createMainTerminalBackend,
  localTerminalBackendFrom,
  sshTerminalBackendFrom,
} from './main/terminalBackend/createMainTerminalBackend';
import type { TerminalBackend } from './main/terminalBackend/TerminalBackend';
import { applyShellEnvToProcess } from './main/userShellEnv';
import {
  deleteSessionWorkspaceAndStop,
  listEnabledSshDevices,
  teardownEphemeralResourcesForTask,
} from './main/taskEphemeralTeardown';
import {
  agentNotFoundMessage,
  agentSpawnResumeSpec,
  agentSpawnSpec,
  planningSpawnResumeSpec,
  planningSpawnSpec,
} from './main/agentSpawn';
import {
  mergePlanningSessionsWithColdResume,
  mergeTaskSessionsWithColdResume,
  parsePlanningStartPayload,
} from './main/planningColdRestore';
import {
  addProjectMcpServersText,
  ensureProjectMcpConfig,
  materializeCursorMcpConfig,
  writeProjectMcpConfigText,
} from './main/mcpConfig';
import {
  appendConversationParseBuffer,
  parseAgentConversationId,
} from './main/agentConversationIdParse';
import { PlanningAgentSessionRecordStore } from './main/planningAgentSessionRecords';
import { TaskAgentSessionRecordStore } from './main/taskAgentSessionRecords';
import { ValidationRunStore } from './main/ValidationRunStore';
import {
  openValidationArtifactExternally,
  readValidationArtifactForUi,
  readValidationVerdictForUi,
} from './main/validationArtifactIpc';
import {
  getValidationPackById,
  listValidationPacks,
} from './validationPacks/registry';
import { loadValidationPacksProjectConfig } from './validationPacks/projectConfig';
import { resolveValidationPackInstructions } from './validationPacks/buildInstructions';
import type {
  ValidationArtifactRegisterInput,
  ValidationRunCreateInput,
  ValidationRunStatusUpdate,
} from './validationRuns/types';
import { TerminalSessionRecordStore } from './main/terminalSessionRecords';
import { buildTerminalInventorySnapshot } from './main/terminalInventory';
import { probeTmuxAvailability, tmuxUnavailableSaveError } from './main/tmuxAvailability';
import { isAuxDevInstance } from './main/auxDevInstance';
import { resolveFluxxTmuxSpawnLauncherPath } from './main/tmux/resolveFluxxTmuxSpawnLauncherPath';
import { formatTmuxReconcileLogLine } from './main/tmux/tmuxTerminalReconcile';
import { withTerminalRuntimeMeta } from './main/terminalSessionRecordFromRuntime';
import type { TerminalRuntimeContext } from './main/TerminalRuntimeManager';
import { composeTaskSessionInitialPrompt } from './main/composeTaskSessionInitialPrompt';
import { createValidatorSessionLauncher } from './main/validatorSessionMain';
import {
  buildValidationTransitionHooks,
  handleValidationRunFinalized,
  type ValidationTransitionHooks,
} from './main/validationTransitionHooks';
import { broadcastValidationRunChanged } from './main/broadcastValidationRunChanged';
import { reconcileActiveValidationRunsForTask } from './main/reconcileValidationRun';
import {
  completeValidatorSessionOnExit,
  cancelValidatorSession,
} from './main/startValidatorSession';
import {
  computeSessionExitTransition,
  getValidatorSessionBinding,
  hydrateValidatorSessionBindings,
  isValidatorSessionId,
} from './main/validatorSessionLifecycle';
import { resolvePlanningDocsDirFromSources } from './planningDocs/resolvePlanningDocsDir';
import { listCursorAgentModels } from './main/listCursorAgentModels';
import { openWorkspacePath, pickSessionForTaskWorktree, resolveTaskWorktreePath } from './main/openWorkspacePath';
import {
  discoverGithubPrForTaskWorktree,
  ghPrViewJson,
  prMetadataRefMismatchWarning,
  readGhCanonicalOwnerRepo,
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
  installFluxxDeepLinkEventHandlers,
  registerFluxxProtocolClient,
} from './main/fluxxDeepLink';
import {
  createPlanningDocsWatcher,
  notifyPlanningDocsChanged,
} from './main/PlanningDocsWatcher';
import {
  applyFirestorePlanningDocsSnapshot,
  persistPlanningDocsConflictLocal,
  recordPlanningDocsDeleteSuccess,
  recordPlanningDocsPushSuccess,
} from './main/planningDocsFirestoreHydrate';
import {
  listPlanningDocsDeleteCandidates,
  listPlanningDocsPushCandidates,
} from './main/planningDocsFirestorePush';
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
  PlanningDocsListDeleteCandidatesResult,
  PlanningDocsListPushCandidatesResult,
  PlanningDocsPersistConflictPayload,
  PlanningDocsRecordDeleteSuccessPayload,
  PlanningDocsRecordDeleteSuccessResult,
  PlanningDocsRecordPushSuccessPayload,
  PlanningDocsRecordPushSuccessResult,
  PlanningDocsResolveConflictIpcResult,
  PlanningDocsResolveConflictPayload,
  PlanningDocsRevealSyncFolderResult,
} from './planningDocs/syncTypes';
import type {
  PlanningDocsCloudMigrationPersistedV1,
  PlanningDocsDeleteResult,
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
  RemoteRepoBindingsOverview,
  ProjectTabState,
  RestorableSessionIds,
  LocalProject,
  Project,
  RepoBranchDiscovery,
  RepoBranchDiscoveryRequest,
  RepoBranchDiscoveryResponse,
  RepoConfig,
  RepoEnvFileDetectionResult,
  RepoEnvFileEnablement,
  RepoManagementState,
  RepoSettingsPatch,
  Session,
  SessionStartOptions,
  SessionStartResult,
  Task,
  TaskStatus,
  PlanningAgentSessionRecord,
  PlanningSession,
  Shell,
  TaskAgentSessionRecord,
  TerminalEndedReason,
  TerminalInventorySnapshot,
  TerminalSessionRecord,
  TmuxAvailability,
  TaskAttachedPlanningDoc,
  TaskGithubPr,
  TaskPullRequestIpcResult,
  TaskRequestPullRequestFromAgentResult,
  ResolveTaskWorktreeIpcResult,
  SshReconcileDeviceFailureNotice,
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
import { registerTaskAutoTransitionNotificationIpc } from './main/registerTaskAutoTransitionNotificationIpc';
import {
  applyInitialAppearanceChrome,
  registerAppearanceIpc,
} from './main/registerAppearanceIpc';
import {
  attachWindowFullscreenListeners,
  registerWindowChromeIpc,
} from './main/registerWindowChromeIpc';
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  resolveAppearanceWithSystemDark,
  windowBackgroundForAppearance,
} from './theme/appearance';
import { installMacApplicationMenu } from './main/macApplicationMenu';
import { expectedFluxxWorkBranchForTask } from './main/fluxxTaskBranch';
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
import type { AgentState, AttachResult, PlanningAttachResult } from './terminal-runtime/protocol';

function isPlanningAgent(value: unknown): value is Agent {
  return value === 'claude-code' || value === 'codex' || value === 'cursor';
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
    if (typeof pm.codex === 'string') {
      next.codex = pm.codex;
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
    if (typeof tm.codex === 'string') {
      next.codex = tm.codex;
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  registerFluxxProtocolClient();
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
  fluxxBaseDir: string;
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

/** PNG copied next to `main.js` by `vite.main.config.ts` for dev + packaged builds. */
function resolveWindowIconPath(): string | undefined {
  const nextToMain = path.join(__dirname, 'app-icon.png');
  if (existsSync(nextToMain)) return nextToMain;
  const dev = path.resolve(process.cwd(), '.vite/build/app-icon.png');
  if (existsSync(dev)) return dev;
  return undefined;
}

let mainWindow: BrowserWindow | null = null;
let appStateStoreForAppearance: AppStateStore | null = null;

if (gotSingleInstanceLock) {
  installFluxxDeepLinkEventHandlers(() => mainWindow);
}

let fluxAutomationServer: AutomationHttpServer | null = null;
let fluxAutomationHostDeps: FluxAutomationHostDeps | null = null;
let fluxAutomationToken: string | null = null;
let fluxAutomationRendererBridge: RendererAutomationBridge | null = null;

let planningDocsWatcher: ReturnType<typeof createPlanningDocsWatcher> | null = null;

/** Set during `app.whenReady` so quit teardown can stop in-process PTYs. */
let mainProcessTerminalBackend: TerminalBackend | null = null;

/** When true, `before-quit` skips async terminal teardown and allows exit. */
let appQuitTeardownComplete = false;

/** When true, PTY exits during `teardownForAppQuit` are recorded as app-quit (cold resume). */
let terminalQuitTeardownInProgress = false;

/** Session exit hooks enqueue async record writes; `before-quit` awaits these. */
const pendingSessionExitWork = new Set<Promise<void>>();

/** Assigned during `app.whenReady`; used by `before-quit` to flush agent session records. */
let taskAgentSessionRecordStore!: TaskAgentSessionRecordStore;
let planningAgentSessionRecordStore!: PlanningAgentSessionRecordStore;
let validationRunStore!: ValidationRunStore;

const APP_QUIT_TERMINAL_TEARDOWN_MS = 3000;

const createWindow = () => {
  const windowIcon = resolveWindowIconPath();
  const appearancePref =
    appStateStoreForAppearance?.get().appearance ?? DEFAULT_APPEARANCE_PREFERENCE;
  const resolvedAppearance = resolveAppearanceWithSystemDark(
    appearancePref,
    nativeTheme.shouldUseDarkColors,
  );
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Fluxx',
    backgroundColor: windowBackgroundForAppearance(resolvedAppearance),
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

  attachWindowFullscreenListeners(mainWindow);

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

  if (appStateStoreForAppearance && mainWindow) {
    applyInitialAppearanceChrome(appStateStoreForAppearance, mainWindow);
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  const fluxxBaseDir = await ensureFluxxBaseDirMigrated();

  const appStateStore = new AppStateStore();
  await appStateStore.init();
  appStateStoreForAppearance = appStateStore;
  registerAppearanceIpc(appStateStore, () => mainWindow);
  registerWindowChromeIpc(() => mainWindow);
  nativeTheme.on('updated', () => {
    const pref = appStateStore.get().appearance ?? DEFAULT_APPEARANCE_PREFERENCE;
    if (pref !== 'system' || !mainWindow || mainWindow.isDestroyed()) return;
    applyInitialAppearanceChrome(appStateStore, mainWindow);
  });
  const taskAutoTransitionNotify = registerTaskAutoTransitionNotificationIpc(appStateStore);

  const projectStore = new ProjectStore(fluxxBaseDir);
  const taskStore = new TaskStore('');
  await taskStore.init();

  const deviceStore = new DeviceStore();

  const worktreeService = new WorktreeService('', '');
  // Side-effecting `process.env` here means every PTY child inherits the
  // corrected env without per-call wiring. See `src/main/userShellEnv.ts`.
  await applyShellEnvToProcess();

  const terminalBackend = createMainTerminalBackend({
    deviceStore,
    tmuxSpawnLauncherPath: resolveFluxxTmuxSpawnLauncherPath(app.getAppPath(), process.execPath),
  });
  mainProcessTerminalBackend = terminalBackend;
  try {
    await terminalBackend.ensureReady();
  } catch (err) {
    console.error('[main] failed to start terminal backend', err);
  }

  const resolveRecordProjectDir = (): string =>
    worktreeService.getProjectDir()?.trim() || projectStore.getProjectDir()?.trim() || '';
  taskAgentSessionRecordStore = new TaskAgentSessionRecordStore({
    getProjectDir: resolveRecordProjectDir,
  });
  planningAgentSessionRecordStore = new PlanningAgentSessionRecordStore({
    getProjectDir: resolveRecordProjectDir,
  });
  const terminalSessionRecordStore = new TerminalSessionRecordStore({
    getProjectDir: resolveRecordProjectDir,
  });
  validationRunStore = new ValidationRunStore({
    getProjectDir: resolveRecordProjectDir,
  });
  let validationTransitionHooks: ValidationTransitionHooks | null = null;
  let validatorBindingsHydrated = false;

  async function ensureValidatorSessionBindingsHydrated(): Promise<void> {
    if (validatorBindingsHydrated) return;
    try {
      const runs = await validationRunStore.listAll();
      const live = await terminalBackend.listSessions();
      hydrateValidatorSessionBindings(runs, live);
      validatorBindingsHydrated = true;
    } catch (err) {
      console.warn('[validation] hydrate validator session bindings failed', err);
    }
  }

  function annotateValidatorSessionKinds(sessions: Session[]): Session[] {
    return sessions.map((s) =>
      isValidatorSessionId(s.id) ? { ...s, kind: 'validator' as const } : s,
    );
  }

  async function buildTerminalInventorySnapshotForActiveProject(): Promise<TerminalInventorySnapshot> {
    const sessions = await terminalBackend.listSessions();
    const planning = await terminalBackend.listPlanning();
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const shells: Shell[] = [];
    for (const s of sessions) {
      const forSession = await terminalBackend.listShells(s.id);
      shells.push(...forSession);
    }
    const persistedOpen = await terminalSessionRecordStore.listOpenRecords();
    return buildTerminalInventorySnapshot(
      { sessions, planning, shells, sessionById },
      persistedOpen,
      worktreeService.getProjectDir() || null,
    );
  }

  function mapSessionExitToTerminalReason(
    session: Session,
    quitTeardown: boolean,
  ): TerminalEndedReason {
    if (quitTeardown) return 'app-quit';
    return session.status === 'stopped' ? 'agent-exit-ok' : 'agent-exit-error';
  }

  function mapPlanningExitToTerminalReason(
    session: PlanningSession,
    quitTeardown: boolean,
  ): TerminalEndedReason {
    if (quitTeardown) return 'app-quit';
    return session.status === 'stopped' ? 'agent-exit-ok' : 'agent-exit-error';
  }

  function mapShellExitToTerminalReason(
    shell: Shell,
    quitTeardown: boolean,
  ): TerminalEndedReason {
    if (quitTeardown) return 'app-quit';
    return shell.status === 'stopped' ? 'shell-exit-ok' : 'shell-exit-error';
  }
  const conversationParseTails = new Map<string, string>();
  const conversationCaptured = new Set<string>();
  const conversationAgentBySessionId = new Map<string, Agent>();

  function trackSessionExitWork(work: Promise<void>): void {
    pendingSessionExitWork.add(work);
    void work.finally(() => {
      pendingSessionExitWork.delete(work);
    });
  }

  function captureAgentConversationIdFromPty(
    sessionId: string,
    agent: Agent,
    data: string,
    onParsed: (id: string) => void,
  ): void {
    conversationAgentBySessionId.set(sessionId, agent);
    if (conversationCaptured.has(sessionId)) return;
    const prev = conversationParseTails.get(sessionId) ?? '';
    const next = appendConversationParseBuffer(prev, data, 96 * 1024);
    conversationParseTails.set(sessionId, next);
    const parsed = parseAgentConversationId(agent, next);
    if (!parsed) return;
    conversationCaptured.add(sessionId);
    onParsed(parsed);
  }

  async function flushTaskConversationCaptureFromTail(
    sessionId: string,
  ): Promise<string | undefined> {
    if (conversationCaptured.has(sessionId)) return undefined;
    const agent = conversationAgentBySessionId.get(sessionId);
    const tail = conversationParseTails.get(sessionId);
    if (!agent || !tail) return undefined;
    const parsed = parseAgentConversationId(agent, tail);
    if (!parsed) return undefined;
    conversationCaptured.add(sessionId);
    await taskAgentSessionRecordStore.mergeConversationId(sessionId, parsed);
    await terminalSessionRecordStore.mergeTaskConversationId(sessionId, parsed);
    return parsed;
  }

  async function flushPlanningConversationCaptureFromTail(
    sessionId: string,
  ): Promise<string | undefined> {
    if (conversationCaptured.has(sessionId)) return undefined;
    const agent = conversationAgentBySessionId.get(sessionId);
    const tail = conversationParseTails.get(sessionId);
    if (!agent || !tail) return undefined;
    const parsed = parseAgentConversationId(agent, tail);
    if (!parsed) return undefined;
    conversationCaptured.add(sessionId);
    await planningAgentSessionRecordStore.mergeConversationId(sessionId, parsed);
    await terminalSessionRecordStore.mergePlanningConversationId(sessionId, parsed);
    return parsed;
  }

  function scheduleConversationCaptureCleanup(sessionId: string): void {
    setTimeout(() => {
      conversationParseTails.delete(sessionId);
      conversationCaptured.delete(sessionId);
      conversationAgentBySessionId.delete(sessionId);
    }, 250);
  }

  terminalBackend.setSessionPtyDataHook?.((payload) => {
    if (isValidatorSessionId(payload.sessionId)) return;
    captureAgentConversationIdFromPty(payload.sessionId, payload.agent, payload.data, (parsed) => {
      void taskAgentSessionRecordStore.mergeConversationId(payload.sessionId, parsed);
      void terminalSessionRecordStore.mergeTaskConversationId(payload.sessionId, parsed);
    });
  });
  terminalBackend.setPlanningPtyDataHook?.((payload) => {
    captureAgentConversationIdFromPty(payload.sessionId, payload.agent, payload.data, (parsed) => {
      void planningAgentSessionRecordStore.mergeConversationId(payload.sessionId, parsed);
      void terminalSessionRecordStore.mergePlanningConversationId(payload.sessionId, parsed);
    });
  });

  // Map session ID → task ID for silence-based status transitions.
  // Seeded eagerly here; also re-seeded from getSessionSilenceStates() during
  // startup catchup so a listSessions() failure does not silently break catchup.
  const sessionTaskMap = new Map<string, string>();
  try {
    const existing = await terminalBackend.listSessions();
    for (const s of existing) {
      if (s.taskId) sessionTaskMap.set(s.id, s.taskId);
    }
  } catch (err) {
    console.warn('[main] listSessions failed — will re-seed from getSessionSilenceStates()', err);
  }

  async function applyAgentState(sessionId: string, state: AgentState): Promise<void> {
    if (isValidatorSessionId(sessionId)) return;
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
      taskAutoTransitionNotify.dispatch({
        taskTitle: task.title,
        previousStatus: 'in-progress',
        nextStatus: 'needs-input',
        reason: 'agent-silence',
      });
    }
  }

  async function reconcileSilenceStatesFromTerminal(
    states: { id: string; taskId?: string; state: AgentState }[],
    meta?: unknown,
  ): Promise<void> {
    void meta;
    for (const { id, taskId, state } of states) {
      if (taskId && !sessionTaskMap.has(id)) sessionTaskMap.set(id, taskId);
      await applyAgentState(id, state);
    }
  }

  terminalBackend.setSessionLifecycleHooks({
    onAgentState: applyAgentState,
    onSilenceStatesSnapshot: reconcileSilenceStatesFromTerminal,
    onSessionExit: (session) => {
      trackSessionExitWork((async () => {
        const validatorBinding = getValidatorSessionBinding(session.id);
        if (validatorBinding) {
          const finalized = await completeValidatorSessionOnExit(
            { validationRunStore, terminalBackend },
            session,
            validatorBinding.runId,
          );
          await handleValidationRunFinalized(
            finalized,
            validationTransitionHooks,
            'validator:session-exit',
          );
          await terminalSessionRecordStore.markTerminalEnded(session.id, {
            reason: mapSessionExitToTerminalReason(session, terminalQuitTeardownInProgress),
            endedAt: session.stoppedAt,
          });
          scheduleConversationCaptureCleanup(session.id);
          broadcastValidationRunChanged(validatorBinding.runId);
          return;
        }

        const endReason = terminalQuitTeardownInProgress
          ? ('app-quit' as const)
          : session.status === 'stopped'
            ? ('agent-exit-ok' as const)
            : ('agent-exit-error' as const);
        await flushTaskConversationCaptureFromTail(session.id);
        await taskAgentSessionRecordStore.markSessionEnded(session, { reason: endReason });
        await terminalSessionRecordStore.markTerminalEnded(session.id, {
          reason: mapSessionExitToTerminalReason(session, terminalQuitTeardownInProgress),
          endedAt: session.stoppedAt,
        });
        scheduleConversationCaptureCleanup(session.id);

        const taskId = sessionTaskMap.get(session.id) ?? session.taskId;
        if (!taskId) return;

        const project = projectStore.get();
        if (!project) return;

        const transition = computeSessionExitTransition(
          session,
          sessionTaskMap,
          (id) => taskStore.getAll(project.id).find((t) => t.id === id),
        );
        if (transition.action === 'transition') {
          const task = taskStore.getAll(project.id).find((t) => t.id === transition.taskId);
          console.log('[task:status] in-progress → needs-input (agent exited cleanly, local)', {
            taskId: transition.taskId,
          });
          await taskStore.update(transition.taskId, { status: 'needs-input' });
          broadcastLocalTasksChanged();
          if (task) {
            taskAutoTransitionNotify.dispatch({
              taskTitle: task.title,
              previousStatus: 'in-progress',
              nextStatus: 'needs-input',
              reason: 'agent-exited',
            });
          }
        } else if (session.status === 'error') {
          console.warn('[task:status] agent exited with error, not transitioning task', {
            taskId,
            sessionId: session.id,
            reason: transition.reason,
          });
        }
      })());
    },
    onShellExit: (shell) => {
      void terminalSessionRecordStore.markTerminalEnded(shell.id, {
        reason: mapShellExitToTerminalReason(shell, terminalQuitTeardownInProgress),
        endedAt: shell.stoppedAt,
      });
    },
    onPlanningExit: (session) => {
      trackSessionExitWork((async () => {
        const endReason = terminalQuitTeardownInProgress
          ? ('app-quit' as const)
          : session.status === 'stopped'
            ? ('agent-exit-ok' as const)
            : ('agent-exit-error' as const);
        await flushPlanningConversationCaptureFromTail(session.id);
        await planningAgentSessionRecordStore.markSessionEnded(session, { reason: endReason });
        await terminalSessionRecordStore.markTerminalEnded(session.id, {
          reason: mapPlanningExitToTerminalReason(session, terminalQuitTeardownInProgress),
          endedAt: session.stoppedAt,
        });
        scheduleConversationCaptureCleanup(session.id);
      })());
    },
  });
  terminalBackend.startSilenceSnapshotPolling();

  const userData = app.getPath('userData');
  await migrateLegacyProjectsJson({
    userData,
    fluxxBaseDir,
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
        const { projectDir: materialisedDir } = await projectStore.ensureLayoutForLocalProject(
          project,
          lastOpenedProjectDir,
        );
        if (materialisedDir !== lastOpenedProjectDir) {
          await projectStore.init(materialisedDir);
        }
        await taskStore.reinit(materialisedDir);
        await migrateTaskRepoIdsForProject(taskStore, project);
        worktreeService.setRootPath(project.repos[0]?.rootPath ?? project.rootPath);
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
        const { projectDir: materialisedDir } = await projectStore.ensureLayoutForLocalProject(
          project,
          lastOpenedProjectDir,
        );
        if (materialisedDir !== lastOpenedProjectDir) {
          await projectStore.init(materialisedDir);
        }
        await taskStore.reinit(materialisedDir);
        await migrateTaskRepoIdsForProject(taskStore, project);
        worktreeService.setRootPath(project.repos[0]?.rootPath ?? project.rootPath);
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

  await deviceStore.init({
    legacyLocalTmuxEnabled: await inferLegacyLocalTmuxForDeviceBootstrap(
      projectStore,
      bindingStore,
      appStateStore.get().activeProjectKey,
    ),
  });
  const gitRemoteWorkspaceProvider = new GitRemoteWorkspaceProvider();
  const remoteRepoBindingService = new RemoteRepoBindingService(
    bindingStore,
    projectStore,
    deviceStore,
  );
  const remoteHelperClient = new RemoteHelperClient();
  const remoteTaskTeardownDeps = {
    deviceStore,
    gitRemoteWorkspace: gitRemoteWorkspaceProvider,
    bindingStore,
    projectStore,
  };

  function executionDeviceHostContext(): ExecutionDeviceHostContext {
    return {
      deviceStore,
      projectStore,
      bindingStore,
      activeKey: appStateStore.get().activeProjectKey,
    };
  }

  function createDeviceProbeService(): DeviceProbeService {
    return new DeviceProbeService(deviceStore, {
      projectStore,
      bindingStore,
      activeKey: appStateStore.get().activeProjectKey,
      cloudProject: null,
    });
  }

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
    if (!activeRootPath) {
      activeRootPath = path.resolve(
        canonicalCloudProjectDir(fluxxBaseDir, activeProjectKey.id),
      );
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

  async function activeProjectIdForTmuxRestore(): Promise<string | null> {
    const key = appStateStore.get().activeProjectKey;
    if (!key) return null;
    if (key.kind === 'local') {
      return projectStore.get()?.id ?? key.id;
    }
    return key.id;
  }

  async function markTmuxWorkspaceMissingTerminal(record: TerminalSessionRecord): Promise<void> {
    const endedAt = new Date().toISOString();
    await terminalSessionRecordStore.markTerminalEnded(record.id, {
      reason: 'workspace-deleted',
      endedAt,
    });
    if (record.kind === 'task') {
      await taskAgentSessionRecordStore.markWorkspaceDeletedForFluxxSession(record.id);
    } else if (record.kind === 'planning') {
      await planningAgentSessionRecordStore.markSessionEnded(
        {
          id: record.id,
          status: 'stopped',
          startedAt: record.startedAt,
          stoppedAt: endedAt,
        },
        { reason: 'user-archived' },
      );
    }
  }

  async function markTmuxMissingTerminal(record: TerminalSessionRecord): Promise<void> {
    const endedAt = new Date().toISOString();
    await terminalSessionRecordStore.markTerminalEnded(record.id, {
      reason: 'tmux-missing',
      endedAt,
    });

    if (record.kind === 'task' && record.task) {
      if (!(await taskAgentSessionRecordStore.hasFluxxSessionId(record.id))) {
        await taskAgentSessionRecordStore.recordSessionStart({
          fluxxSessionId: record.id,
          taskId: record.task.taskId,
          projectId: record.projectId,
          ...(record.repoId != null && record.repoId.length > 0 ? { repoId: record.repoId } : {}),
          agent: record.task.agent,
          worktreePath: record.task.worktreePath,
          fluxxWorkBranch: record.task.fluxxWorkBranch,
          ...(record.task.sourceBranchShort
            ? { sourceBranchShort: record.task.sourceBranchShort }
            : {}),
          startedAt: record.startedAt,
          ...(record.task.agentConversationId
            ? { agentConversationId: record.task.agentConversationId }
            : {}),
        });
      }
      await taskAgentSessionRecordStore.markSessionEnded(
        {
          id: record.id,
          taskId: record.task.taskId,
          projectId: record.projectId,
          worktreePath: record.task.worktreePath,
          branch: record.task.fluxxWorkBranch,
          status: 'interrupted',
          startedAt: record.startedAt,
          stoppedAt: endedAt,
          ...(record.task.agentConversationId
            ? { agentConversationId: record.task.agentConversationId }
            : {}),
        },
        { reason: 'tmux-missing' },
      );
      return;
    }

    if (record.kind === 'planning' && record.planning) {
      if (!(await planningAgentSessionRecordStore.hasFluxxSessionId(record.id))) {
        await planningAgentSessionRecordStore.recordSessionStart({
          fluxxSessionId: record.id,
          projectId: record.projectId,
          agent: record.planning.agent,
          planningDir: record.planning.planningDir,
          startedAt: record.startedAt,
          ...(record.planning.agentModel ? { agentModel: record.planning.agentModel } : {}),
          ...(typeof record.planning.agentYolo === 'boolean'
            ? { agentYolo: record.planning.agentYolo }
            : {}),
          ...(record.planning.agentConversationId
            ? { agentConversationId: record.planning.agentConversationId }
            : {}),
        });
      }
      await planningAgentSessionRecordStore.markSessionEnded(
        {
          id: record.id,
          projectId: record.projectId,
          agent: record.planning.agent,
          planningDir: record.planning.planningDir,
          status: 'interrupted',
          startedAt: record.startedAt,
          stoppedAt: endedAt,
          ...(record.planning.agentConversationId
            ? { agentConversationId: record.planning.agentConversationId }
            : {}),
        },
        { reason: 'tmux-missing' },
      );
    }
  }

  async function markRemoteInterruptedTerminal(
    record: import('./types').TerminalSessionRecord,
    device: import('./types').ExecutionDeviceConfig,
    lifecycleStatus: import('./types').RemoteSessionLifecycleStatus,
  ): Promise<void> {
    const endedAt = new Date().toISOString();
    const endReason = mapRemoteLifecycleToEndedReason(lifecycleStatus);
    const preserveRemoteManifest =
      lifecycleStatus === 'device-unreachable' || lifecycleStatus === 'helper-mismatch';

    if (!preserveRemoteManifest && record.deviceId) {
      await remoteHelperClient.runJsonCommand(device, 'mark-terminal-ended', {
        terminalId: record.id,
        deviceId: record.deviceId,
        reason: endReason,
      });
    }

    await terminalSessionRecordStore.markTerminalEnded(record.id, {
      reason: endReason,
      endedAt,
    });

    if (record.kind !== 'task' || !record.task) return;

    if (!(await taskAgentSessionRecordStore.hasFluxxSessionId(record.id))) {
      await taskAgentSessionRecordStore.recordSessionStart({
        fluxxSessionId: record.id,
        taskId: record.task.taskId,
        projectId: record.projectId,
        ...(record.repoId ? { repoId: record.repoId } : {}),
        agent: record.task.agent,
        worktreePath: record.task.worktreePath,
        fluxxWorkBranch: record.task.fluxxWorkBranch,
        ...(record.task.sourceBranchShort ? { sourceBranchShort: record.task.sourceBranchShort } : {}),
        startedAt: record.startedAt,
        ...(record.deviceId ? { deviceId: record.deviceId } : {}),
        deviceKind: 'ssh',
        ...(device.displayName ? { deviceLabel: device.displayName } : {}),
      });
    }

    await taskAgentSessionRecordStore.markSessionEnded(
      {
        id: record.id,
        taskId: record.task.taskId,
        projectId: record.projectId,
        worktreePath: record.task.worktreePath,
        branch: record.task.fluxxWorkBranch,
        status: 'interrupted',
        startedAt: record.startedAt,
        stoppedAt: endedAt,
      },
      { reason: endReason },
    );
  }

  async function reconcileRemoteSshTerminalsForActiveProject(): Promise<
    SshReconcileDeviceFailureNotice[]
  > {
    const sshBackend = sshTerminalBackendFrom(terminalBackend);
    if (!sshBackend) return [];

    const projectId = await activeProjectIdForTmuxRestore();
    if (!projectId) return [];

    const sshDevices = listEnabledSshDevices(deviceStore);
    if (sshDevices.length === 0) return [];

    const localSshOpenRecords = (await terminalSessionRecordStore.listOpenRecords(projectId)).filter(
      (r) => r.deviceKind === 'ssh',
    );
    const project = projectStore.get();

    const output = await reconcileRemoteSshTerminalsForProject({
      projectId,
      devices: sshDevices,
      helper: remoteHelperClient,
      sshBackend,
      localOpenRecords: localSshOpenRecords,
      autoRespondToTrustPrompts: project?.autoRespondToTrustPrompts === true,
    });

    for (const { sessionId, taskId } of output.restoredSessionTaskPairs) {
      sessionTaskMap.set(sessionId, taskId);
    }

    for (const { record, lifecycleStatus } of output.interruptedRecords) {
      const deviceId = record.deviceId?.trim();
      const device = deviceId ? deviceStore.getDevice(deviceId) : undefined;
      if (!device || device.kind !== 'ssh') continue;
      await markRemoteInterruptedTerminal(record, device, lifecycleStatus);
    }

    if (output.untrackedFluxxSessions.length > 0) {
      console.warn(
        '[ssh-reconcile] untracked fluxx tmux sessions (not auto-killed):',
        output.untrackedFluxxSessions.join(', '),
      );
    }

    console.log(formatRemoteSshReconcileLogLine(output));

    return output.deviceFailures.map((failure) => {
      const device = deviceStore.getDevice(failure.deviceId);
      return {
        deviceId: failure.deviceId,
        displayName: device?.displayName ?? failure.deviceId,
        message: failure.message,
      };
    });
  }

  async function reconcileTmuxTerminalsForActiveProject(): Promise<void> {
    const localTerminalBackend = localTerminalBackendFrom(terminalBackend);
    if (!localTerminalBackend) return;
    if (isAuxDevInstance()) return;
    await syncTerminalRuntimeContext();
    if (!terminalRuntimeContext.persistTerminalsWithTmux) return;

    const projectId = await activeProjectIdForTmuxRestore();
    const projectDir = resolveRecordProjectDir();
    if (!projectId || !projectDir) return;

    const tmuxProbe = await probeTmuxAvailability();
    if (!tmuxProbe.available) {
      console.warn('[tmux-reconcile] tmux unavailable; skipping restore', tmuxProbe);
      return;
    }

    const openRecords = (await terminalSessionRecordStore.listOpenRecords(projectId)).filter(
      (r) => r.deviceKind !== 'ssh',
    );
    const project = projectStore.get();
    const trustRoots = trustPromptAutorespondRootsForProject(projectDir);
    const trustAutorespond =
      project?.autoRespondToTrustPrompts === true && trustRoots.length > 0;

    const output = await localTerminalBackend.reconcileTmuxPersistedTerminals({
      projectId,
      records: openRecords,
      pathStillPresent: async (absPath) => {
        try {
          await fs.access(absPath);
          return true;
        } catch {
          return false;
        }
      },
      trustPromptAutorespond: trustAutorespond,
      trustPromptAutorespondRoots: trustAutorespond ? trustRoots : undefined,
    });

    for (const { sessionId, taskId } of output.restoredSessionTaskPairs) {
      sessionTaskMap.set(sessionId, taskId);
    }

    for (const record of output.workspaceMissingTerminalRecords) {
      await markTmuxWorkspaceMissingTerminal(record);
    }

    for (const record of output.missingTerminalRecords) {
      if (record.kind === 'shell') {
        await terminalSessionRecordStore.markTerminalEnded(record.id, {
          reason: 'tmux-missing',
          endedAt: new Date().toISOString(),
        });
        continue;
      }
      const hasResumeMetadata =
        (record.kind === 'task' && record.task) || (record.kind === 'planning' && record.planning);
      if (hasResumeMetadata) {
        await markTmuxMissingTerminal(record);
      } else {
        await terminalSessionRecordStore.markTerminalEnded(record.id, {
          reason: 'tmux-missing',
          endedAt: new Date().toISOString(),
        });
      }
    }

    console.log(formatTmuxReconcileLogLine(output));

    try {
      const snapshot = await buildTerminalInventorySnapshotForActiveProject();
      console.log('[tmux-reconcile] inventory', JSON.stringify(snapshot));
    } catch (err) {
      console.warn('[tmux-reconcile] inventory snapshot failed', err);
    }
  }

  async function reconcileTerminalsForActiveProject(): Promise<SshReconcileDeviceFailureNotice[]> {
    await reconcileTmuxTerminalsForActiveProject();
    return await reconcileRemoteSshTerminalsForActiveProject();
  }

  let terminalRestoreGeneration = 0;
  let terminalRestoreComplete = true;
  let terminalRestorePromise: Promise<void> = Promise.resolve();

  function broadcastSshReconcileDeviceFailures(
    failures: SshReconcileDeviceFailureNotice[],
  ): void {
    if (failures.length === 0) return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('sessions:sshReconcileDeviceFailures', failures);
    }
  }

  function broadcastSessionsRestoreComplete(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('sessions:restoreComplete');
    }
  }

  function beginTerminalRestore(): Promise<void> {
    const gen = ++terminalRestoreGeneration;
    terminalRestoreComplete = false;
    terminalRestorePromise = (async () => {
      let sshDeviceFailures: SshReconcileDeviceFailureNotice[] = [];
      try {
        sshDeviceFailures = await reconcileTerminalsForActiveProject();
        await runSilenceCatchup();
      } finally {
        if (gen === terminalRestoreGeneration) {
          terminalRestoreComplete = true;
          broadcastSshReconcileDeviceFailures(sshDeviceFailures);
          broadcastSessionsRestoreComplete();
        }
      }
    })();
    return terminalRestorePromise;
  }

  // Catchup: for sessions already silent (or already exited) when this process
  // starts, no stream event will fire until the next PTY output tick.
  async function runSilenceCatchup(): Promise<void> {
    try {
      const silenceStates = await terminalBackend.getSessionSilenceStates();
      for (const { id, taskId, state } of silenceStates) {
        // Re-seed the map in case listSessions() failed earlier.
        if (taskId && !sessionTaskMap.has(id)) sessionTaskMap.set(id, taskId);
        await applyAgentState(id, state);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNKNOWN_METHOD')) {
        console.warn(
          '[main] terminal backend does not support getSessionSilenceStates — running sessions may not ' +
            'auto-transition to needs-input; upgrade Fluxx',
        );
      } else {
        console.warn('[main] catchup getSessionSilenceStates failed', err);
      }
    }
  }

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

  const appUpdater = registerAppUpdater();
  installMacApplicationMenu(appUpdater);

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

  async function refreshPlanningAssistantForValidationToggle(
    enabled: boolean,
  ): Promise<void> {
    const projectDir = activeProjectDir();
    const config = await projectStore.readStoredProjectConfig(projectDir);
    const repos = await projectStore.getReposAt(projectDir);
    const planningRoot =
      repos[0]?.rootPath ?? config?.rootPath ?? projectDir;
    const projectName = config?.name ?? projectStore.get()?.name ?? 'Project';
    await ensurePlanningAssistantMarkdownFiles(
      path.join(projectDir, 'planning'),
      projectName,
      planningRoot,
      {
        multiRepoGuide: repos.length > 1,
        validationEnabled: enabled === true,
      },
    );
  }

  async function requireValidationEnabledIpc(): Promise<
    { error: string; code: typeof VALIDATION_DISABLED_CODE } | null
  > {
    try {
      const enabled = await projectStore.getValidationEnabledAt(activeProjectDir());
      if (!enabled) {
        return { error: VALIDATION_DISABLED_MESSAGE, code: VALIDATION_DISABLED_CODE };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message, code: VALIDATION_DISABLED_CODE };
    }
    return null;
  }

  const terminalRuntimeContext: TerminalRuntimeContext = {
    persistTerminalsWithTmux: false,
    projectSlugSource: '',
  };

  async function syncTerminalRuntimeContext(): Promise<void> {
    const key = appStateStore.get().activeProjectKey;
    if (!key) {
      terminalRuntimeContext.persistTerminalsWithTmux = false;
      terminalRuntimeContext.projectSlugSource = '';
      return;
    }
    const project = projectStore.get();
    terminalRuntimeContext.projectSlugSource =
      project?.name?.trim() || project?.id || key.id;
    if (key.kind === 'cloud') {
      terminalRuntimeContext.persistTerminalsWithTmux =
        bindingStore.getPrefs(key.id).persistTerminalsWithTmux === true;
      return;
    }
    try {
      terminalRuntimeContext.persistTerminalsWithTmux =
        await projectStore.getPersistTerminalsWithTmuxAt(activeProjectDir());
    } catch {
      terminalRuntimeContext.persistTerminalsWithTmux = false;
    }
  }

  localTerminalBackendFrom(terminalBackend)?.setResolveTerminalRuntimeContext(
    () => terminalRuntimeContext,
  );
  await syncTerminalRuntimeContext();

  ipcMain.handle(
    'project:getMcpConfig',
    async (): Promise<
      | { ok: true; path: string; text: string }
      | { error: string }
    > => {
      try {
        const payload = await ensureProjectMcpConfig(activeProjectDir());
        return { ok: true, path: payload.path, text: payload.text };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    'project:setMcpConfig',
    async (
      _e,
      raw: unknown,
    ): Promise<
      | { ok: true; path: string; text: string }
      | { error: string }
    > => {
      if (typeof raw !== 'string') {
        return { error: 'MCP config must be a JSON string.' };
      }
      try {
        const payload = await writeProjectMcpConfigText(activeProjectDir(), raw);
        return { ok: true, path: payload.path, text: payload.text };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    'project:addMcpConfig',
    async (
      _e,
      raw: unknown,
    ): Promise<
      | { ok: true; path: string; text: string }
      | { error: string }
    > => {
      if (typeof raw !== 'string') {
        return { error: 'MCP config must be a JSON string.' };
      }
      try {
        const payload = await addProjectMcpServersText(activeProjectDir(), raw);
        return { ok: true, path: payload.path, text: payload.text };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

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
    return parseFirestoreRepos(raw) ?? [];
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

    const sessions = await terminalBackend.listSessions();
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
    'project:getRemoteRepoBindingsOverview',
    async (
      _e,
      payload: unknown,
    ): Promise<RemoteRepoBindingsOverview | { error: string }> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key) return { error: 'No project is open.' };
      if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
      const p = payload as Record<string, unknown>;
      const deviceId = typeof p.deviceId === 'string' ? p.deviceId.trim() : '';
      const repoIds = Array.isArray(p.repoIds)
        ? p.repoIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
      if (!deviceId) return { error: 'deviceId is required' };
      const device = deviceStore.getDevice(deviceId);
      if (!device || device.kind !== 'ssh') {
        return { error: 'SSH device is not configured on this machine.' };
      }
      const projectDir = worktreeService.getProjectDir();
      const bindings = await remoteRepoBindingService.resolveBindingsMap(key, projectDir);
      return remoteRepoBindingService.buildOverview({
        device,
        repoIds,
        bindings,
      });
    },
  );

  ipcMain.handle(
    'project:probeRemoteRepoBinding',
    async (
      _e,
      payload: unknown,
    ): Promise<
      | { ok: true; hostLabel: string; resolvedPath: string; originUrl: string }
      | { error: string; code?: string }
    > => {
      if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
      const p = payload as Record<string, unknown>;
      const deviceId = typeof p.deviceId === 'string' ? p.deviceId.trim() : '';
      const repoId = typeof p.repoId === 'string' ? p.repoId.trim() : '';
      const remotePath = typeof p.remotePath === 'string' ? p.remotePath.trim() : '';
      if (!deviceId || !repoId || !remotePath) {
        return { error: 'deviceId, repoId, and remotePath are required' };
      }
      const device = deviceStore.getDevice(deviceId);
      if (!device || device.kind !== 'ssh') {
        return { error: 'SSH device is not configured on this machine.' };
      }
      const key = appStateStore.get().activeProjectKey;
      if (!key) return { error: 'No project is open.' };
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) return { error: 'No active workspace directory.' };
      let project: Project;
      try {
        project = await resolveProjectForStart();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
      const repos = await projectStore.getReposAt(projectDir);
      const cloudProject = project.kind === 'cloud' ? project : null;
      const task = { repoId } as Task;
      let remoteUrl: string;
      try {
        const ctx = await resolveRemoteRepoForTaskSession(
          project,
          task,
          repos,
          cloudProject,
        );
        remoteUrl = ctx.remoteUrl;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
      const probed = await remoteRepoBindingService.probeRemoteRepoPath(
        device,
        remotePath,
        remoteUrl,
      );
      if (!probed.ok) {
        return { error: probed.message, code: probed.code };
      }
      return {
        ok: true,
        hostLabel: probed.hostLabel,
        resolvedPath: probed.data.resolvedPath,
        originUrl: probed.data.originUrl,
      };
    },
  );

  ipcMain.handle(
    'project:setRemoteRepoBinding',
    async (
      _e,
      payload: unknown,
    ): Promise<{ ok: true; binding: { remotePath: string; boundAt: string } } | { error: string; code?: string }> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key) return { error: 'No project is open.' };
      if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
      const p = payload as Record<string, unknown>;
      const deviceId = typeof p.deviceId === 'string' ? p.deviceId.trim() : '';
      const repoId = typeof p.repoId === 'string' ? p.repoId.trim() : '';
      const remotePath = typeof p.remotePath === 'string' ? p.remotePath.trim() : '';
      if (!deviceId || !repoId || !remotePath) {
        return { error: 'deviceId, repoId, and remotePath are required' };
      }
      const device = deviceStore.getDevice(deviceId);
      if (!device || device.kind !== 'ssh') {
        return { error: 'SSH device is not configured on this machine.' };
      }
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) return { error: 'No active workspace directory.' };
      let project: Project;
      try {
        project = await resolveProjectForStart();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
      const repos = await projectStore.getReposAt(projectDir);
      const cloudProject = project.kind === 'cloud' ? project : null;
      let remoteUrl: string;
      try {
        const ctx = await resolveRemoteRepoForTaskSession(
          project,
          { repoId } as Task,
          repos,
          cloudProject,
        );
        remoteUrl = ctx.remoteUrl;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
      const probed = await remoteRepoBindingService.probeRemoteRepoPath(
        device,
        remotePath,
        remoteUrl,
      );
      if (!probed.ok) {
        return { error: probed.message, code: probed.code };
      }
      const now = new Date().toISOString();
      const binding = {
        remotePath: probed.data.resolvedPath,
        boundAt: now,
        lastValidatedAt: now,
      };
      await remoteRepoBindingService.setBinding(key, projectDir, deviceId, repoId, binding);
      return { ok: true, binding };
    },
  );

  ipcMain.handle(
    'project:clearRemoteRepoBinding',
    async (
      _e,
      payload: unknown,
    ): Promise<{ ok: true } | { error: string }> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key) return { error: 'No project is open.' };
      if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
      const p = payload as Record<string, unknown>;
      const deviceId = typeof p.deviceId === 'string' ? p.deviceId.trim() : '';
      const repoId = typeof p.repoId === 'string' ? p.repoId.trim() : '';
      if (!deviceId || !repoId) {
        return { error: 'deviceId and repoId are required' };
      }
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) return { error: 'No active workspace directory.' };
      await remoteRepoBindingService.clearBinding(key, projectDir, deviceId, repoId);
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

  async function resolveRepoEnvFilesContext(repoId: string): Promise<
    | {
        projectDir: string;
        projectKind: 'local' | 'cloud';
        cloudProjectId?: string;
        repo: RepoConfig;
      }
    | { error: string }
  > {
    const rid = repoId.trim();
    if (!rid) return { error: 'repoId is required' };
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) return { error: 'No workspace' };
    const repos = await projectStore.getReposAt(projectDir);
    const repo = repos.find((r) => r.id === rid);
    if (!repo) return { error: `Unknown repository id: ${rid}` };
    const key = appStateStore.get().activeProjectKey;
    const projectKind = key?.kind === 'cloud' ? 'cloud' : 'local';
    return {
      projectDir,
      projectKind,
      cloudProjectId: key?.kind === 'cloud' ? key.id : undefined,
      repo,
    };
  }

  ipcMain.handle(
    'project:detectRepoEnvFiles',
    async (
      _e,
      payload: unknown,
    ): Promise<
      | { ok: true; detection: RepoEnvFileDetectionResult }
      | { error: string }
    > => {
      try {
        const repoId =
          payload && typeof payload === 'object' && typeof (payload as { repoId?: unknown }).repoId === 'string'
            ? (payload as { repoId: string }).repoId
            : '';
        const ctx = await resolveRepoEnvFilesContext(repoId);
        if ('error' in ctx) return ctx;
        const bindingEnvFiles =
          ctx.projectKind === 'cloud' && ctx.cloudProjectId
            ? bindingEnvFilesForRepo(bindingStore, ctx.cloudProjectId, ctx.repo.id)
            : undefined;
        const detection = await detectRepoEnvFilesForSettings(ctx.repo, bindingEnvFiles);
        return { ok: true, detection };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    'project:rescanRepoEnvFiles',
    async (
      _e,
      payload: unknown,
    ): Promise<
      | { ok: true; detection: RepoEnvFileDetectionResult; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        const repoId =
          payload && typeof payload === 'object' && typeof (payload as { repoId?: unknown }).repoId === 'string'
            ? (payload as { repoId: string }).repoId
            : '';
        const sharedRepos =
          payload && typeof payload === 'object'
            ? parseCloudSharedReposArg((payload as { sharedRepos?: unknown }).sharedRepos)
            : [];
        const ctx = await resolveRepoEnvFilesContext(repoId);
        if ('error' in ctx) return ctx;
        const result = await detectAndPersistRepoEnvFiles({
          projectKind: ctx.projectKind,
          projectStore,
          bindingStore,
          projectDir: ctx.projectDir,
          cloudProjectId: ctx.cloudProjectId,
          repoId: ctx.repo.id,
          repo: ctx.repo,
        });
        if (ctx.projectKind === 'cloud' && ctx.cloudProjectId && sharedRepos.length > 0) {
          await syncCloudReposDiskFromBinding({
            cloudProjectId: ctx.cloudProjectId,
            projectDir: ctx.projectDir,
            sharedRepos,
          });
          result.repos = await projectStore.getReposAt(ctx.projectDir);
        }
        return { ok: true, detection: result.detection, repos: result.repos };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    'project:setRepoEnvFileEnablement',
    async (
      _e,
      payload: unknown,
    ): Promise<
      | { ok: true; detection: RepoEnvFileDetectionResult; repos: RepoConfig[] }
      | { error: string }
    > => {
      try {
        if (!payload || typeof payload !== 'object') {
          return { error: 'Invalid payload' };
        }
        const p = payload as Record<string, unknown>;
        const repoId = typeof p.repoId === 'string' ? p.repoId : '';
        const fileName = typeof p.fileName === 'string' ? p.fileName : '';
        const enablement = p.enablement;
        const sharedRepos = parseCloudSharedReposArg(p.sharedRepos);
        if (!isRepoEnvFileName(fileName)) {
          return { error: 'Unknown env file name' };
        }
        if (enablement !== 'enabled' && enablement !== 'disabled') {
          return { error: 'enablement must be enabled or disabled' };
        }
        const ctx = await resolveRepoEnvFilesContext(repoId);
        if ('error' in ctx) return ctx;
        const bindingEnvFiles =
          ctx.projectKind === 'cloud' && ctx.cloudProjectId
            ? bindingEnvFilesForRepo(bindingStore, ctx.cloudProjectId, ctx.repo.id)
            : undefined;
        const detection = await detectRepoEnvFilesForSettings(ctx.repo, bindingEnvFiles);
        const envFiles = envFilesWithEnablement(
          detection,
          fileName,
          enablement as RepoEnvFileEnablement,
        );
        let repos: RepoConfig[];
        if (ctx.projectKind === 'cloud' && ctx.cloudProjectId) {
          await persistRepoEnvFilesForCloudBinding({
            bindingStore,
            cloudProjectId: ctx.cloudProjectId,
            repoId: ctx.repo.id,
            envFiles,
          });
          if (sharedRepos.length > 0) {
            await syncCloudReposDiskFromBinding({
              cloudProjectId: ctx.cloudProjectId,
              projectDir: ctx.projectDir,
              sharedRepos,
            });
          }
          repos = await projectStore.getReposAt(ctx.projectDir);
        } else {
          repos = await persistRepoEnvFilesForLocalProject({
            projectStore,
            projectDir: ctx.projectDir,
            repoId: ctx.repo.id,
            envFiles,
          });
        }
        const nextDetection = await detectRepoEnvFilesForSettings(
          repos.find((r) => r.id === ctx.repo.id) ?? ctx.repo,
          ctx.projectKind === 'cloud' && ctx.cloudProjectId
            ? bindingEnvFilesForRepo(bindingStore, ctx.cloudProjectId, ctx.repo.id)
            : undefined,
        );
        return { ok: true, detection: nextDetection, repos };
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
  ipcMain.handle('project:getTmuxAvailability', async (): Promise<TmuxAvailability> =>
    probeTmuxAvailability(),
  );
  ipcMain.handle('project:getPersistTerminalsWithTmux', async () => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'cloud') {
      return bindingStore.getPrefs(key.id).persistTerminalsWithTmux;
    }
    return projectStore.getPersistTerminalsWithTmuxAt(activeProjectDir());
  });
  ipcMain.handle(
    'project:setPersistTerminalsWithTmux',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        if (enabled === true) {
          const availability = await probeTmuxAvailability();
          if (!availability.available) {
            return { error: tmuxUnavailableSaveError(availability) };
          }
        }
        const key = appStateStore.get().activeProjectKey;
        if (key?.kind === 'cloud') {
          await bindingStore.setPrefs(key.id, {
            persistTerminalsWithTmux: enabled === true,
          });
          await syncTerminalRuntimeContext();
          return {
            ok: true,
            enabled: bindingStore.getPrefs(key.id).persistTerminalsWithTmux,
          };
        }
        const next = await projectStore.setPersistTerminalsWithTmuxAt(
          activeProjectDir(),
          enabled,
        );
        await syncTerminalRuntimeContext();
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle('project:getValidationEnabled', async () => {
    try {
      return await projectStore.getValidationEnabledAt(activeProjectDir());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });
  ipcMain.handle(
    'project:setValidationEnabled',
    async (_e, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { error: string }> => {
      try {
        const next = await projectStore.setValidationEnabledAt(
          activeProjectDir(),
          enabled === true,
        );
        await refreshPlanningAssistantForValidationToggle(next);
        return { ok: true, enabled: next };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );
  ipcMain.handle(
    'terminal:inventorySnapshot',
    async (): Promise<TerminalInventorySnapshot> => buildTerminalInventorySnapshotForActiveProject(),
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
  ipcMain.handle('projects:getPickerLastOpenedAt', async () => {
    const localProjects = await projectStore.listDiscovered();
    return buildPickerLastOpenedAtMap({
      appStateStore,
      bindingStore,
      localProjects,
    });
  });
  ipcMain.handle('projects:addLocal', async () => {
    const picked = await pickDirectory('Open project folder');
    if (!picked || 'error' in picked) return picked;
    return openLocalProjectFromRoot(picked.rootPath);
  });
  ipcMain.handle(
    'projects:create',
    async (
      _e,
      input: ProjectCreateInput | ProjectCreateWizardPayload,
    ): Promise<ProjectCreateResult> => {
      let normalized: ProjectCreateInput;
      try {
        normalized = normalizeProjectCreateInput(input);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: 'CREATE_FAILED', message };
      }
      const validated = await validateLocalProjectCreateInput(normalized, {
        isGitRepo: async (rootPath) => {
          try {
            await fs.access(path.join(rootPath, '.git'));
            return true;
          } catch {
            return false;
          }
        },
      });
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }
      try {
        const { project, projectDir } = await projectStore.createFromInput(validated.value);
        await writeOnboardingPending(projectDir);
        await projectStore.init(projectDir);
        await taskStore.reinit(projectDir);
        await taskStore.migrateMissingProjectIds(project.id);
        await migrateTaskRepoIdsForProject(taskStore, project);
        worktreeService.setRootPath(project.repos[0]?.rootPath ?? project.rootPath);
        worktreeService.setProjectDir(projectDir);
        await appStateStore.set({
          lastOpenedProjectDir: projectDir,
          activeProjectKey: { kind: 'local', id: project.id },
        });
        await syncTerminalRuntimeContext();
        return { ok: true, project, projectDir };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[projects:create]', message);
        return { ok: false, error: 'CREATE_FAILED', message };
      }
    },
  );
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
      const { projectDir: materialisedDir } = await projectStore.ensureLayoutForLocalProject(
        project,
        projectDir,
      );
      if (materialisedDir !== projectDir) {
        await projectStore.init(materialisedDir);
      }
      await taskStore.reinit(materialisedDir);
      await taskStore.migrateMissingProjectIds(project.id);
      await migrateTaskRepoIdsForProject(taskStore, project);
      worktreeService.setRootPath(project.repos[0]?.rootPath ?? project.rootPath);
      worktreeService.setProjectDir(materialisedDir);
      await appStateStore.set({
        lastOpenedProjectDir: materialisedDir,
        activeProjectKey: { kind: 'local', id: project.id },
      });
      await touchPickerProjectLastOpened(appStateStore, {
        kind: 'local',
        id: project.id,
      });
      await syncTerminalRuntimeContext();
      await beginTerminalRestore();
      return project;
    },
  );
  ipcMain.handle('projects:removeLocal', async (_e, id: string) => {
    const result = await removeFluxxOwnedLocalState({
      key: { kind: 'local', id },
      fluxxBaseDir,
      projectStore,
      terminalBackend,
      appStateStore,
      bindingStore,
      clearInMemoryWorkspaceIfActive: clearLocalWorkspaceState,
    });
    if (!result.ok) {
      console.error('[projects:removeLocal] incomplete', result.errors, result.warnings);
    }
  });
  ipcMain.handle('projects:removeFluxxOwnedLocalState', async (_e, raw: unknown) => {
    const key = parseActiveProjectKeyPayload(raw);
    if (!key) {
      return {
        ok: false,
        warnings: [],
        errors: ['Invalid project key'],
        deletedMaterializationDirs: [],
      };
    }
    return removeFluxxOwnedLocalState({
      key,
      fluxxBaseDir,
      projectStore,
      terminalBackend,
      appStateStore,
      bindingStore,
      clearInMemoryWorkspaceIfActive: clearLocalWorkspaceState,
    });
  });

  ipcMain.handle('projects:getActiveKey', async (): Promise<ActiveProjectKey | null> => {
    const key = appStateStore.get().activeProjectKey;
    if (key?.kind === 'local') {
      const project = projectStore.get();
      if (project && project.id !== key.id) {
        const canonicalKey: ActiveProjectKey = { kind: 'local', id: project.id };
        await appStateStore.set({ activeProjectKey: canonicalKey });
        return canonicalKey;
      }
    }
    return key;
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
      const resolvedRoot = path.resolve(payload.rootPath);
      const activeKey = appStateStore.get().activeProjectKey;
      const alreadyActive =
        activeKey?.kind === 'cloud' &&
        activeKey.id === payload.id &&
        projectStore.get()?.id === payload.id &&
        projectStore.getProjectDir() != null &&
        path.resolve(worktreeService.getRootPath()) === resolvedRoot;

      if (alreadyActive) {
        if (terminalRestoreComplete) {
          void beginTerminalRestore();
        }
        return { ok: true as const };
      }

      const shellOnly = isCloudShellRootPath(fluxxBaseDir, payload.id, resolvedRoot);
      if (!shellOnly) {
        try {
          await fs.access(path.join(resolvedRoot, '.git'));
        } catch {
          return { error: 'NOT_GIT_REPO' as const };
        }
        await bindingStore.set(payload.id, resolvedRoot);
      } else {
        await bindingStore.touchShell(payload.id);
      }
      await projectStore.clear();
      await taskStore.reinit('');
      const { projectDir } = await projectStore.ensureCloudLayoutForRoot(
        payload.id,
        resolvedRoot,
      );
      worktreeService.setRootPath(resolvedRoot);
      worktreeService.setProjectDir(projectDir);
      await appStateStore.set({
        activeProjectKey: { kind: 'cloud', id: payload.id },
      });
      await touchPickerProjectLastOpened(appStateStore, {
        kind: 'cloud',
        id: payload.id,
      });
      const sharedRepos = parseCloudSharedReposArg(payload.sharedRepos);
      if (sharedRepos.length > 0) {
        await syncCloudReposDiskFromBinding({
          cloudProjectId: payload.id,
          projectDir,
          sharedRepos,
        });
      }
      await syncTerminalRuntimeContext();
      void beginTerminalRestore();
      return { ok: true as const };
    },
  );
  ipcMain.handle(
    'projects:resolveCloudMaterializationDir',
    async (_e, cloudProjectId: string) => {
      if (typeof cloudProjectId !== 'string' || !cloudProjectId.trim()) {
        return { error: 'cloudProjectId is required' };
      }
      return {
        projectDir: path.resolve(
          canonicalCloudProjectDir(fluxxBaseDir, cloudProjectId.trim()),
        ),
      };
    },
  );
  ipcMain.handle(
    'projects:applyCloudCreateBindings',
    async (
      _e,
      payload: unknown,
    ): Promise<{ ok: true } | { error: string; code?: 'NOT_GIT_REPO' }> => {
      if (!payload || typeof payload !== 'object') {
        return { error: 'Invalid payload' };
      }
      const p = payload as Record<string, unknown>;
      const cloudProjectId =
        typeof p.cloudProjectId === 'string' ? p.cloudProjectId.trim() : '';
      if (!cloudProjectId) return { error: 'cloudProjectId is required' };
      const bindingsRaw = p.bindings;
      if (!Array.isArray(bindingsRaw)) return { error: 'bindings array is required' };
      const sharedRepos = parseCloudSharedReposArg(p.sharedRepos);
      const primaryRepoId =
        typeof p.primaryRepoId === 'string' ? p.primaryRepoId.trim() : '';
      for (const row of bindingsRaw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const repoId = typeof o.repoId === 'string' ? o.repoId.trim() : '';
        const rootPath = typeof o.rootPath === 'string' ? o.rootPath.trim() : '';
        if (!repoId || !rootPath) continue;
        try {
          await fs.access(path.join(rootPath, '.git'));
        } catch {
          return { error: 'That folder is not a git repository.', code: 'NOT_GIT_REPO' };
        }
        await bindingStore.setRepoMachineBinding(cloudProjectId, repoId, rootPath);
      }
      if (primaryRepoId) {
        await bindingStore.setPrimaryRepoId(cloudProjectId, primaryRepoId);
      }
      if (sharedRepos.length > 0) {
        const matDir = path.resolve(canonicalCloudProjectDir(fluxxBaseDir, cloudProjectId));
        const { projectDir } = await projectStore.ensureCloudLayoutForRoot(
          cloudProjectId,
          matDir,
        );
        await syncCloudReposDiskFromBinding({
          cloudProjectId,
          projectDir,
          sharedRepos,
        });
      }
      return { ok: true };
    },
  );
  ipcMain.handle('projects:clearLocalBinding', async (_e, cloudProjectId: string) => {
    await bindingStore.remove(cloudProjectId);
  });

  ipcMain.handle('projectOnboarding:getState', async () => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) {
      return { error: 'NO_ACTIVE_PROJECT' as const };
    }
    const planningDir = path.join(projectDir, 'planning');
    const status = await getPlanningInitStatus(projectDir);
    const docsInitialized = await planningDocsAreInitialized(planningDir);
    const showCallout = shouldShowPlanningInitCallout(status, docsInitialized);
    return { status, docsInitialized, showCallout };
  });

  ipcMain.handle(
    'projectOnboarding:setStatus',
    async (_e, status: unknown) => {
      if (
        status !== 'pending' &&
        status !== 'dismissed' &&
        status !== 'started' &&
        status !== 'completed'
      ) {
        return { error: 'INVALID_STATUS' as const };
      }
      const projectDir = worktreeService.getProjectDir();
      if (!projectDir) {
        return { error: 'NO_ACTIVE_PROJECT' as const };
      }
      await setPlanningInitStatus(projectDir, status);
      return { ok: true as const };
    },
  );

  ipcMain.handle(
    'projectOnboarding:writePending',
    async (_e, projectDirArg: unknown) => {
      const projectDir =
        typeof projectDirArg === 'string' && projectDirArg.trim()
          ? path.resolve(projectDirArg.trim())
          : worktreeService.getProjectDir();
      if (!projectDir) {
        return { error: 'NO_PROJECT_DIR' as const };
      }
      await writeOnboardingPending(projectDir);
      return { ok: true as const };
    },
  );

  ipcMain.handle('projectOnboarding:maybeCompleteAfterSession', async () => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) {
      return { error: 'NO_ACTIVE_PROJECT' as const };
    }
    const status = await getPlanningInitStatus(projectDir);
    if (status !== 'started') {
      return { ok: true as const, changed: false as const };
    }
    const planningDir = path.join(projectDir, 'planning');
    if (!(await planningDocsAreInitialized(planningDir))) {
      return { ok: true as const, changed: false as const };
    }
    await setPlanningInitStatus(projectDir, 'completed');
    return { ok: true as const, changed: true as const };
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
        () => terminalBackend.listSessions(),
        projectDir ?? '',
        parsed.repoId,
        parsed.fluxxWorkBranch ?? row?.fluxxWorkBranch,
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

  // ---- Execution devices (global registry + cloud local overrides) ----
  function broadcastExecutionDevicesChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('executionDevices:changed');
    }
  }

  function broadcastCloudBindingsChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('cloudBindings:changed');
    }
  }

  ipcMain.handle('executionDevices:list', async () => deviceStore.listDevices());

  ipcMain.handle('executionDevices:getGlobalDefault', async () =>
    deviceStore.getGlobalDefaultDeviceId() ?? null,
  );

  ipcMain.handle(
    'executionDevices:setGlobalDefault',
    async (_e, deviceId: string | null) => {
      await deviceStore.setGlobalDefaultDeviceId(deviceId);
      broadcastExecutionDevicesChanged();
      return deviceStore.getGlobalDefaultDeviceId() ?? null;
    },
  );

  ipcMain.handle('executionDevices:resolveDefaultForNewTask', async () =>
    resolveDefaultExecutionDeviceForNewTaskInContext(executionDeviceHostContext()),
  );

  ipcMain.handle(
    'executionDevices:createSsh',
    async (_e, input: import('./types').SshExecutionDeviceUpsertInput) => {
      const created = await deviceStore.createSshDevice(input);
      broadcastExecutionDevicesChanged();
      return created;
    },
  );

  ipcMain.handle(
    'executionDevices:update',
    async (
      _e,
      deviceId: string,
      patch: import('./types').ExecutionDeviceUpdateInput,
    ) => {
      const updated = await deviceStore.updateDevice(deviceId, patch);
      broadcastExecutionDevicesChanged();
      return updated;
    },
  );

  ipcMain.handle('executionDevices:remove', async (_e, deviceId: string) => {
    await deviceStore.removeDevice(deviceId);
    broadcastExecutionDevicesChanged();
  });

  ipcMain.handle('executionDevices:probe', async (_e, deviceId: string) => {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new Error('deviceId is required');
    }
    const result = await createDeviceProbeService().probeDevice(deviceId.trim());
    broadcastExecutionDevicesChanged();
    return result;
  });

  ipcMain.handle('tasks:resolveEffectiveExecutionDevice', async (_e, task: Task) =>
    resolveEffectiveExecutionDeviceForTaskInContext(executionDeviceHostContext(), task),
  );

  ipcMain.handle(
    'cloudBindings:getPerTaskDeviceOverrides',
    async (_e, projectId: string) =>
      bindingStore.getPerTaskDeviceOverrides(projectId) ?? {},
  );

  ipcMain.handle(
    'cloudBindings:getPerTaskDeviceOverride',
    async (_e, projectId: string, taskId: string) =>
      bindingStore.getPerTaskDeviceOverride(projectId, taskId) ?? null,
  );

  ipcMain.handle(
    'cloudBindings:setPerTaskDeviceOverride',
    async (
      _e,
      projectId: string,
      taskId: string,
      ref: TaskExecutionDeviceRef | null,
    ) => {
      if (ref !== null) {
        const parsed = parseAndValidateExecutionDeviceInput(deviceStore, ref);
        if (!parsed.ok) {
          throw new Error(parsed.message);
        }
        await bindingStore.setPerTaskDeviceOverride(projectId, taskId, parsed.ref);
        broadcastCloudBindingsChanged();
        return parsed.ref;
      }
      await bindingStore.setPerTaskDeviceOverride(projectId, taskId, null);
      broadcastCloudBindingsChanged();
      return null;
    },
  );

  ipcMain.handle(
    'cloudBindings:getProjectDefaultDeviceId',
    async (_e, projectId: string) => bindingStore.getDefaultDeviceId(projectId) ?? null,
  );

  ipcMain.handle(
    'cloudBindings:setProjectDefaultDeviceId',
    async (_e, projectId: string, deviceId: string | null) => {
      await bindingStore.setDefaultDeviceId(projectId, deviceId);
      broadcastCloudBindingsChanged();
      return bindingStore.getDefaultDeviceId(projectId) ?? null;
    },
  );

  ipcMain.handle('project:getDefaultDeviceId', async () => {
    const project = projectStore.get();
    if (!project || project.kind !== 'local') return null;
    return project.defaultDeviceId ?? null;
  });

  ipcMain.handle(
    'project:setDefaultDeviceId',
    async (_e, deviceId: string | null) => {
      const projectDir = activeProjectDir();
      if (!projectDir) throw new Error('No local project open');
      return projectStore.setDefaultDeviceIdAt(projectDir, deviceId) ?? null;
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
        agent: Agent | null;
        blockedByTaskIds?: string[];
        labels?: string[];
        sourceBranch?: string;
        createSourceBranchIfMissing?: boolean;
        agentModel?: string;
        agentYolo?: boolean;
        repoId?: string;
        executionDevice?: TaskExecutionDeviceRef;
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
      const extra =
        input.agent != null
          ? mergedTaskCreateAgentFields(project, input.agent, input.agentModel, input.agentYolo)
          : {};
      let executionDevice = input.executionDevice;
      if (executionDevice) {
        const v = validateExecutionDeviceRefForStore(deviceStore, executionDevice);
        if (!v.ok) throw new Error(v.message);
      } else {
        executionDevice = resolveDefaultExecutionDeviceForNewTaskInContext(
          executionDeviceHostContext(),
        );
      }
      return taskStore.create({
        ...input,
        ...extra,
        projectId: project.id,
        repoId: repoResolved.repoId,
        sourceBranch: planned.sourceBranch,
        createSourceBranchIfMissing: planned.createSourceBranchIfMissing,
        executionDevice,
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
              'sourceBranch' | 'createSourceBranchIfMissing' | 'repoId' | 'fluxxWorkBranch'
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
          fluxxWorkBranch: localRow?.fluxxWorkBranch,
          repoId: prev.repoId,
          listSessions: () => terminalBackend.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsForGuard,
        });
        if (locked) {
          const fluxBranch = expectedFluxxWorkBranchForTask({
            id: tid,
            fluxxWorkBranch: localRow?.fluxxWorkBranch,
          });
          return {
            ok: false,
            message: `Cannot change this task's source branch while a Fluxx workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
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
          ? (previousFields as Pick<Task, 'repoId' | 'fluxxWorkBranch'> & { githubPr?: TaskGithubPr })
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
          fluxxWorkBranch: localRow?.fluxxWorkBranch,
          repoId: prev.repoId,
          listSessions: () => terminalBackend.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsForRepoPatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxxWorkBranchForTask({
            id: tid,
            fluxxWorkBranch: localRow?.fluxxWorkBranch,
          });
          return {
            ok: false,
            message: `Cannot change this task's repository while a Fluxx workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
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
        terminalBackend,
        worktreeService,
        taskId,
        repos,
        taskRepoId,
        taskRow?.fluxxWorkBranch?.trim() || null,
        {
          validationRunStore,
          notifyValidationRunChanged: broadcastValidationRunChanged,
        },
        remoteTaskTeardownDeps,
      );
      return { errors };
    },
  );

  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  ipcMain.handle('tasks:resolveWorktrees', async (_e, raw: unknown): Promise<Record<string, boolean>> => {
    const projectDir = worktreeService.getProjectDir();
    if (!projectDir) return {};
    let entries: { taskId: string; repoId?: string | null; fluxxWorkBranch?: string | null }[] = [];
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (
        first &&
        typeof first === 'object' &&
        typeof (first as { taskId?: unknown }).taskId === 'string'
      ) {
        entries = raw
          .filter((x): x is { taskId: string; repoId?: unknown; fluxxWorkBranch?: unknown } => {
            return Boolean(
              x &&
                typeof x === 'object' &&
                typeof (x as { taskId?: unknown }).taskId === 'string' &&
                String((x as { taskId: string }).taskId).trim().length > 0,
            );
          })
          .map((x) => {
            const repoId = x.repoId;
            const fluxRaw = x.fluxxWorkBranch;
            return {
              taskId: String(x.taskId).trim(),
              repoId:
                typeof repoId === 'string' ? repoId : repoId === null ? null : undefined,
              fluxxWorkBranch:
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
    for (const { taskId, repoId, fluxxWorkBranch } of capped) {
      const fw = fluxxWorkBranch ?? byId?.get(taskId)?.fluxxWorkBranch ?? null;
      const p = await resolveTaskWorktreePath(
        taskId,
        () => terminalBackend.listSessions(),
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
      if (task?.status === 'needs-input' || task?.status === 'review' || task?.status === 'validation') {
        console.log('[task:status] needs-input/review/validation → in-progress (user submitted query, local)', {
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

    terminalBackend.writeSession(sessionId, data);

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

      const sessions = await terminalBackend.listSessions();
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
            'Could not write PR instructions for the agent. Ensure a Fluxx project directory is available.',
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
      // - `terminalBackend.writeSession` is fire-and-forget; a lone `\r` after paste
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
      await terminalBackend.writeSessionAwait(session.id, pasteInput);
      await terminalBackend.writeSessionAwait(session.id, submitInput);
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
        () => terminalBackend.listSessions(),
        projectDir,
        row?.repoId,
        row?.fluxxWorkBranch,
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
      const canonicalRepo = await readGhCanonicalOwnerRepo(ghCwd);
      const mismatch = validateGithubPrMatchesTaskRemote(viewed.githubPr.url, origin.url, {
        canonicalRepo,
      });
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
            taskAutoTransitionNotify.dispatch({
              taskTitle: rowForAuto.title,
              previousStatus: rowForAuto.status,
              nextStatus: 'done',
              reason: 'pr-merged',
            });
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
              taskAutoTransitionNotify.dispatch({
                taskTitle: rowForAuto.title,
                previousStatus: rowForAuto.status,
                nextStatus: 'review',
                reason: 'pr-opened',
              });
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
    fluxxWorkBranch?: string | null;
  } {
    if (typeof raw === 'string') {
      return { taskId: raw.trim() };
    }
    if (raw && typeof raw === 'object' && typeof (raw as { taskId?: unknown }).taskId === 'string') {
      const o = raw as { taskId: string; repoId?: unknown; fluxxWorkBranch?: unknown };
      const repoId = o.repoId;
      const fluxRaw = o.fluxxWorkBranch;
      return {
        taskId: o.taskId.trim(),
        repoId: typeof repoId === 'string' || repoId === null ? repoId : undefined,
        fluxxWorkBranch:
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
        message: 'No Fluxx project directory is open.',
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
    const sessions = await terminalBackend.listSessions();
    const stale = sessions.filter(
      (s) => s.taskId === taskId && s.status !== 'running',
    );
    for (const s of stale) {
      sessionTaskMap.delete(s.id);
      await terminalBackend.closeShellsForSession(s.id);
      await terminalBackend.stopSession(s.id);
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

    if (merged.agent == null) {
      return {
        error: 'NO_TASK_AGENT',
        message:
          'This task has no coding agent assigned. Choose Claude Code, Codex, or Cursor Agent in task details before starting a session.',
      };
    }

    const executionDevice = resolveEffectiveExecutionDeviceForTaskInContext(
      executionDeviceHostContext(),
      merged,
    );

    const projectDirForSession = activeProjectDir();
    let projectMcpConfig: Awaited<ReturnType<typeof ensureProjectMcpConfig>>;
    try {
      projectMcpConfig = await ensureProjectMcpConfig(projectDirForSession);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: 'INTERNAL',
        message: `Could not load MCP configuration: ${message}`,
      };
    }

    // Dedup against the daemon's live registry.
    const existing = (await terminalBackend.listSessions()).find(
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

    if (executionDevice.kind === 'ssh') {
      try {
        const cloudProject =
          project.kind === 'cloud'
            ? (project as import('./types').CloudProject)
            : null;
        const sshBackend = sshTerminalBackendFrom(terminalBackend);
        if (!sshBackend) {
          return finish({
            error: 'INTERNAL',
            message: 'SSH terminal backend is not available.',
          });
        }
        const sshResult = await startSshTaskSession(
          {
            deviceStore,
            projectStore,
            bindingStore,
            sshTerminalBackend: sshBackend,
            gitRemoteWorkspace: gitRemoteWorkspaceProvider,
            taskAgentSessionRecordStore,
            terminalSessionRecordStore,
            resolvePlanningDocsDir,
            activeProjectDir,
          },
          {
            task: merged,
            project,
            executionDevice,
            cloudProject,
            options,
          },
        );
        if ('error' in sshResult) {
          return finish(sshResult);
        }
        sessionTaskMap.set(sshResult.id, task.id);
        const priorFw = (merged.fluxxWorkBranch ?? '').trim();
        if (priorFw !== sshResult.branch) {
          if (project.kind === 'local') {
            const p = projectStore.get();
            if (p && taskStore.getAll(p.id).some((t) => t.id === task.id)) {
              try {
                await taskStore.update(task.id, { fluxxWorkBranch: sshResult.branch });
                broadcastLocalTasksChanged();
              } catch (err) {
                console.warn('[session:start] failed to persist fluxxWorkBranch', err);
              }
            }
          } else if (project.kind === 'cloud') {
            for (const win of BrowserWindow.getAllWindows()) {
              if (win.isDestroyed()) continue;
              win.webContents.send('task:persistFluxxWorkBranch', {
                taskId: task.id,
                fluxxWorkBranch: sshResult.branch,
              });
            }
          }
        }
        return finish(sshResult);
      } finally {
        const outcome: SessionStartResult = startOutcome ?? {
          error: 'INTERNAL',
          message: 'Session start did not return a result',
        };
        sendTaskStartProgress({ taskId, phase: 'settled', outcome });
      }
    }

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
            fluxxWorkBranch: merged.fluxxWorkBranch,
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

      if (merged.agent === 'cursor') {
        try {
          await materializeCursorMcpConfig(worktreePath, projectMcpConfig.config);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[session:start] cursor MCP materialization failed', {
            taskId: task.id,
            projectId: project.id,
            message,
          });
          try {
            await worktreeService.remove(
              worktreePath,
              path.resolve(sessionRepoCfg.rootPath),
            );
          } catch (removeErr: unknown) {
            console.error('[session:start] cleanup worktree after MCP failure', removeErr);
          }
          return finish({
            error: 'INTERNAL',
            message: `Could not prepare Cursor MCP configuration: ${message}`,
          });
        }
      }

      await archiveNonRunningSessionsForTask(task.id);

      let resumeConversationId: string | undefined;
      if (options?.resume) {
        resumeConversationId = await taskAgentSessionRecordStore.getResumeConversationId(
          merged.id,
          merged.agent,
        );
      }
      const { command, args } = options?.resume
        ? agentSpawnResumeSpec(merged, {
            agentConversationId: resumeConversationId,
            mcpConfigPath: projectMcpConfig.path,
          })
        : agentSpawnSpec(
            merged,
            await composeTaskSessionInitialPrompt(
              merged,
              resolvePlanningDocsDir() ?? path.join(projectDirForSession, 'planning'),
            ),
            { mcpConfigPath: projectMcpConfig.path },
          );
      console.log('[session:start] spawn', {
        taskId: task.id,
        command,
        args,
        resume: Boolean(options?.resume),
      });
      const trustRoots = projectDirForSession
        ? trustPromptAutorespondRootsForProject(projectDirForSession)
        : [];
      const trustAutorespondArg =
        project.autoRespondToTrustPrompts === true &&
        cwdUnderTrustPromptAutorespondRoots(worktreePath, trustRoots)
          ? { trustPromptAutorespond: true as const, trustPromptAutorespondRoots: trustRoots }
          : {};

      let ptyEnv: Record<string, string> | undefined;
      const activeKey = appStateStore.get().activeProjectKey;
      if (fluxAutomationServer && fluxAutomationToken && activeKey) {
        await fluxAutomationServer.whenReady();
        const baseUrl = fluxAutomationServer.baseUrl;
        await writeFluxCliBridgeConfig(projectDirForSession, {
          url: baseUrl,
          token: fluxAutomationToken,
          expectedActiveKey: activeKey,
        });
        ptyEnv = fluxAutomationPtyEnv({
          baseUrl,
          token: fluxAutomationToken,
          expectedActiveKey: activeKey,
          fluxCliBinDir: resolveFluxCliBinDir(),
        });
      }

      const result = await terminalBackend.createSession({
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
        ...(ptyEnv !== undefined ? { ptyEnv } : {}),
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
            message: agentNotFoundMessage(merged.agent, command),
          });
        }
        return finish({ error: 'AGENT_NOT_FOUND', message: result.message });
      }
      sessionTaskMap.set(result.id, task.id);
      const liveTaskSessionIds = new Set(
        (await terminalBackend.listSessions())
          .filter((s) => s.taskId === merged.id)
          .map((s) => s.id),
      );
      void taskAgentSessionRecordStore.markReplacedSessions(
        merged.id,
        result.id,
        liveTaskSessionIds,
      );
      void terminalSessionRecordStore.markReplacedTaskSessions(merged.id, result.id);
      const sourceBranchShort = (merged.sourceBranch ?? '').trim() || undefined;
      const row: TaskAgentSessionRecord = {
        fluxxSessionId: result.id,
        taskId: merged.id,
        projectId: project.id,
        repoId: sessionRepoCfg.id,
        agent: merged.agent,
        worktreePath,
        fluxxWorkBranch: branch,
        ...(sourceBranchShort ? { sourceBranchShort } : {}),
        startedAt: result.startedAt,
      };
      void taskAgentSessionRecordStore.recordSessionStart(row);
      const terminalRow = withTerminalRuntimeMeta(
        terminalBackend,
        result.id,
        'session',
        {
          id: result.id,
          kind: 'task',
          runtime: 'node-pty',
          projectId: project.id,
          ...(sessionRepoCfg.id != null && sessionRepoCfg.id.length > 0
            ? { repoId: sessionRepoCfg.id }
            : {}),
          cwd: worktreePath,
          command,
          args,
          cols: 80,
          rows: 24,
          startedAt: result.startedAt,
          task: {
            taskId: merged.id,
            agent: merged.agent,
            worktreePath,
            fluxxWorkBranch: branch,
            ...(sourceBranchShort ? { sourceBranchShort } : {}),
          },
        },
      );
      void terminalSessionRecordStore.recordTerminalStart(terminalRow);
      const priorFw = (merged.fluxxWorkBranch ?? '').trim();
      if (priorFw !== branch) {
        if (project.kind === 'local') {
          const p = projectStore.get();
          if (p && taskStore.getAll(p.id).some((t) => t.id === task.id)) {
            try {
              await taskStore.update(task.id, { fluxxWorkBranch: branch });
              broadcastLocalTasksChanged();
            } catch (err) {
              console.warn('[session:start] failed to persist fluxxWorkBranch', err);
            }
          }
        } else if (project.kind === 'cloud') {
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            win.webContents.send('task:persistFluxxWorkBranch', {
              taskId: task.id,
              fluxxWorkBranch: branch,
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
      | 'fluxxWorkBranch'
      | 'executionDevice'
    >
  > & {
    githubPr?: TaskGithubPr | null;
    /** `null` clears stored value (inherit project default for when-unblocked). */
    autoStartOnUnblock?: boolean | null;
    /** `null` clears all attached planning docs. */
    attachedPlanningDocs?: TaskAttachedPlanningDoc[] | null;
    executionDevice?: TaskExecutionDeviceRef | null;
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
    if (updated.agent == null) {
      return;
    }
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
        const p = projectStore.get();
        const prev = p ? taskStore.getAll(p.id).find((t) => t.id === id) : undefined;
        await updateTaskWithTransitionHandling(
          id,
          { status: 'in-progress' },
          `unblock-backlog:${source}`,
        );
        if (prev && prev.status !== 'in-progress') {
          taskAutoTransitionNotify.dispatch({
            taskTitle: prev.title,
            previousStatus: prev.status,
            nextStatus: 'in-progress',
            reason: 'dependency-unblocked',
          });
        }
      },
      moveBacklogToInProgressThenStartSessionWithoutImplicitInProg: async (id) => {
        const p = projectStore.get();
        const prev = p ? taskStore.getAll(p.id).find((t) => t.id === id) : undefined;
        await updateTaskWithTransitionHandling(
          id,
          { status: 'in-progress' },
          `unblock-backlog:${source}`,
          { skipInProgressAutostart: true },
        );
        if (prev && prev.status !== 'in-progress') {
          taskAutoTransitionNotify.dispatch({
            taskTitle: prev.title,
            previousStatus: prev.status,
            nextStatus: 'in-progress',
            reason: 'dependency-unblocked',
          });
        }
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
    if (patch.executionDevice !== undefined) {
      if (patch.executionDevice !== null) {
        const v = validateExecutionDeviceRefForStore(deviceStore, patch.executionDevice);
        if (!v.ok) {
          throw new Error(v.message);
        }
      }
    }
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
          fluxxWorkBranch: previous.fluxxWorkBranch,
          repoId: previous.repoId,
          listSessions: () => terminalBackend.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsSourcePatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxxWorkBranchForTask(previous);
          throw new Error(
            `Cannot change this task's source branch while a Fluxx workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
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
          fluxxWorkBranch: previous.fluxxWorkBranch,
          repoId: previous.repoId,
          listSessions: () => terminalBackend.listSessions(),
          projectDir: worktreeService.getProjectDir() || projectDir,
          repoGitRoots: repoGitRootsPersistPatch,
        });
        if (locked) {
          const fluxBranch = expectedFluxxWorkBranchForTask(previous);
          throw new Error(
            `Cannot change this task's repository while a Fluxx workspace exists (session, worktree folder, or local branch '${fluxBranch}'). Remove the workspace or stop the session first.`,
          );
        }
      }
    }

    const updated = await taskStore.update(id, patchToApply);
    await maybeAutoStartSessionOnInProgressTransition(previous, updated, source, options);
    await validationTransitionHooks?.onEnteredValidation(previous, updated, source);
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
          terminalBackend,
          worktreeService,
          id,
          cleanupRepos,
          updated.repoId?.trim() ?? null,
          updated.fluxxWorkBranch?.trim() ?? null,
          {
            validationRunStore,
            notifyValidationRunChanged: broadcastValidationRunChanged,
          },
          remoteTaskTeardownDeps,
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
    if (existing.agent == null) {
      throw new Error(
        'This task has no coding agent assigned. Set an agent on the task before starting work.',
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
    await terminalBackend.closeShellsForSession(sessionId);
    void terminalSessionRecordStore.markTerminalEnded(sessionId, { reason: 'user-archived' });

    const project = projectStore.get();
    const liveSessions = await terminalBackend.listSessions();
    const live = liveSessions.find((s) => s.id === sessionId);
    if (live) {
      void taskAgentSessionRecordStore.markSessionEnded(live, { reason: 'user-archived' });
      await terminalBackend.stopSession(sessionId);
      return;
    }

    if (project) {
      const cold = await taskAgentSessionRecordStore.getColdResumeSessionById(
        project.id,
        sessionId,
        async (p) => {
          try {
            await fs.access(p);
            return true;
          } catch {
            return false;
          }
        },
      );
      if (cold) {
        void taskAgentSessionRecordStore.markSessionEnded(cold, { reason: 'user-archived' });
      }
    }
  });

  ipcMain.handle('session:delete', async (_e, sessionId: string) => {
    sessionTaskMap.delete(sessionId);
    const deleteRepos = await projectStore.getReposAt(activeProjectDir());
    await deleteSessionWorkspaceAndStop(
      terminalBackend,
      worktreeService,
      sessionId,
      gitRootForDaemonSession,
      remoteTaskTeardownDeps,
      deleteRepos,
    );
    await taskAgentSessionRecordStore.markWorkspaceDeletedForFluxxSession(sessionId);
    void terminalSessionRecordStore.markWorkspaceDeleted(sessionId);
  });

  ipcMain.handle('session:get', async (_e, taskId: string) => {
    const sessions = await terminalBackend.listSessions();
    const forTask = sessions.filter((s) => s.taskId === taskId);
    const running = forTask.find((s) => s.status === 'running');
    if (running) return running;
    const terminal = forTask.filter((s) => s.status === 'stopped' || s.status === 'error');
    if (terminal.length > 0) {
      terminal.sort((a, b) => {
        const ta = a.stoppedAt ?? a.startedAt ?? '';
        const tb = b.stoppedAt ?? b.startedAt ?? '';
        return ta.localeCompare(tb);
      });
      return terminal[terminal.length - 1] ?? null;
    }

    const project = projectStore.get();
    if (!project) return null;
    return taskAgentSessionRecordStore.getColdResumeSessionView(taskId, project.id, async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    });
  });

  ipcMain.handle('session:getAll', async () => {
    await ensureValidatorSessionBindingsHydrated();
    const project = projectStore.get();
    const live = annotateValidatorSessionKinds(await terminalBackend.listSessions());
    if (!project) return live;
    const forProject = live.filter((s) => s.projectId === project.id);
    const liveIds = new Set(forProject.map((s) => s.id));
    const cold = await taskAgentSessionRecordStore.listColdResumeTaskSessions(
      project.id,
      async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      },
      { excludeFluxxSessionIds: liveIds },
    );
    const otherProjects = live.filter((s) => s.projectId !== project.id);
    return annotateValidatorSessionKinds([
      ...otherProjects,
      ...mergeTaskSessionsWithColdResume(forProject, cold),
    ]);
  });

  ipcMain.handle('sessions:isRestoreComplete', async () => terminalRestoreComplete);

  ipcMain.handle('sessions:awaitRestoreComplete', async () => {
    await terminalRestorePromise;
  });

  ipcMain.handle('session:reconcileRemote', async () => {
    const sshDeviceFailures = await reconcileRemoteSshTerminalsForActiveProject();
    broadcastSshReconcileDeviceFailures(sshDeviceFailures);
    broadcastSessionsRestoreComplete();
    const project = projectStore.get();
    const live = await terminalBackend.listSessions();
    if (!project) return live;
    const forProject = live.filter((s) => s.projectId === project.id);
    const liveIds = new Set(forProject.map((s) => s.id));
    const cold = await taskAgentSessionRecordStore.listColdResumeTaskSessions(
      project.id,
      async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      },
      { excludeFluxxSessionIds: liveIds },
    );
    const otherProjects = live.filter((s) => s.projectId !== project.id);
    return [...otherProjects, ...mergeTaskSessionsWithColdResume(forProject, cold)];
  });

  ipcMain.handle('session:syncToLocal', async (_e, rawSessionId: unknown) => {
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!sessionId) {
      return {
        ok: false as const,
        phase: 'remote-status' as const,
        error: 'INTERNAL' as const,
        message: 'Invalid session id.',
      };
    }
    const project = await resolveProjectForStart();
    const sessions = await terminalBackend.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return {
        ok: false as const,
        phase: 'remote-status' as const,
        error: 'INTERNAL' as const,
        message: 'Session not found.',
      };
    }
    const tasks = taskStore.getAll(project.id);
    const task = tasks.find((t) => t.id === session.taskId);
    if (!task) {
      return {
        ok: false as const,
        phase: 'remote-status' as const,
        error: 'INTERNAL' as const,
        message: 'Task not found for this session.',
      };
    }
    return syncRemoteSshTaskToLocal(
      {
        deviceStore,
        helper: remoteHelperClient,
        worktreeService,
        resolveRepoConfigForTaskSession,
        activeProjectDir,
      },
      { session, task, project },
    );
  });

  ipcMain.handle('session:getSshLocalWorktree', async (_e, rawSessionId: unknown) => {
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!sessionId) {
      return { path: null as string | null, lastSyncedAt: null as string | null };
    }
    const sessions = await terminalBackend.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || session.deviceKind !== 'ssh') {
      return { path: null, lastSyncedAt: null };
    }
    const projectDir = activeProjectDir();
    if (!projectDir) {
      return { path: null, lastSyncedAt: null };
    }
    const task = taskStore.getAll(session.projectId).find((t) => t.id === session.taskId);
    const pathResolved = await resolveSshLocalWorktreePath({
      projectDir,
      taskId: session.taskId,
      repoId: session.repoId ?? task?.repoId,
      fluxxWorkBranch: session.branch || task?.fluxxWorkBranch,
    });
    const meta = pathResolved
      ? await readRemoteSshSyncMetadata(projectDir, session.taskId)
      : null;
    return {
      path: pathResolved,
      lastSyncedAt: meta?.lastSyncedAt ?? null,
    };
  });

  ipcMain.handle(
    'session:attach',
    async (_e, sessionId: string): Promise<AttachResult | null> =>
      terminalBackend.attachSession(sessionId),
  );

  ipcMain.on('session:write', (_e, sessionId: string, data: string) => {
    sendTaskSessionTerminalInput(sessionId, data);
  });

  ipcMain.on('session:resize', (_e, sessionId: string, cols: number, rows: number) => {
    terminalBackend.resizeSession(sessionId, cols, rows);
  });

  ipcMain.handle('session:getSilenceStates', async () => {
    try {
      return await terminalBackend.getSessionSilenceStates();
    } catch {
      return [];
    }
  });

  const automationRendererBridge = new RendererAutomationBridge(() => mainWindow);
  automationRendererBridge.install();
  fluxAutomationRendererBridge = automationRendererBridge;

  const resolvePlanningDocsDir = (): string | null =>
    resolvePlanningDocsDirFromSources(
      projectStore.getProjectDir(),
      worktreeService.getProjectDir(),
    );

  const launchValidatorSession = createValidatorSessionLauncher({
    validationRunStore,
    terminalBackend,
    listTerminalSessions: () => terminalBackend.listSessions(),
    getRecordProjectDir: resolveRecordProjectDir,
    getProject: () => projectStore.get(),
    getValidationEnabled: async () => {
      const dir = resolveRecordProjectDir()?.trim();
      if (!dir) return false;
      try {
        return await projectStore.getValidationEnabledAt(dir);
      } catch {
        return false;
      }
    },
    getActiveProjectKey: () => appStateStore.get().activeProjectKey,
    getFluxAutomation: () => ({
      server: fluxAutomationServer,
      token: fluxAutomationToken,
    }),
  });

  validationTransitionHooks = buildValidationTransitionHooks({
    validationRunStore,
    launchValidatorSession,
    projectStore,
    taskStore,
    terminalBackend,
    getRecordProjectDir: resolveRecordProjectDir,
    getActiveProjectKey: () => appStateStore.get().activeProjectKey,
    bridge: automationRendererBridge,
    updateLocalTask: (id, patch, source) => updateTaskWithTransitionHandling(id, patch, source),
    broadcastLocalTasksChanged,
    ensureValidatorBindingsHydrated: ensureValidatorSessionBindingsHydrated,
  });

  void ensureValidatorSessionBindingsHydrated();

  fluxAutomationHostDeps = {
    taskStore,
    projectStore,
    appStateStore,
    bindingStore,
    deviceStore,
    bridge: automationRendererBridge,
    validationRunStore,
    listTerminalSessions: () => terminalBackend.listSessions(),
    getRecordProjectDir: resolveRecordProjectDir,
    getMainWindow: () => mainWindow,
    notifyValidationRunChanged: (runId) => broadcastValidationRunChanged(runId),
    launchValidatorSession,
    onValidationRunFinalized: async (run, source) => {
      await validationTransitionHooks?.onRunPassed(run, source);
    },
    taskActions: {
      updateTask: (id, patch) =>
        updateTaskWithTransitionHandling(id, patch, 'cli:fluxx tasks update'),
      startTask: (id) => startTaskAndSession(id, 'cli:fluxx tasks start'),
      startSessionForExistingTask: (task) =>
        runStartSessionForTaskWithLogging(task, 'cli:fluxx tasks start'),
      autoStartIfTransitionedToInProgress: (previous, updated) =>
        maybeAutoStartSessionOnInProgressTransition(
          previous,
          updated,
          'cli:fluxx tasks update',
        ),
    },
  };

  fluxAutomationToken = newFluxAutomationToken();
  fluxAutomationServer = new AutomationHttpServer(
    fluxAutomationToken,
    () => appStateStore.get().activeProjectKey,
    (body) => {
      if (!fluxAutomationHostDeps) {
        return Promise.resolve({
          ok: false as const,
          error: 'Automation host not ready',
          code: 'NO_ACTIVE_PROJECT' as const,
        });
      }
      return invokeFluxAutomationRequest(fluxAutomationHostDeps, body);
    },
  );
  fluxAutomationServer.start();

  async function activeProjectIdForPlanning(): Promise<string | null> {
    const activeKey = appStateStore.get().activeProjectKey;
    if (!activeKey) return null;
    if (activeKey.kind === 'local') {
      return projectStore.get()?.id ?? null;
    }
    return activeKey.id;
  }

  async function planningDirStillPresent(absPath: string): Promise<boolean> {
    try {
      await fs.access(absPath);
      return true;
    } catch {
      return false;
    }
  }

  async function worktreePathStillPresent(absPath: string): Promise<boolean> {
    try {
      await fs.access(absPath);
      return true;
    } catch {
      return false;
    }
  }

  async function collectRestorableSessionIds(): Promise<RestorableSessionIds> {
    const project = projectStore.get();
    if (!project) {
      return { taskSessionIds: [], planningSessionIds: [] };
    }
    const liveTask = (await terminalBackend.listSessions()).filter(
      (s) => s.projectId === project.id,
    );
    const liveTaskIds = new Set(liveTask.map((s) => s.id));
    const coldTask = await taskAgentSessionRecordStore.listColdResumeTaskSessions(
      project.id,
      worktreePathStillPresent,
      { excludeFluxxSessionIds: liveTaskIds },
    );
    const taskSessionIds = [
      ...new Set([...liveTask.map((s) => s.id), ...coldTask.map((s) => s.id)]),
    ];
    const taskSessionRefs = [
      ...liveTask.map((s) => ({ sessionId: s.id, taskId: s.taskId })),
      ...coldTask.map((s) => ({ sessionId: s.id, taskId: s.taskId })),
    ];

    const livePlanning = (await terminalBackend.listPlanning()).filter(
      (s) => s.projectId === project.id,
    );
    const livePlanningIds = new Set(livePlanning.map((s) => s.id));
    const coldPlanning = await planningAgentSessionRecordStore.listColdResumePlanningSessions(
      project.id,
      planningDirStillPresent,
      { excludeFluxxSessionIds: livePlanningIds },
    );
    const planningSessionIds = [
      ...new Set([...livePlanning.map((s) => s.id), ...coldPlanning.map((s) => s.id)]),
    ];

    return { taskSessionIds, planningSessionIds, taskSessionRefs };
  }

  ipcMain.handle('projects:getRestorableSessionIds', async () => collectRestorableSessionIds());

  ipcMain.handle('planning:list', async () => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return [];
    const live = (await terminalBackend.listPlanning()).filter((s) => s.projectId === pid);
    const liveIds = new Set(live.map((s) => s.id));
    const cold = await planningAgentSessionRecordStore.listColdResumePlanningSessions(
      pid,
      planningDirStillPresent,
      { excludeFluxxSessionIds: liveIds },
    );
    return mergePlanningSessionsWithColdResume(live, cold);
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
        resume: resumeRequested,
        sessionId: resumeSessionId,
        initialPrompt: requestedInitialPrompt,
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
        if (!resumeRequested) {
          planningAgent = isPlanningAgent(requestedAgent)
            ? requestedAgent
            : local.planningAgent;
          try {
            await projectStore.setPlanningAgent(planningAgent);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { error: 'CONFIG_WRITE_FAILED', message };
          }
        } else {
          planningAgent = local.planningAgent;
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
        if (!resumeRequested) {
          planningAgent = isPlanningAgent(requestedAgent)
            ? requestedAgent
            : prefs.planningAgent;
          try {
            await bindingStore.setPrefs(activeKey.id, { planningAgent });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { error: 'CONFIG_WRITE_FAILED', message };
          }
        } else {
          planningAgent = prefs.planningAgent;
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

      let resumeFromSessionId: string | undefined;
      let resumeRecord: PlanningAgentSessionRecord | null = null;
      let planningDir = path.join(projectDir, 'planning');

      if (resumeRequested) {
        const coldTarget = resumeSessionId
          ? await planningAgentSessionRecordStore.getColdResumePlanningSessionById(
              project.id,
              resumeSessionId,
              planningDirStillPresent,
            )
          : await planningAgentSessionRecordStore.getColdResumePlanningSessionView(
              project.id,
              planningDirStillPresent,
            );
        if (!coldTarget) {
          return {
            error: 'NO_RESUMABLE_SESSION',
            message: 'No interrupted planning session is available to resume.',
          };
        }
        resumeFromSessionId = coldTarget.id;
        resumeRecord = await planningAgentSessionRecordStore.getRecord(coldTarget.id);
        if (!resumeRecord || resumeRecord.projectId !== project.id) {
          return {
            error: 'NO_RESUMABLE_SESSION',
            message: 'Planning session record is missing or belongs to another project.',
          };
        }
        planningAgent = isPlanningAgent(requestedAgent) ? requestedAgent : resumeRecord.agent;
        planningDir = resumeRecord.planningDir;
      }

      await fs.mkdir(planningDir, { recursive: true });
      const { ensurePlanningAssistantMarkdownFiles } = await import(
        './main/ProjectStore'
      );
      const planningRepos = await projectStore.getReposAt(projectDir);
      const validationEnabled = await projectStore.getValidationEnabledAt(projectDir);
      await ensurePlanningAssistantMarkdownFiles(
        planningDir,
        project.name,
        planningRepos[0]?.rootPath ?? project.rootPath,
        {
          multiRepoGuide: planningRepos.length > 1,
          validationEnabled,
        },
      );

      const spawnModel = resumeRecord?.agentModel?.trim()
        ? resumeRecord.agentModel
        : resolvedPlanningModelForSpawn(project, planningAgent, requestedModel);
      const spawnYolo =
        resumeRecord?.agentYolo !== undefined
          ? resumeRecord.agentYolo
          : resolvedPlanningYoloForSpawn(project, requestedYolo);
      const { command, args } = resumeRequested
        ? planningSpawnResumeSpec(planningAgent, spawnModel, spawnYolo, {
            agentConversationId: resumeRecord?.agentConversationId,
          })
        : planningSpawnSpec(
            planningAgent,
            spawnModel,
            spawnYolo,
            requestedInitialPrompt,
          );
      const trustRoots = trustPromptAutorespondRootsForProject(projectDir);
      const trustAutorespondArg =
        project.autoRespondToTrustPrompts === true &&
        cwdUnderTrustPromptAutorespondRoots(planningDir, trustRoots)
          ? { trustPromptAutorespond: true as const, trustPromptAutorespondRoots: trustRoots }
          : {};

      let ptyEnv: Record<string, string> | undefined;
      if (fluxAutomationServer && fluxAutomationToken) {
        await fluxAutomationServer.whenReady();
        const baseUrl = fluxAutomationServer.baseUrl;
        await writeFluxCliBridgeConfig(projectDir, {
          url: baseUrl,
          token: fluxAutomationToken,
          expectedActiveKey: activeKey,
        });
        ptyEnv = fluxAutomationPtyEnv({
          baseUrl,
          token: fluxAutomationToken,
          expectedActiveKey: activeKey,
          fluxCliBinDir: resolveFluxCliBinDir(),
        });
      }

      const planningCols = 220;
      const planningRows = 50;
      const result = await terminalBackend.startPlanning({
        projectId: project.id,
        agent: planningAgent,
        planningDir,
        command,
        args,
        cols: planningCols,
        rows: planningRows,
        ...trustAutorespondArg,
        ...(ptyEnv !== undefined ? { ptyEnv } : {}),
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
      if (resumeFromSessionId) {
        const warmStale = await terminalBackend.getPlanning(resumeFromSessionId);
        if (warmStale) {
          conversationParseTails.delete(resumeFromSessionId);
          conversationCaptured.delete(resumeFromSessionId);
          await terminalBackend.stopPlanning(resumeFromSessionId);
        }
        void planningAgentSessionRecordStore.markColdResumeReplaced(resumeFromSessionId);
        void terminalSessionRecordStore.markColdResumeReplaced(resumeFromSessionId);
      }
      const livePlanningSessionIds = new Set(
        (await terminalBackend.listPlanning())
          .filter((s) => s.projectId === project.id)
          .map((s) => s.id),
      );
      void planningAgentSessionRecordStore.markReplacedSessions(
        project.id,
        result.id,
        livePlanningSessionIds,
      );
      void terminalSessionRecordStore.markReplacedPlanningSessions(project.id, result.id);
      const planningRow: PlanningAgentSessionRecord = {
        fluxxSessionId: result.id,
        projectId: project.id,
        agent: planningAgent,
        planningDir,
        startedAt: result.startedAt,
        ...(spawnModel ? { agentModel: spawnModel } : {}),
        ...(spawnYolo ? { agentYolo: true } : {}),
      };
      void planningAgentSessionRecordStore.recordSessionStart(planningRow);
      const planningTerminalRow = withTerminalRuntimeMeta(
        terminalBackend,
        result.id,
        'planning',
        {
          id: result.id,
          kind: 'planning',
          runtime: 'node-pty',
          projectId: project.id,
          cwd: planningDir,
          command,
          args,
          cols: planningCols,
          rows: planningRows,
          startedAt: result.startedAt,
          planning: {
            agent: planningAgent,
            planningDir,
            ...(spawnModel ? { agentModel: spawnModel } : {}),
            ...(spawnYolo ? { agentYolo: true } : {}),
          },
        },
      );
      void terminalSessionRecordStore.recordTerminalStart(planningTerminalRow);
      return result;
    },
  );

  ipcMain.handle('planning:stop', async (_e, sessionId: string) => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return;
    const s = await terminalBackend.getPlanning(sessionId);
    if (s && s.projectId === pid) {
      void planningAgentSessionRecordStore.markSessionEnded(
        {
          id: sessionId,
          status: 'stopped',
          startedAt: s.startedAt,
          stoppedAt: new Date().toISOString(),
        },
        { reason: 'user-archived' },
      );
      void terminalSessionRecordStore.markTerminalEnded(sessionId, { reason: 'user-archived' });
      conversationParseTails.delete(sessionId);
      conversationCaptured.delete(sessionId);
      await terminalBackend.stopPlanning(sessionId);
      return;
    }
    const cold = await planningAgentSessionRecordStore.getColdResumePlanningSessionById(
      pid,
      sessionId,
      planningDirStillPresent,
    );
    if (!cold) return;
    void planningAgentSessionRecordStore.markSessionEnded(
      {
        id: sessionId,
        status: 'stopped',
        startedAt: cold.startedAt,
        stoppedAt: cold.stoppedAt ?? new Date().toISOString(),
      },
      { reason: 'user-archived' },
    );
    void terminalSessionRecordStore.markTerminalEnded(sessionId, { reason: 'user-archived' });
  });

  ipcMain.handle('planning:get', async (_e, sessionId: string) => {
    const pid = await activeProjectIdForPlanning();
    if (!pid) return null;
    const s = await terminalBackend.getPlanning(sessionId);
    if (s && s.projectId === pid) return s;
    return planningAgentSessionRecordStore.getColdResumePlanningSessionById(
      pid,
      sessionId,
      planningDirStillPresent,
    );
  });

  ipcMain.handle(
    'planning:attach',
    async (_e, sessionId: string): Promise<PlanningAttachResult | null> => {
      const pid = await activeProjectIdForPlanning();
      if (!pid) return null;
      const s = await terminalBackend.getPlanning(sessionId);
      if (!s || s.projectId !== pid) return null;
      return terminalBackend.attachPlanning(sessionId);
    },
  );

  ipcMain.on('planning:write', (_e, sessionId: string, data: string) => {
    void (async () => {
      const pid = await activeProjectIdForPlanning();
      if (!pid) return;
      const s = await terminalBackend.getPlanning(sessionId);
      if (!s || s.projectId !== pid) return;
      terminalBackend.writePlanning(sessionId, data);
    })();
  });

  ipcMain.on(
    'planning:resize',
    (_e, sessionId: string, cols: number, rows: number) => {
      void (async () => {
        const pid = await activeProjectIdForPlanning();
        if (!pid) return;
        const s = await terminalBackend.getPlanning(sessionId);
        if (!s || s.projectId !== pid) return;
        terminalBackend.resizePlanning(sessionId, cols, rows);
      })();
    },
  );

  ipcMain.handle(
    'validationTasks:onEnteredValidation',
    async (
      _e,
      payload: { previousStatus?: TaskStatus; task?: Task },
    ) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      const task = payload?.task;
      const previousStatus = payload?.previousStatus;
      if (!task || typeof task.id !== 'string' || !previousStatus) {
        return { error: 'previousStatus and task are required' };
      }
      if (task.status !== 'validation') {
        return { ok: true as const };
      }
      try {
        await validationTransitionHooks?.onEnteredValidation(
          { ...task, status: previousStatus },
          task,
          'ipc:validationTasks:onEnteredValidation',
        );
        return { ok: true as const };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'validationRuns:launchValidator',
    async (_e, payload: { runId?: string; task?: Task }) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      const runId = payload?.runId?.trim();
      const task = payload?.task;
      if (!runId) return { error: 'runId is required' };
      if (!task || typeof task.id !== 'string') return { error: 'task is required' };
      try {
        const launched = await launchValidatorSession({ task, runId });
        if (!launched.ok) {
          const errored = await validationRunStore.updateStatus({
            runId,
            status: 'errored',
            verdictReason: launched.error,
          });
          broadcastValidationRunChanged(runId);
          return { error: launched.error, run: errored };
        }
        broadcastValidationRunChanged(runId);
        return {
          ok: true as const,
          run: launched.run,
          validatorSessionId: launched.sessionId,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'validationRuns:cancelValidator',
    async (_e, payload: { runId?: string; sessionId?: string }) => {
      const runId = payload?.runId?.trim();
      const sessionId = payload?.sessionId?.trim();
      if (!runId || !sessionId) {
        return { error: 'runId and sessionId are required' };
      }
      try {
        const run = await cancelValidatorSession(
          { validationRunStore, terminalBackend, runId, sessionId },
        );
        broadcastValidationRunChanged(runId);
        return { ok: true as const, run };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'validationRuns:create',
    async (_e, input: ValidationRunCreateInput) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      try {
        const run = await validationRunStore.create(input);
        broadcastValidationRunChanged(run.id);
        return { ok: true as const, run };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'validationRuns:updateStatus',
    async (_e, patch: ValidationRunStatusUpdate) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      try {
        const run = await validationRunStore.updateStatus(patch);
        broadcastValidationRunChanged(patch.runId);
        return { ok: true as const, run };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('validationRuns:listForTask', async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      return { error: 'Invalid task id' };
    }
    try {
      await ensureValidatorSessionBindingsHydrated();
      const before = await validationRunStore.listForTask(taskId.trim());
      const runs = await reconcileActiveValidationRunsForTask(
        { validationRunStore, terminalBackend },
        taskId.trim(),
        'ipc:validationRuns:listForTask',
      );
      const latestBefore = before[0];
      const latestAfter = runs[0];
      if (
        latestBefore &&
        latestAfter &&
        latestBefore.id === latestAfter.id &&
        latestBefore.status !== latestAfter.status
      ) {
        broadcastValidationRunChanged(latestAfter.id);
      }
      return { ok: true as const, runs };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('validationRuns:get', async (_e, runId: string) => {
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      return { error: 'Invalid run id' };
    }
    try {
      const run = await validationRunStore.get(runId.trim());
      if (!run) return { error: 'Validation run not found' };
      return { ok: true as const, run };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    'validationRuns:readArtifact',
    async (_e, payload: { runId?: string; artifactId?: string }) => {
      const runId = payload?.runId?.trim();
      const artifactId = payload?.artifactId?.trim();
      if (!runId || !artifactId) {
        return { ok: false as const, error: 'runId and artifactId are required', code: 'NOT_FOUND' as const };
      }
      try {
        return await readValidationArtifactForUi(validationRunStore, runId, artifactId);
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          code: 'UNREADABLE' as const,
        };
      }
    },
  );

  ipcMain.handle(
    'validationRuns:openArtifact',
    async (_e, payload: { runId?: string; artifactId?: string }) => {
      const runId = payload?.runId?.trim();
      const artifactId = payload?.artifactId?.trim();
      if (!runId || !artifactId) {
        return { ok: false as const, error: 'runId and artifactId are required', code: 'NOT_FOUND' as const };
      }
      try {
        return await openValidationArtifactExternally(validationRunStore, runId, artifactId);
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          code: 'OPEN_FAILED' as const,
        };
      }
    },
  );

  ipcMain.handle('validationRuns:readVerdict', async (_e, runIdRaw: unknown) => {
    const runId = typeof runIdRaw === 'string' ? runIdRaw.trim() : '';
    if (!runId) {
      return { ok: false as const, error: 'Invalid run id', code: 'NOT_FOUND' as const };
    }
    try {
      return await readValidationVerdictForUi(validationRunStore, runId);
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        code: 'UNREADABLE' as const,
      };
    }
  });

  ipcMain.handle(
    'validationRuns:registerArtifact',
    async (_e, input: ValidationArtifactRegisterInput) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      try {
        const run = await validationRunStore.registerArtifact(input);
        broadcastValidationRunChanged(input.runId);
        return { ok: true as const, run };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('validationPacks:list', async () => {
    const gate = await requireValidationEnabledIpc();
    if (gate) return gate;
    try {
      return { ok: true as const, packs: listValidationPacks() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('validationPacks:get', async (_e, packId: string) => {
    const gate = await requireValidationEnabledIpc();
    if (gate) return gate;
    if (typeof packId !== 'string' || packId.trim().length === 0) {
      return { error: 'Invalid pack id' };
    }
    try {
      const pack = getValidationPackById(packId.trim());
      if (!pack) return { error: `Validation pack not found: ${packId}` };
      return {
        ok: true as const,
        pack: {
          id: pack.manifest.id,
          displayName: pack.manifest.displayName,
          description: pack.manifest.description,
          supportedArtifactKinds: pack.manifest.supportedArtifactKinds,
          defaultInstructions: pack.manifest.defaultInstructions,
          verdictSchemaJson: pack.verdictSchemaJson,
          skillMarkdown: pack.skillMarkdown,
        },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'validationPacks:resolveInstructions',
    async (_e, payload: { packId: string; projectDir?: string }) => {
      const gate = await requireValidationEnabledIpc();
      if (gate) return gate;
      if (typeof payload?.packId !== 'string' || payload.packId.trim().length === 0) {
        return { error: 'Invalid pack id' };
      }
      try {
        const pack = getValidationPackById(payload.packId.trim());
        if (!pack) return { error: `Validation pack not found: ${payload.packId}` };
        const projectDir = payload.projectDir?.trim();
        const projectConfig = projectDir
          ? loadValidationPacksProjectConfig(projectDir, pack.manifest.id)
          : undefined;
        return {
          ok: true as const,
          resolved: resolveValidationPackInstructions(pack, projectConfig),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

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

  ipcMain.handle(
    'planningDocs:delete',
    async (_e, relativePath: unknown): Promise<PlanningDocsDeleteResult> => {
      if (typeof relativePath !== 'string') {
        return { error: 'INVALID_PATH' };
      }
      const result = await activePlanningDocsProvider().delete(relativePath);
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
    'planningDocs:listDeleteCandidates',
    async (_e, projectId: string): Promise<PlanningDocsListDeleteCandidatesResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== projectId) {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      const candidates = await listPlanningDocsDeleteCandidates(planningDir, projectId);
      return { ok: true, candidates };
    },
  );

  ipcMain.handle(
    'planningDocs:recordDeleteSuccess',
    async (_e, payload: PlanningDocsRecordDeleteSuccessPayload): Promise<PlanningDocsRecordDeleteSuccessResult> => {
      const key = appStateStore.get().activeProjectKey;
      if (!key || key.kind !== 'cloud' || key.id !== payload.projectId) {
        return { ok: false, code: 'NOT_ACTIVE_CLOUD' };
      }
      const norm = normalizePlanningDocRelativePath(payload.relativePath);
      if (!norm) return { ok: false, code: 'INVALID_PATH' };
      const planningDir = resolvePlanningDocsDir();
      if (!planningDir) return { ok: false, code: 'NO_PLANNING_DIR' };
      await recordPlanningDocsDeleteSuccess(planningDir, norm);
      return { ok: true };
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
  ipcMain.handle('shell:open', async (_e, sessionId: string, rawOptions?: unknown) => {
    const sessions = await terminalBackend.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`No session for id: ${sessionId}`);
    }
    const placement =
      rawOptions &&
      typeof rawOptions === 'object' &&
      (rawOptions as { placement?: string }).placement === 'local'
        ? ('local' as const)
        : session.deviceKind === 'ssh'
          ? ('remote' as const)
          : ('local' as const);

    let worktreePath = session.worktreePath;
    if (session.deviceKind === 'ssh' && placement === 'local') {
      const projectDir = activeProjectDir();
      const task = taskStore.getAll(session.projectId).find((t) => t.id === session.taskId);
      const localPath = projectDir
        ? await resolveSshLocalWorktreePath({
            projectDir,
            taskId: session.taskId,
            repoId: session.repoId ?? task?.repoId,
            fluxxWorkBranch: session.branch || task?.fluxxWorkBranch,
          })
        : null;
      if (!localPath) {
        throw new Error(
          'Sync to local before opening a local terminal. Local worktree is not available yet.',
        );
      }
      worktreePath = localPath;
    }

    const shell = await terminalBackend.createShell({
      sessionId: session.id,
      worktreePath,
      cols: 80,
      rows: 24,
      placement,
      projectId: session.projectId,
    });
    const sh = process.platform === 'win32'
      ? { command: process.env.COMSPEC ?? 'cmd.exe', args: [] as string[] }
      : { command: process.env.SHELL ?? '/bin/bash', args: ['-l'] as string[] };
    const isRemoteShell = session.deviceKind === 'ssh' && placement === 'remote';
    const shellTerminalRow = withTerminalRuntimeMeta(terminalBackend, shell.id, 'shell', {
      id: shell.id,
      kind: 'shell',
      runtime: isRemoteShell ? 'tmux' : 'node-pty',
      projectId: session.projectId,
      ...(isRemoteShell && session.deviceId
        ? { deviceId: session.deviceId, deviceKind: session.deviceKind, hostLabel: session.deviceLabel }
        : {}),
      cwd: worktreePath,
      command: sh.command,
      args: sh.args,
      cols: 80,
      rows: 24,
      startedAt: shell.startedAt,
      shell: {
        parentSessionId: session.id,
        worktreePath,
      },
    });
    void terminalSessionRecordStore.recordTerminalStart(shellTerminalRow);
    return shell;
  });

  ipcMain.handle('shell:close', async (_e, shellId: string) => {
    void terminalSessionRecordStore.markTerminalEnded(shellId, { reason: 'user-stopped' });
    await terminalBackend.closeShell(shellId);
  });

  ipcMain.handle('shell:list', async (_e, sessionId: string) =>
    terminalBackend.listShells(sessionId),
  );

  ipcMain.handle(
    'shell:attach',
    async (_e, shellId: string): Promise<AttachResult | null> =>
      terminalBackend.attachShell(shellId),
  );

  ipcMain.on('shell:write', (_e, shellId: string, data: string) => {
    terminalBackend.writeShell(shellId, data);
  });

  ipcMain.on('shell:resize', (_e, shellId: string, cols: number, rows: number) => {
    terminalBackend.resizeShell(shellId, cols, rows);
  });

  createWindow();
  if (mainWindow && fluxAutomationRendererBridge) {
    fluxAutomationRendererBridge.attachWindow(mainWindow);
  }

  try {
    await beginTerminalRestore();
  } catch (err) {
    console.warn('[main] terminal restore/reconcile failed during startup', err);
  }

  app.on('before-quit', (e) => {
    if (appQuitTeardownComplete) return;
    e.preventDefault();

    void (async () => {
      try {
        const backend = mainProcessTerminalBackend;
        if (backend) {
          try {
            const quitConfirm = backend.getAppQuitConfirmInfo?.() ?? {
              needsConfirm: await backend.shouldConfirmAppQuit(),
              persistTmuxEnabled: false,
              directPtyCount: 0,
              tmuxBackedCount: 0,
              remoteTmuxBackedCount: 0,
            };
            if (quitConfirm.needsConfirm) {
              const focused = BrowserWindow.getFocusedWindow();
              let quitMessage = 'Quit Fluxx and stop local agents?';
              let quitDetail =
                'Running task agents, terminal panes, and planning sessions in this app will end. ' +
                'Closing only the Fluxx window keeps them running until you fully quit the app (for example from the Dock or File menu).';
              if (quitConfirm.persistTmuxEnabled && quitConfirm.tmuxBackedCount > 0) {
                quitMessage = 'Quit Fluxx?';
                if (quitConfirm.directPtyCount > 0) {
                  quitDetail =
                    'In-app terminals without tmux will stop. Fluxx-owned tmux sessions for task agents, planning assistants, and shell panes will keep running until you stop them from Fluxx or tmux.';
                } else {
                  quitDetail =
                    'Task agents, planning assistants, and terminal panes running in Fluxx-owned tmux sessions will continue. Reopen Fluxx to reattach. Closing only the Fluxx window leaves them running until you fully quit.';
                }
              }
              if ((quitConfirm.remoteTmuxBackedCount ?? 0) > 0) {
                quitMessage = 'Quit Fluxx?';
                const remoteNote =
                  'Direct-SSH task sessions on remote hosts will keep running in tmux. Reopen Fluxx to reattach when the SSH host is reachable.';
                quitDetail = quitDetail.includes('remote hosts')
                  ? quitDetail
                  : quitDetail.endsWith('.')
                    ? `${quitDetail} ${remoteNote}`
                    : `${quitDetail} ${remoteNote}`;
              }
              const messageOpts = {
                type: 'warning' as const,
                buttons: ['Quit', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                title: 'Quit Fluxx?',
                message: quitMessage,
                detail: quitDetail,
              };
              const { response } =
                focused && !focused.isDestroyed()
                  ? await dialog.showMessageBox(focused, messageOpts)
                  : await dialog.showMessageBox(messageOpts);
              if (response === 1) return;
            }
          } catch (err) {
            console.warn('[main] shouldConfirmAppQuit failed', err);
          }
        }

        fluxAutomationServer?.stop();
        fluxAutomationServer = null;
        fluxAutomationToken = null;
        fluxAutomationHostDeps = null;
        planningDocsWatcher?.dispose();
        planningDocsWatcher = null;

        if (backend) {
          try {
            terminalQuitTeardownInProgress = true;
            await Promise.race([
              backend.teardownForAppQuit(APP_QUIT_TERMINAL_TEARDOWN_MS),
              new Promise<void>((resolve) => setTimeout(resolve, APP_QUIT_TERMINAL_TEARDOWN_MS)),
            ]);
          } catch (err) {
            console.warn('[main] teardownForAppQuit failed', err);
          } finally {
            terminalQuitTeardownInProgress = false;
          }
        }

        if (pendingSessionExitWork.size > 0) {
          await Promise.allSettled([...pendingSessionExitWork]);
        }
        await taskAgentSessionRecordStore.whenWriteIdle();
        await planningAgentSessionRecordStore.whenWriteIdle();
        if (validationRunStore) {
          await validationRunStore.whenWriteIdle();
        }

        appQuitTeardownComplete = true;
        app.quit();
      } catch (err) {
        console.error('[main] before-quit handler failed', err);
        appQuitTeardownComplete = true;
        app.quit();
      }
    })();
  });
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
    if (mainWindow && fluxAutomationRendererBridge) {
      fluxAutomationRendererBridge.attachWindow(mainWindow);
    }
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can put them in the end of other files and import them here.
