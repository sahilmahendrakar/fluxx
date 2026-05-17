import type { Agent, Task, TaskAttachedPlanningDoc, TaskGithubPr, TaskStatus } from '../../types';

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
    | 'blockedByTaskIds'
    | 'labels'
    | 'assigneeId'
    | 'sourceBranch'
    | 'createSourceBranchIfMissing'
    | 'repoId'
    | 'fluxxWorkBranch'
  >
> & {
  workspaceCleanedAt?: string | null;
  githubPr?: TaskGithubPr | null;
  /** True/false persist; `null` clears the field so the task inherits the project default. */
  autoStartOnUnblock?: boolean | null;
  /** `null` clears all attached planning docs in Firestore. */
  attachedPlanningDocs?: TaskAttachedPlanningDoc[] | null;
};

export type TaskCreateInput = {
  title: string;
  agent: Agent | null;
  status?: TaskStatus;
  orderKey?: string;
  blockedByTaskIds?: string[];
  labels?: string[];
  assigneeId?: string;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  agentModel?: string;
  agentYolo?: boolean;
  /** Multi-repo2: must belong to the active project when set; otherwise the primary repo is used. */
  repoId?: string;
  attachedPlanningDocs?: TaskAttachedPlanningDoc[];
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
