export type TaskStatus = 'backlog' | 'in-progress' | 'needs-input' | 'done';

export type Agent = 'claude-code' | 'codex' | 'cursor';

export type ActiveProjectKind = 'local' | 'cloud';

/** Remembered active workspace (local folder vs cloud Firestore project). */
export interface ActiveProjectKey {
  kind: ActiveProjectKind;
  id: string;
}

export interface LocalProject {
  id: string;
  kind: 'local';
  name: string;
  rootPath: string;
  addedAt: string;
  planningAgent: Agent;
  defaultTaskAgent: Agent;
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
  description?: string;
  createdAt: string;
  projectId: string;
  /** Fractional ranking key for stable drag ordering within a column. */
  orderKey?: string;
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
