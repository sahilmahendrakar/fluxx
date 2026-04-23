import type { Agent, Task, TaskStatus } from '../../types';

export type TaskPatch = Partial<
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
  >
> & { workspaceCleanedAt?: string | null };

export type TaskCreateInput = {
  title: string;
  agent: Agent;
  status?: TaskStatus;
  orderKey?: string;
};

/**
 * Uniform task read/write API. Local is served by main over IPC (single-user,
 * tasks.json); cloud is served by Firestore (realtime, multi-user).
 * Consumers subscribe for live updates and then mutate via create/update/delete.
 */
export interface TaskProvider {
  subscribe(cb: (tasks: Task[]) => void): () => void;
  create(input: TaskCreateInput): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  delete(id: string): Promise<void>;
  /** Local disk tasks: reload after main-process mutations (e.g. MCP). */
  reloadFromMain?: () => Promise<void>;
}
