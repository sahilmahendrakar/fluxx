export type TaskStatus =
  | 'backlog'
  | 'in-progress'
  | 'needs-input'
  | 'validation'
  | 'review'
  | 'done';

/** Where a normalized short branch name exists in the clone; see `classifyGitBranchPresence`. */
export type GitBranchPresence = 'local' | 'remote' | 'both' | 'missing';

export type Agent = 'claude-code' | 'codex' | 'cursor';

/** Per-CLI default `--model` for planning or new tasks (stored on project / binding). */
export type AgentSessionModelDefaults = Partial<Record<'claude-code' | 'codex' | 'cursor', string>>;

/** Partial update for {@link LocalProject} / cloud binding agent spawn defaults. */
export type AgentSpawnDefaultsPatch = {
  planningModels?: Partial<AgentSessionModelDefaults>;
  planningAgentYolo?: boolean;
  taskDefaultModels?: Partial<AgentSessionModelDefaults>;
  defaultTaskAgentYolo?: boolean;
};

export type ActiveProjectKind = 'local' | 'cloud';

/** Remembered active workspace (local folder vs cloud Firestore project). */
export interface ActiveProjectKey {
  kind: ActiveProjectKind;
  id: string;
}

/**
 * Tab-strip restoration state — per project, remember which workspace
 * tabs were open and which was active. Planning fields mirror the same pattern.
 *
 * `openTaskIds` stores **daemon session ids** (workspace/session tabs), not Flux task ids.
 */
export interface ProjectTabState {
  /** Open workspace tabs, keyed by daemon `Session.id` (historical name `openTaskIds`). */
  openTaskIds: string[];
  activeTaskId: string | null;
  /** Planning sessions that have a main-window tab (`plan:<sessionId>`). */
  openPlanningTabIds?: string[];
  /** Selected planning session in the board sidebar strip. */
  planningSidebarActiveSessionId?: string | null;
  /**
   * User intent: planning strip should be open on the board (survives Docs / Settings /
   * task tab; cleared on explicit dismiss). Absent on disk means false.
   */
  planningSidebarOpen?: boolean;
  /**
   * Daemon session ids hidden from the Task Workspaces sidebar (minimize). Sessions
   * stay running; reopen from the board or a tab clears the id from this set.
   */
  minimizedTaskWorkspaceIds?: string[];
}

/** Task workspace tab identity for restore placeholders before live SSH reconcile. */
export interface RestorableTaskSessionRef {
  sessionId: string;
  taskId: string;
}

/** Live plus cold-resumable session ids for tab-strip restore (per active project). */
export interface RestorableSessionIds {
  taskSessionIds: string[];
  planningSessionIds: string[];
  taskSessionRefs?: RestorableTaskSessionRef[];
}

/**
 * Main → renderer: branch names for the active repo (short names; `remoteBranches`
 * entries may be `origin/foo` — normalizers strip the prefix).
 */
export interface RepoBranchDiscovery {
  defaultBranchShort: string;
  localBranches: string[];
  remoteBranches: string[];
}

export type RepoBranchDiscoveryResponse = RepoBranchDiscovery & {
  /** Present when the renderer passed a branch string to classify in the same round trip. */
  classification?: {
    raw: string;
    normalizedShort: string;
    presence: GitBranchPresence;
  };
};

/**
 * IPC payload for `repo:getBranchDiscovery`.
 * Back-compat: main still accepts a bare string meaning `classifyBranch` only (primary repo).
 */
export type RepoBranchDiscoveryRequest = {
  repoId?: string;
  classifyBranch?: string;
};

/** Fields editable through project repo settings IPC (by root path or repo id). */
export type RepoSettingsPatch = Partial<
  Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env' | 'envFiles' | 'name'>
>;

/**
 * Root-level env filenames Fluxx may auto-detect in v1 (repo root only).
 * Excludes templates, production, and nested monorepo paths.
 */
export type RepoEnvFileName =
  | '.env'
  | '.env.local'
  | '.env.development'
  | '.env.development.local'
  | '.env.test';

/** User preference for whether a detected env file is copied into new worktrees. */
export type RepoEnvFileEnablement = 'enabled' | 'disabled';

export type RepoEnvFilePresence = 'found' | 'missing';

/**
 * Persisted per-file preference (local config / machine binding only — never Firestore).
 * Does not include secret file contents.
 */
export interface RepoEnvFileSource {
  fileName: RepoEnvFileName;
  enablement: RepoEnvFileEnablement;
}

/**
 * Local-only env file source metadata for a bound repo clone.
 * {@link RepoConfig.env} legacy pasted contents remain supported until migrated.
 */
export interface RepoEnvFileSourcesConfig {
  sources?: RepoEnvFileSource[];
  /** ISO timestamp of the last filesystem scan used to refresh detection metadata. */
  lastDetectedAt?: string;
}

/**
 * Ephemeral detection row for one allowlisted root env file (never includes file body).
 */
export interface RepoEnvFileDetectionEntry {
  fileName: RepoEnvFileName;
  /** Absolute path at the repo root. */
  sourcePath: string;
  presence: RepoEnvFilePresence;
  enablement: RepoEnvFileEnablement;
  sizeBytes?: number;
  modifiedAt?: string;
  /** SHA-256 hex digest of file bytes when {@link presence} is `found`. */
  contentHash?: string;
}

/** Root-only env scan for one repository clone. */
export interface RepoEnvFileDetectionResult {
  repoRoot: string;
  detectedAt: string;
  files: RepoEnvFileDetectionEntry[];
  /** True when legacy {@link RepoConfig.env} pasted content is still active. */
  legacyPastedEnvActive: boolean;
}

/**
 * Per-repo configuration stored locally. The schema supports multiple repos
 * per project (see `multi-repo2` feature flag); today the list always has
 * length 1 (matching `Project.rootPath`).
 *
 * `id` is the **stable identity** for a repo within a project — never use
 * `rootPath` as identity since users move clones around. Legacy single-repo
 * configs are migrated on load to a deterministic primary id derived from
 * the project (see `deriveStablePrimaryRepoIdForProject` in
 * `src/repoIdentity.ts`). `name` is a human-readable display label —
 * defaults to `path.basename(rootPath)` when missing.
 */
export interface RepoConfig {
  /** Stable identity within a project (NOT `rootPath`). Backfilled by `multi-repo2` migrations. */
  id: string;
  /** Human-readable label; falls back to `basename(rootPath)`. */
  name?: string;
  rootPath: string;
  /** Branch fetched + used as base for new task worktrees. Default: 'main'. */
  baseBranch: string;
  /** Optional shell script run inside each new worktree after `git worktree add`. */
  setupScript?: string;
  /**
   * Optional pasted .env contents written to `<worktree>/.env` for each new task.
   * Prefer {@link envFiles} once migrated; kept for back-compat.
   */
  env?: string;
  /**
   * Root-level env file sources on this machine (not synced for cloud projects).
   * Never stores raw secret file contents — only filenames and enablement.
   */
  envFiles?: RepoEnvFileSourcesConfig;
}

export type RepoPathStatus = 'valid' | 'missing' | 'not_git';

export interface RepoManagementState {
  pathStatus: RepoPathStatus;
  removalBlocked: boolean;
  blockingTaskCount: number;
  blockingWorkspaceCount: number;
}

/** Local clone + path check for one shared cloud repo (multi-repo2 settings / IPC). */
export type CloudRepoLocalBindingStatus =
  | { kind: 'missing_binding' }
  | { kind: 'bound'; rootPath: string; pathStatus: RepoPathStatus };

export type CloudRepoBindingOverview = Record<string, CloudRepoLocalBindingStatus>;

/** Per SSH device + repo: existing folder on the remote host (local-only, not synced). */
export interface RemoteRepoBinding {
  remotePath: string;
  boundAt: string;
  lastValidatedAt?: string;
}

/** `deviceId → repoId → binding` stored in local project config or cloud localBindings.json. */
export type RemoteRepoBindingsByDevice = Record<string, Record<string, RemoteRepoBinding>>;

export type RemoteRepoBindingStatus =
  | { kind: 'unbound' }
  | {
      kind: 'bound';
      remotePath: string;
      hostLabel: string;
      boundAt: string;
      lastValidatedAt?: string;
    };

export type RemoteRepoBindingsOverview = Record<string, RemoteRepoBindingStatus>;

export interface LocalProject {
  id: string;
  kind: 'local';
  name: string;
  rootPath: string;
  addedAt: string;
  planningAgent: Agent;
  defaultTaskAgent: Agent;
  /** Default `--model` per CLI for planning spawns (empty claude = CLI default). */
  planningModels?: AgentSessionModelDefaults;
  /** Planning spawn: Cursor `--yolo` / Claude `--dangerously-skip-permissions` when true. */
  planningAgentYolo?: boolean;
  /** Default `--model` per CLI for new tasks (when task row does not set agentModel). */
  taskDefaultModels?: AgentSessionModelDefaults;
  /** New tasks inherit `agentYolo` when true unless explicitly overridden. */
  defaultTaskAgentYolo?: boolean;
  /** Auto-start a task session when status moves from Backlog to in-progress. */
  autoStartSessionOnInProgress: boolean;
  /** When enabled, Flux may auto-accept Claude/Cursor/Codex trust prompts in Flux-owned worktrees and the planning directory only. */
  autoRespondToTrustPrompts: boolean;
  /** When on, a task in backlog (or in progress without a running session) may auto-start once its last blocker is completed. */
  autoStartWhenUnblocked: boolean;
  /**
   * When on, completing a task (status → done) runs workspace cleanup (same as the broom on
   * the Done card): worktrees removed and agent sessions stopped; the task stays in Done.
   */
  autoCleanupWorkspaceWhenDone: boolean;
  /**
   * When on, refreshing linked GitHub PR metadata that shows the PR merged can move the task
   * to Done from In progress, Needs input, or Review (not backlog), if it is not dependency-blocked.
   */
  autoMarkDoneWhenPrMerged: boolean;
  /**
   * When on, refreshing PR metadata (or creating a PR) that shows an open GitHub PR for this
   * task’s Flux branch may move the task from Backlog or In progress into Review.
   */
  autoMoveToReviewWhenPrOpen: boolean;
  /**
   * When on, new terminals run in Fluxx-owned tmux sessions (local machine only).
   * See `docs/tmux-terminal-persistence-plan.md`.
   */
  persistTerminalsWithTmux: boolean;
  /** Optional override of the global default device for new tasks in this project. */
  defaultDeviceId?: string;
  /**
   * Per SSH device, per-repo folder on the remote host for task workspaces.
   * Private to this Desktop install; not synced for cloud projects.
   */
  remoteRepoBindings?: RemoteRepoBindingsByDevice;
  /**
   * When on, Electron Playwright validation (runs, validator sessions, planning validation guidance).
   * Default off; opt in via Project settings → Experimental.
   */
  validationEnabled: boolean;
  repos: RepoConfig[];
}

/**
 * Shared team metadata for one logical repository in a cloud project (Firestore).
 * Does not include machine-local paths or `.env` / setup scripts — those stay in
 * {@link CloudProjectLocalBinding} / {@link RepoConfig}.
 */
export interface CloudSharedRepo {
  /** Stable identity within the cloud project (matches keys in `repoBindings`). */
  id: string;
  /** Display label for lists and headers. */
  name: string;
  /** Branch used as the integration line for tasks / PRs (informational for cloud). */
  baseBranch: string;
  /** Optional origin URL for display / validation. */
  remoteUrl?: string;
}

/**
 * Per-machine clone location for one {@link CloudSharedRepo.id} (localBindings.json only).
 */
export interface CloudRepoMachineBinding {
  rootPath: string;
  lastOpenedAt: string;
  /**
   * Per-machine env file source prefs for this clone (localBindings.json only).
   * When set, takes precedence over any `envFiles` row in the project `config.json` repo entry.
   */
  envFiles?: RepoEnvFileSourcesConfig;
}

/**
 * Per-machine record in `localBindings.json`. Optional fields are per-user prefs
 * for that cloud project (not synced).
 */
export interface CloudProjectLocalBinding {
  /**
   * Legacy single-repo clone path. Migrated into `repoBindings` under a stable
   * primary id (`deriveStablePrimaryRepoIdForProject`) and then omitted on save.
   */
  rootPath?: string;
  /** Updated when the binding row is touched; mirrors the primary repo entry where applicable. */
  lastOpenedAt: string;
  /**
   * Which shared repo supplies {@link CloudProject.rootPath} / workspace layout when several
   * repos are bound. Usually inferred when only one `repoBindings` entry exists.
   */
  primaryRepoId?: string;
  /** Per-repo local clone paths keyed by {@link CloudSharedRepo.id}. */
  repoBindings?: Record<string, CloudRepoMachineBinding>;
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress?: boolean;
  autoRespondToTrustPrompts?: boolean;
  autoStartWhenUnblocked?: boolean;
  autoCleanupWorkspaceWhenDone?: boolean;
  autoMarkDoneWhenPrMerged?: boolean;
  autoMoveToReviewWhenPrOpen?: boolean;
  /** Per-machine: persist terminals with tmux across full app quit. */
  persistTerminalsWithTmux?: boolean;
  /** Optional override of the global default device for new tasks in this cloud project. */
  defaultDeviceId?: string;
  /**
   * Per-task direct-SSH (or local) device overrides for this Desktop user only.
   * Keyed by cloud task id; not synced to teammates.
   */
  perTaskDeviceOverrides?: Record<string, TaskExecutionDeviceRef>;
  /**
   * Per SSH device, per shared repo id: existing folder on the remote host.
   * Private to this Desktop user; not written to Firestore.
   */
  remoteRepoBindings?: RemoteRepoBindingsByDevice;
  /** @deprecated Read `autoCleanupWorkspaceWhenDone`; kept for localBindings migration. */
  autoDeleteTaskWhenDone?: boolean;
  /**
   * Team-wide validation opt-in (Firestore). Mirrored to the cloud project `config.json`
   * on this machine for CLI/automation guards.
   */
  validationEnabled?: boolean;
}

/** Renderer-facing cloud workspace: Firestore metadata plus local clone map per shared repo id. */
export interface CloudProject {
  id: string;
  kind: 'cloud';
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  /**
   * Primary workspace root for layout, tasks, and worktrees — the bound clone for
   * the primary shared repo (multi-repo2: same as `repoMachineBindings[primary]`).
   */
  rootPath: string;
  /** Shared repo list from Firestore; may be synthesized when the doc has none yet. */
  sharedRepos: CloudSharedRepo[];
  /**
   * Local clone per shared repo id on this machine. Keys omitted when that repo
   * has no binding yet (multi-repo team projects).
   */
  repoMachineBindings: Partial<Record<string, CloudRepoMachineBinding>>;
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress?: boolean;
  autoRespondToTrustPrompts?: boolean;
  autoStartWhenUnblocked?: boolean;
  autoCleanupWorkspaceWhenDone?: boolean;
  autoMarkDoneWhenPrMerged?: boolean;
  autoMoveToReviewWhenPrOpen?: boolean;
  persistTerminalsWithTmux?: boolean;
  defaultDeviceId?: string;
  /** @deprecated */
  autoDeleteTaskWhenDone?: boolean;
  /** Electron Playwright validation opt-in (team setting from Firestore). */
  validationEnabled?: boolean;
}

export type Project = LocalProject | CloudProject;

/** Unified durable terminal inventory (`<projectDir>/terminal-sessions.json`). */
export type TerminalKind = 'task' | 'planning' | 'shell';
export type TerminalRuntime = 'node-pty' | 'tmux';

export type TerminalEndedReason =
  | 'agent-exit-ok'
  | 'agent-exit-error'
  | 'shell-exit-ok'
  | 'shell-exit-error'
  | 'app-quit'
  | 'tmux-missing'
  | 'device-unreachable'
  | 'helper-mismatch'
  | 'workspace-deleted'
  | 'replaced-by-new-session'
  | 'user-stopped'
  | 'user-archived';

/** Remote SSH session health after restore/reconcile (Desktop-attached direct SSH only). */
export type RemoteSessionLifecycleStatus =
  | 'device-unreachable'
  | 'tmux-missing'
  | 'helper-mismatch'
  | 'workspace-missing';

/** Renderer toast payload when startup SSH reconcile cannot reach a device. */
export type SshReconcileDeviceFailureNotice = {
  deviceId: string;
  displayName: string;
  message: string;
};

/** Phase where branch-based SSH→local sync failed or completed. */
export type RemoteSshSyncPhase =
  | 'remote-status'
  | 'remote-push'
  | 'local-fetch'
  | 'local-worktree'
  | 'conflict-check'
  | 'complete';

export type RemoteSshSyncErrorCode =
  | 'NOT_SSH_SESSION'
  | 'DEVICE_NOT_CONFIGURED'
  | 'REMOTE_STATUS_FAILED'
  | 'REMOTE_PUSH_FAILED'
  | 'LOCAL_REPO_NOT_BOUND'
  | 'LOCAL_FETCH_FAILED'
  | 'LOCAL_DIRTY_CONFLICT'
  | 'LOCAL_BRANCH_DIVERGED'
  | 'LOCAL_WORKTREE_FAILED'
  | 'INTERNAL';

/** Persisted per-task SSH branch sync metadata (project-local, not synced). */
export interface RemoteSshSyncMetadata {
  lastSyncedAt: string;
  lastSyncedCommit: string;
  deviceId: string;
  remoteBranch: string;
  remoteHasUnsyncedChanges: boolean;
  localWorktreePath: string;
}

/** Where a task shell PTY runs for SSH sessions (remote tmux vs local synced worktree). */
export type ShellPlacement = 'remote' | 'local';

export type ShellOpenOptions = {
  placement?: ShellPlacement;
};

/** Placeholders for a future dirty-workspace snapshot sync over SSH. */
export type RemoteSshDirtySnapshotHooks = {
  baseCommit: string;
  binaryDiffCommand: string;
  untrackedArchiveSupported: boolean;
  conflictSafeApplyPlanned: boolean;
};

export type RemoteSshSyncResult =
  | {
      ok: true;
      phase: 'complete';
      localWorktreePath: string;
      branch: string;
      headCommit: string;
      metadata: RemoteSshSyncMetadata;
      dirtySnapshotHooks?: RemoteSshDirtySnapshotHooks;
    }
  | {
      ok: false;
      phase: RemoteSshSyncPhase;
      error: RemoteSshSyncErrorCode;
      message: string;
      recovery?: string;
    };

export interface TerminalSessionRecord {
  id: string;
  kind: TerminalKind;
  runtime: TerminalRuntime;
  projectId: string;
  repoId?: string;
  /** Direct-SSH sessions: Fluxx desktop device id that owns the remote manifest row. */
  deviceId?: string;
  deviceKind?: TaskExecutionDeviceKind;
  hostLabel?: string;
  tmuxSessionName?: string;
  cwd: string;
  command: string;
  args: string[];
  cols: number;
  rows: number;
  startedAt: string;
  endedAt?: string;
  endedReason?: TerminalEndedReason;
  task?: {
    taskId: string;
    agent: Agent;
    worktreePath: string;
    fluxxWorkBranch: string;
    sourceBranchShort?: string;
    agentConversationId?: string;
  };
  planning?: {
    agent: Agent;
    planningDir: string;
    agentModel?: string;
    agentYolo?: boolean;
    agentConversationId?: string;
  };
  shell?: {
    parentSessionId: string;
    worktreePath: string;
  };
}

export interface TerminalSessionsFileV1 {
  version: 1;
  terminals: TerminalSessionRecord[];
}

/** Main-process diagnostic: live PTYs vs open manifest rows. */
export interface TerminalInventorySnapshot {
  live: {
    taskSessions: number;
    planningSessions: number;
    shells: number;
    total: number;
  };
  persistedOpen: {
    taskSessions: number;
    planningSessions: number;
    shells: number;
    total: number;
  };
  byProject: Array<{
    projectId: string;
    projectDir: string;
    taskSessions: number;
    planningSessions: number;
    shells: number;
  }>;
  byWorkspace: Array<{
    projectId: string;
    taskId?: string;
    worktreePath?: string;
    planningDir?: string;
    terminalIds: string[];
    tmuxSessionNames: string[];
  }>;
}

export type TaskGithubPrState = 'open' | 'closed' | 'merged';

/** One planning markdown doc attached to a task (paths are relative to the project `planning/` root). */
export interface TaskAttachedPlanningDoc {
  relativePath: string;
}

/** Task-specific validation plan for the validator agent (separate from implementation description). */
export interface TaskValidationPlan {
  goal: string;
  pack: 'electron-playwright';
  checks: string[];
  requiredArtifacts: string[];
  risks?: string[];
  notes?: string;
}

/** GitHub pull request linked to a task (persisted locally and in Firestore). */
export interface TaskGithubPr {
  url: string;
  number?: number;
  state?: TaskGithubPrState;
  mergedAt?: string;
  headBranch?: string;
  baseBranch?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Structured errors from task PR IPC (`tasks:requestPullRequestFromAgent`, `tasks:refreshPullRequest`). */
export type TaskPrErrorCode =
  | 'NO_PROJECT'
  | 'NO_WORKTREE'
  | 'NO_AGENT_SESSION'
  | 'AGENT_SESSION_NOT_RUNNING'
  | 'NO_PR_URL'
  /** No PR on GitHub for the task branch (legacy IPC id; discovery includes merged/closed). */
  | 'NO_OPEN_PR'
  | 'TASK_METADATA_REQUIRED'
  | 'GH_NOT_INSTALLED'
  | 'GH_AUTH_FAILED'
  | 'NO_GITHUB_REMOTE'
  | 'BRANCH_PUSH_FAILED'
  | 'PR_CREATE_FAILED'
  | 'PR_VIEW_FAILED'
  | 'PR_REPO_MISMATCH'
  | 'PR_BASE_BRANCH_MISSING_REMOTE'
  | 'PR_BASE_BRANCH_PUSH_FAILED';

export type TaskPullRequestIpcResult =
  | {
      ok: true;
      githubPr: TaskGithubPr;
      persisted: boolean;
      /** True when the base branch was pushed to origin so the PR could be opened. */
      pushedBaseBranch?: boolean;
      /** Human-readable note when GitHub ref names differ from stored PR metadata (refresh only). */
      metadataMismatchWarning?: string;
    }
  | { ok: false; code: TaskPrErrorCode; message: string };

/** Result of `tasks:requestPullRequestFromAgent` (prompt injected; no `gh pr create` in main). */
export type TaskRequestPullRequestFromAgentResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: TaskPrErrorCode; message: string };

/** IPC payload for `tasks:requestPullRequestFromAgent` (renderer may supply branch/repo when main has no local task row). */
export type TaskRequestPullRequestFromAgentPayload = {
  taskId: string;
  title?: string;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  repoId?: string;
};

/** Where a task session should run (`local` and `ssh` in v1; reserved for future runners). */
export type TaskExecutionDeviceKind = 'local' | 'ssh' | 'runner' | 'managed-cloud';

/** Task-level execution target selection (snapshotted at task creation for auto-start). */
export interface TaskExecutionDeviceRef {
  kind: TaskExecutionDeviceKind;
  deviceId: string;
  /** Future shared runner/cloud targets; not used for direct-SSH v1. */
  ownerUid?: string;
}

/** When `enabled`, Fluxx must use tmux on this device and must not fall back to non-tmux PTYs. */
export interface ExecutionDeviceTmuxSettings {
  enabled: boolean;
}

export interface ExecutionDeviceSshConfig {
  host: string;
  user?: string;
  port?: number;
  /** When true, pass `-o ForwardAgent=yes` so Git on the remote can use this Mac's ssh-agent keys. */
  forwardAgent?: boolean;
  extraArgs?: string[];
  connectTimeoutSeconds?: number;
}

export type DeviceProbeStatus = 'unknown' | 'available' | 'unavailable' | 'probing';

/** Structured probe / SSH transport errors surfaced in Devices UI and session start. */
export type DeviceProbeErrorCode =
  | 'SSH_CONNECT_FAILED'
  | 'SSH_HOST_KEY_FAILED'
  | 'SSH_AUTH_FAILED'
  | 'SSH_TIMEOUT'
  | 'SSH_HELPER_MISSING'
  | 'SSH_HELPER_VERSION_MISMATCH'
  | 'SSH_HELPER_BOOTSTRAP_FAILED'
  | 'REMOTE_TMUX_MISSING'
  | 'REMOTE_GIT_MISSING'
  | 'REMOTE_AGENT_NOT_FOUND'
  | 'REMOTE_WORKSPACE_UNWRITABLE'
  | 'REMOTE_REPO_ACCESS_FAILED'
  | 'INTERNAL';

export interface DeviceProbeAgentCapability {
  command: string;
  found: boolean;
  path?: string;
  version?: string;
}

export interface DeviceProbeRepoCapability {
  repoId: string;
  label?: string;
  remoteUrl?: string;
  accessible: boolean;
  error?: string;
}

export interface DeviceProbeCapabilities {
  os?: string;
  arch?: string;
  shell?: string;
  git?: { found: boolean; path?: string; version?: string };
  tmux?: { found: boolean; path?: string; version?: string };
  workspaceRoot?: { path: string; writable: boolean };
  agents?: DeviceProbeAgentCapability[];
  repos?: DeviceProbeRepoCapability[];
}

export interface DeviceProbeResult {
  status: DeviceProbeStatus;
  checkedAt: string;
  message?: string;
  errorCode?: DeviceProbeErrorCode;
  /** Failing step label, e.g. `ssh-connect`, `helper-bootstrap`, `probe-tmux`. */
  phase?: string;
  capabilities?: DeviceProbeCapabilities;
  helperVersion?: string;
}

/** Input for creating an SSH device in the global registry. */
export type SshExecutionDeviceUpsertInput = {
  displayName: string;
  host: string;
  user?: string;
  port?: number;
  workspaceRoot: string;
  tmuxEnabled: boolean;
  forwardAgent?: boolean;
  shell?: string;
  extraArgs?: string[];
  connectTimeoutSeconds?: number;
};

/** Patch for updating a device (SSH fields ignored for built-in local). */
export type ExecutionDeviceUpdateInput = Partial<SshExecutionDeviceUpsertInput> & {
  displayName?: string;
  enabled?: boolean;
};

/** Per-machine device record in `userData/executionDevices.json`. */
export interface ExecutionDeviceConfig {
  id: string;
  kind: 'local' | 'ssh';
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastProbe?: DeviceProbeResult;
  tmux: ExecutionDeviceTmuxSettings;
  workspaceRoot: string;
  shell?: string;
  ssh?: ExecutionDeviceSshConfig;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** `null` = no coding agent assigned yet (no session until a real agent is chosen). */
  agent: Agent | null;
  /**
   * Model for the session: Cursor Agent (`agent --model`, default `auto` when
   * unset), or Claude Code (`claude --model` — omitted when unset/empty so the
   * CLI default applies). Ignored for Codex until supported.
   */
  agentModel?: string;
  /**
   * Fewer permission prompts for tools: Cursor Agent → `--yolo` / `--force`;
   * Claude Code → `--dangerously-skip-permissions` (strong; see CLI help).
   * Ignored for Codex until supported.
   */
  agentYolo?: boolean;
  description?: string;
  /** Optional feature or grouping tags (trimmed, empty dropped, case-insensitive dedupe on write). */
  labels?: string[];
  createdAt: string;
  projectId: string;
  /** Fractional ranking key for stable drag ordering within a column. */
  orderKey?: string;
  /** Set after a successful workspace cleanup while the task remains in Done. */
  workspaceCleanedAt?: string;
  /** Cloud-only: uid of the user who created the task. */
  createdBy?: string;
  /** Cloud-only. */
  updatedAt?: string;
  /** Cloud-only: uid of the user who last updated the task. */
  updatedBy?: string;
  /**
   * Cloud-only: uid of the human assignee (multi-user board). Omitted when
   * unassigned. MCP tools may pass assigneeEmail, which resolves to this id.
   */
  assigneeId?: string | null;
  /** Task ids in the same project that must be `done` before this task is unblocked. */
  blockedByTaskIds?: string[];
  /**
   * When-unblocked session auto-start override: `true` forces on, `false` forces off (e.g. opt out
   * while the project default is on). When omitted, the task inherits the project “when unblocked”
   * default (which only applies when the task has an assignee on cloud boards).
   */
  autoStartOnUnblock?: boolean;
  /**
   * Git branch this task is logically based on (PR merge target / conceptual base).
   * Distinct from {@link Session.branch}, which is the Flux task worktree branch
   * (historically `fluxx/task-<id>`, now usually `<git-author-slug>/<title-slug>`).
   * When omitted on legacy rows, treat as the project default (`RepoConfig.baseBranch` / detected default).
   */
  sourceBranch?: string;
  /**
   * When the requested {@link Task.sourceBranch} does not exist yet, Flux may create it
   * from the project default branch on first session start. Persist `false` when the branch
   * was chosen from discovery (already exists), and `true` when the user typed a new name.
   */
  createSourceBranchIfMissing?: boolean;
  /**
   * Identity of the {@link RepoConfig} this task belongs to (multi-repo2). Optional on
   * legacy rows — readers should resolve missing values to the project's primary repo
   * (see `resolvePrimaryRepoId` in `src/repoIdentity.ts`). Backfilled by
   * `TaskStore.migrateMissingRepoIds` on first load.
   */
  repoId?: string;
  /**
   * Flux task work branch persisted after the first successful worktree creation
   * (`<author-slug>/<title-slug>` with optional collision suffix). Omitted on older
   * tasks: treat as the legacy `fluxx/task-<id>` pattern from `src/main/fluxxTaskBranch.ts`.
   */
  fluxxWorkBranch?: string;
  /** Linked GitHub PR metadata (optional). */
  githubPr?: TaskGithubPr;
  /**
   * Normalized planning markdown paths (under the project `planning/` directory).
   * Omitted when none; persisted locally and in Firestore for cloud tasks.
   */
  attachedPlanningDocs?: TaskAttachedPlanningDoc[];
  /**
   * Where this task should run. Local projects persist on the task row; cloud
   * projects store private `local`/`ssh` refs in `localBindings.json` overrides.
   */
  executionDevice?: TaskExecutionDeviceRef;
  /**
   * Optional structured validation plan for the validator agent.
   * Stored separately from {@link Task.description}.
   */
  validationPlan?: TaskValidationPlan;
}

export type SessionStatus = 'idle' | 'running' | 'stopped' | 'error' | 'interrupted';

export type SessionStartErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'NO_TASK_AGENT'
  | 'WORKTREE_FAILED'
  /** Source ref missing and {@link Task.createSourceBranchIfMissing} is false (or branch exists only remotely but could not be materialized). */
  | 'WORKTREE_SOURCE_BRANCH_MISSING'
  /** Local and `origin/<branch>` both exist but point at different commits. */
  | 'WORKTREE_SOURCE_BRANCH_AMBIGUOUS'
  /** `git branch` to create the missing source branch failed. */
  | 'WORKTREE_SOURCE_BRANCH_CREATE_FAILED'
  /** Project default / `RepoConfig.baseBranch` could not be resolved to create a missing source branch. */
  | 'WORKTREE_BASE_BRANCH_UNAVAILABLE'
  /** A required `git fetch` for the project default branch failed and no local base ref was available. */
  | 'WORKTREE_FETCH_FAILED'
  /** Empty branch name after normalization, or repo in a state that cannot supply a base ref. */
  | 'WORKTREE_REPO_INVALID_STATE'
  /** Task targets a repo id that does not exist on this project configuration. */
  | 'WORKTREE_REPO_UNKNOWN'
  /** The configured clone path is missing from disk (moved/unmounted folder). */
  | 'WORKTREE_REPO_PATH_MISSING'
  /** Clone path exists but does not contain a `.git` directory or file (not a repo). */
  | 'WORKTREE_REPO_NOT_GIT'
  /** Cloud project: shared repo exists but no local clone is bound on this machine. */
  | 'WORKTREE_REPO_NOT_BOUND'
  | 'DEVICE_NOT_CONFIGURED'
  | 'DEVICE_UNAVAILABLE'
  | 'SSH_CONNECT_FAILED'
  | 'SSH_HELPER_MISSING'
  | 'SSH_HELPER_VERSION_MISMATCH'
  | 'REMOTE_TMUX_MISSING'
  | 'REMOTE_GIT_MISSING'
  | 'REMOTE_AGENT_NOT_FOUND'
  | 'REMOTE_WORKSPACE_UNWRITABLE'
  | 'REMOTE_REPO_ACCESS_FAILED'
  | 'REMOTE_NON_GIT_UNSUPPORTED'
  | 'REMOTE_SETUP_FAILED'
  | 'TASK_BLOCKED'
  | 'NOT_TASK_ASSIGNEE'
  | 'INTERNAL';

/** Optional flags for `session:start` / `sessions.start`. */
export type SessionStartOptions = {
  /**
   * When true, Flux spawns the task agent with CLI `--resume` only (no full
   * initial task prompt). Requires a stable worktree cwd matching the CLI’s
   * on-disk session key.
   */
  resume?: boolean;
};

export type SessionStartResult =
  | Session
  | {
      error: SessionStartErrorCode;
      message: string;
      blockerIds?: string[];
      blockers?: { id: string; title: string }[];
    };

/** Main→renderer: worktree + daemon spawn in progress for a task session. */
export type TaskSessionStartProgress =
  | { taskId: string; phase: 'starting' }
  | { taskId: string; phase: 'settled'; outcome: SessionStartResult };

export interface Session {
  id: string;
  taskId: string;
  projectId: string;
  /**
   * Identity of the {@link RepoConfig} the session's worktree was created from
   * (multi-repo2). Optional on rows from older daemon responses — renderers must
   * not crash on absence; treat missing as the active primary repo where needed
   * (see `resolvePrimaryRepoId` in `src/repoIdentity.ts`).
   */
  repoId?: string;
  worktreePath: string;
  branch: string;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
  /**
   * When the CLI exposes a resumable id and Flux captured it from PTY output,
   * main may attach it to the live {@link Session} row for UI hints.
   */
  agentConversationId?: string;
  /** Execution device that owns this session (direct SSH v1). */
  deviceId?: string;
  deviceKind?: TaskExecutionDeviceKind;
  deviceLabel?: string;
  /** Remote worktree path when {@link Session.deviceKind} is `ssh`. */
  remotePath?: string;
  /** Set when a direct-SSH session cannot attach after restore (host offline, missing tmux, etc.). */
  remoteLifecycleStatus?: RemoteSessionLifecycleStatus;
  /** Validator PTY for a validation run — not a task implementation workspace. */
  kind?: 'task' | 'validator';
}

/** Persisted metadata for task agent PTY sessions (cold resume, audit). */
export type TaskAgentSessionEndedReason =
  | 'agent-exit-ok'
  | 'agent-exit-error'
  | 'app-quit'
  | 'tmux-missing'
  | 'device-unreachable'
  | 'helper-mismatch'
  | 'workspace-deleted'
  | 'replaced-by-new-session'
  | 'user-archived';

/** One durable row per logical Flux task session (survives app restart). */
export interface TaskAgentSessionRecord {
  fluxxSessionId: string;
  taskId: string;
  projectId: string;
  repoId?: string;
  agent: Agent;
  worktreePath: string;
  fluxxWorkBranch: string;
  sourceBranchShort?: string;
  startedAt: string;
  endedAt?: string;
  endedReason?: TaskAgentSessionEndedReason;
  /** Parsed from CLI output when available (Claude / Cursor). */
  agentConversationId?: string;
  /** Direct-SSH rows: device that owns the remote tmux session. */
  deviceId?: string;
  deviceKind?: TaskExecutionDeviceKind;
  deviceLabel?: string;
}

/** Persisted metadata for planning assistant PTY sessions (cold resume). */
export type PlanningAgentSessionEndedReason =
  | 'agent-exit-ok'
  | 'agent-exit-error'
  | 'app-quit'
  | 'tmux-missing'
  | 'replaced-by-new-session'
  | 'user-archived';

/** One durable row per logical Flux planning session (survives app restart). */
export interface PlanningAgentSessionRecord {
  fluxxSessionId: string;
  projectId: string;
  agent: Agent;
  planningDir: string;
  startedAt: string;
  endedAt?: string;
  endedReason?: PlanningAgentSessionEndedReason;
  /** Parsed from CLI output when available (Claude / Cursor). */
  agentConversationId?: string;
  agentModel?: string;
  agentYolo?: boolean;
}

/** Result of probing whether `tmux` is available on PATH for this machine. */
export type TmuxAvailability = {
  available: boolean;
  /** Human-readable detail when unavailable (missing binary, unsupported platform, etc.). */
  message?: string;
};

/** Where to open a task worktree folder from the main process (`workspace:openPath`). */
export type OpenWorkspaceTarget = 'cursor' | 'vscode' | 'terminal' | 'file-manager';

/** Payload for `workspace:resolveTaskWorktree` — bare string is legacy (`taskId` only). */
export type ResolveTaskWorktreeIpcPayload =
  | string
  | { taskId: string; repoId?: string | null; fluxxWorkBranch?: string | null };

/**
 * Structured failure when no on-disk/session path exists — distinguishes missing clone
 * binding from “repo ok but no worktree yet” (`multi-repo2`).
 */
export type ResolveTaskWorktreeDetailCode =
  | 'no-project-dir'
  | 'repo-unknown'
  | 'repo-not-bound'
  | 'repo-path-missing'
  | 'repo-not-git'
  | 'no-worktree';

/** Result of `workspace:resolveTaskWorktree` (path null when nothing exists yet or repo unavailable). */
export type ResolveTaskWorktreeIpcResult = {
  path: string | null;
  detail?: { code: ResolveTaskWorktreeDetailCode; message: string };
};

/** Planning assistant PTY session (one of many per project in the daemon). */
export interface PlanningSession {
  id: string;
  projectId: string;
  agent: Agent;
  planningDir: string;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
  /**
   * When the CLI exposes a resumable id and Flux captured it from PTY output,
   * main may attach it to the live or synthetic {@link PlanningSession} row.
   */
  agentConversationId?: string;
}

export type ShellStatus = 'running' | 'stopped' | 'error';

export interface Shell {
  id: string;
  sessionId: string;
  worktreePath: string;
  status: ShellStatus;
  startedAt: string;
  stoppedAt?: string;
  deviceId?: string;
  deviceKind?: TaskExecutionDeviceKind;
  deviceLabel?: string;
  remotePath?: string;
  /** SSH shells: remote tmux on the device vs local PTY in the synced worktree. */
  shellPlacement?: ShellPlacement;
}

export type RunnerStatus = 'running' | 'idle' | 'errored';

/**
 * Per-user/per-task presence doc at projects/{pid}/tasks/{tid}/runners/{uid}.
 * Desktop local sessions only — not direct SSH (see runner heartbeat filter).
 */
export interface RunnerDoc {
  status: RunnerStatus;
  lastSeen: string;
  updatedAt: string;
  displayName?: string;
}

export const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'needs-input', label: 'Needs input' },
  { id: 'validation', label: 'Validation' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

/** Board columns visible for the current project (Validation omitted when validation is off). */
export function boardColumns(validationEnabled = false): { id: TaskStatus; label: string }[] {
  if (validationEnabled) return COLUMNS;
  return COLUMNS.filter((c) => c.id !== 'validation');
}

export const AGENTS: { id: Agent; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor Agent' },
];

/** Task agent picker: real CLIs plus explicit “not assigned yet”. */
export const TASK_AGENT_SELECT_OPTIONS: { id: Agent | null; label: string }[] = [
  ...AGENTS,
  { id: null, label: 'None' },
];

/** Cursor `--model` value when `task.agentModel` is absent or blank. */
export const DEFAULT_CURSOR_AGENT_MODEL = 'auto';

export function resolvedCursorAgentModel(task: Pick<Task, 'agent' | 'agentModel'>): string {
  if (task.agent !== 'cursor') return DEFAULT_CURSOR_AGENT_MODEL;
  const m = (task.agentModel ?? '').trim();
  return m || DEFAULT_CURSOR_AGENT_MODEL;
}

/** Non-empty model id for `claude --model`, or `undefined` to omit the flag. */
export function claudeCodeExplicitModel(
  task: Pick<Task, 'agent' | 'agentModel'>,
): string | undefined {
  if (task.agent !== 'claude-code') return undefined;
  const m = (task.agentModel ?? '').trim();
  return m || undefined;
}
