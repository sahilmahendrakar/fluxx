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
  /** Board planning sidebar open (survives leaving the board and app restart). */
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
 * Per-repo configuration stored locally. The schema supports multiple repos
 * per project; today the list always has length 1 (matching `Project.rootPath`).
 */
export interface RepoConfig {
  rootPath: string;
  /** Branch fetched + used as base for new task worktrees. Default: 'main'. */
  baseBranch: string;
  /** Optional shell script run inside each new worktree after `git worktree add`. */
  setupScript?: string;
  /** Optional .env contents written to `<worktree>/.env` for each new task. */
  env?: string;
}

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
 * Cloud project as returned to the renderer for the **active** project: the
 * Firestore document plus the per-user local rootPath from LocalBindingStore.
 * Cloud projects in the projects list (not yet activated) don't carry rootPath
 * — see `CloudProjectSummary` in renderer code.
 */
/**
 * Per-machine record in `localBindings.json`. Optional fields are per-user prefs
 * for that cloud project (not synced).
 */
export interface CloudProjectLocalBinding {
  rootPath: string;
  lastOpenedAt: string;
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress?: boolean;
  autoStartWhenUnblocked?: boolean;
  autoCleanupWorkspaceWhenDone?: boolean;
  autoMarkDoneWhenPrMerged?: boolean;
  autoMoveToReviewWhenPrOpen?: boolean;
  /** @deprecated Read `autoCleanupWorkspaceWhenDone`; kept for localBindings migration. */
  autoDeleteTaskWhenDone?: boolean;
}

export interface CloudProject {
  id: string;
  kind: 'cloud';
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  rootPath: string;
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress?: boolean;
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
  | 'NO_OPEN_PR'
  | 'TASK_METADATA_REQUIRED'
  | 'GH_NOT_INSTALLED'
  | 'GH_AUTH_FAILED'
  | 'NO_GITHUB_REMOTE'
  | 'BRANCH_PUSH_FAILED'
  | 'PR_CREATE_FAILED'
  | 'PR_VIEW_FAILED'
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
  /** If true, auto-start a session for this task when the last dependency completes, even if project “when unblocked” is off. */
  autoStartOnUnblock?: boolean;
  /**
   * Git branch this task is logically based on (PR merge target / conceptual base).
   * Distinct from {@link Session.branch}, which is the generated `flux/task-<id>` work branch.
   * When omitted on legacy rows, treat as the project default (`RepoConfig.baseBranch` / detected default).
   */
  sourceBranch?: string;
  /**
   * When the requested {@link Task.sourceBranch} does not exist yet, Flux may create it
   * from the project default branch on first session start. Persist `false` when the branch
   * was chosen from discovery (already exists), and `true` when the user typed a new name.
   */
  createSourceBranchIfMissing?: boolean;
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
  worktreePath: string;
  branch: string;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
}

/** Where to open a task worktree folder from the main process (`workspace:openPath`). */
export type OpenWorkspaceTarget = 'cursor' | 'vscode' | 'terminal' | 'file-manager';

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
