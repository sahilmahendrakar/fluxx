export type TaskStatus = 'backlog' | 'in-progress' | 'needs-input' | 'review' | 'done';

/** Where a normalized short branch name exists in the clone; see `classifyGitBranchPresence`. */
export type GitBranchPresence = 'local' | 'remote' | 'both' | 'missing';

export type Agent = 'claude-code' | 'codex' | 'cursor';

/** Per-CLI default `--model` for planning or new tasks (stored on project / binding). */
export type AgentSessionModelDefaults = Partial<Record<'claude-code' | 'cursor', string>>;

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
 * Tab-strip restoration state — per project, remember which task tabs
 * were open and which was active. Planning fields mirror task patterns.
 */
export interface ProjectTabState {
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
  Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env' | 'name'>
>;

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
  /** Optional .env contents written to `<worktree>/.env` for each new task. */
  env?: string;
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
  /** When enabled, Flux may auto-accept Claude/Cursor trust prompts in Flux-owned worktrees and the planning directory only. */
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
  /** @deprecated Read `autoCleanupWorkspaceWhenDone`; kept for localBindings migration. */
  autoDeleteTaskWhenDone?: boolean;
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
  /** @deprecated */
  autoDeleteTaskWhenDone?: boolean;
}

export type Project = LocalProject | CloudProject;

export type TaskGithubPrState = 'open' | 'closed' | 'merged';

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

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  agent: Agent;
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
   * (historically `flux/task-<id>`, now usually `<git-author-slug>/<title-slug>`).
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
   * tasks: treat as the legacy `flux/task-<id>` pattern from `src/main/fluxTaskBranch.ts`.
   */
  fluxWorkBranch?: string;
  /** Linked GitHub PR metadata (optional). */
  githubPr?: TaskGithubPr;
}

export type SessionStatus = 'idle' | 'running' | 'stopped' | 'error';

export type SessionStartErrorCode =
  | 'AGENT_NOT_FOUND'
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
}

/** Where to open a task worktree folder from the main process (`workspace:openPath`). */
export type OpenWorkspaceTarget = 'cursor' | 'vscode' | 'terminal' | 'file-manager';

/** Payload for `workspace:resolveTaskWorktree` — bare string is legacy (`taskId` only). */
export type ResolveTaskWorktreeIpcPayload =
  | string
  | { taskId: string; repoId?: string | null; fluxWorkBranch?: string | null };

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
}

export type ShellStatus = 'running' | 'stopped' | 'error';

export interface Shell {
  id: string;
  sessionId: string;
  worktreePath: string;
  status: ShellStatus;
  startedAt: string;
  stoppedAt?: string;
}

export type RunnerStatus = 'running' | 'idle' | 'errored';

/** Per-user/per-task presence doc at projects/{pid}/tasks/{tid}/runners/{uid}. */
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
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

export const AGENTS: { id: Agent; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor Agent' },
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
