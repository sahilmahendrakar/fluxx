import { Task } from './types';

export const SEED_TASKS: Task[] = [
  { id: '1', title: 'Scaffold project structure',   status: 'done',        agent: 'claude-code', createdAt: '2025-01-01' },
  { id: '2', title: 'Set up CI pipeline',           status: 'done',        agent: 'codex',       createdAt: '2025-01-02' },
  { id: '3', title: 'Refactor auth middleware',     status: 'in-progress', agent: 'claude-code', createdAt: '2025-01-03' },
  { id: '4', title: 'Write API rate limiter',       status: 'in-progress', agent: 'codex',       createdAt: '2025-01-04' },
  { id: '5', title: 'Set up Stripe webhooks',       status: 'needs-input', agent: 'claude-code', createdAt: '2025-01-05' },
  { id: '6', title: 'Add email verification flow',  status: 'backlog',     agent: 'claude-code', createdAt: '2025-01-06' },
  { id: '7', title: 'Migrate DB to Postgres 16',    status: 'backlog',     agent: 'codex',       createdAt: '2025-01-07' },
  { id: '8', title: 'Dark mode for dashboard',      status: 'backlog',     agent: 'cursor',      createdAt: '2025-01-08' },
];
