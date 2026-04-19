export type TaskStatus = 'backlog' | 'in-progress' | 'needs-input' | 'done';

export type Agent = 'claude-code' | 'codex' | 'cursor';

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  addedAt: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  agent: Agent;
  description?: string;
  createdAt: string;
  projectId: string;
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

export const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'needs-input', label: 'Needs input' },
  { id: 'done', label: 'Done' },
];

export const AGENTS: { id: Agent; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
];
