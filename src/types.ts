export type TaskStatus = 'backlog' | 'in-progress' | 'needs-input' | 'done';

export type Agent = 'claude-code' | 'codex' | 'cursor';

export type ActiveProjectKind = 'local' | 'cloud';

/** Remembered active workspace (local folder vs cloud Firestore project). */
export interface ActiveProjectKey {
  kind: ActiveProjectKind;
  id: string;
}

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
  repos: RepoConfig[];
}

/**
 * Cloud project as returned to the renderer for the **active** project: the
 * Firestore document plus the per-user local rootPath from LocalBindingStore.
 * Cloud projects in the projects list (not yet activated) don't carry rootPath
 * — see `CloudProjectSummary` in renderer code.
 */
export interface CloudProject {
  id: string;
  kind: 'cloud';
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  rootPath: string;
}

export type Project = LocalProject | CloudProject;

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
}

export type SessionStatus = 'idle' | 'running' | 'stopped' | 'error';

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

/** Planning assistant PTY session (singleton in the main process). */
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
