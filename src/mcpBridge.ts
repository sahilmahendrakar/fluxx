import type { ActiveProjectKey, Agent, Task, TaskStatus } from './types';

export const MCP_BRIDGE_REQUEST_CHANNEL = 'mcp:rendererBridge:request';
export const MCP_BRIDGE_RESPONSE_CHANNEL = 'mcp:rendererBridge:response';
export const MCP_BRIDGE_READY_CHANNEL = 'mcp:rendererBridge:ready';

export type McpBridgeOp =
  | 'tasks.list'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.delete'
  | 'projectInfo'
  | 'members.list';

/** One project member row for `members.list` / `flux__list_members` (cloud). */
export interface McpBridgeMember {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  photoURL?: string;
}

export interface McpBridgeTaskCreateInput {
  title: string;
  agent: Agent;
  status?: TaskStatus;
  description?: string;
  orderKey?: string;
  blockedByTaskIds?: string[];
  labels?: string[];
  assigneeId?: string;
}

export interface McpBridgeTaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  agent?: Agent;
  blockedByTaskIds?: string[];
  labels?: string[];
  autoStartOnUnblock?: boolean;
  assigneeId?: string | null;
}

export interface McpBridgeTasksCreatePayload {
  input: McpBridgeTaskCreateInput;
}

export interface McpBridgeTasksUpdatePayload {
  taskId: string;
  patch: McpBridgeTaskPatch;
}

export interface McpBridgeTasksDeletePayload {
  taskId: string;
}

export interface McpBridgeRequest {
  id: string;
  op: McpBridgeOp;
  /**
   * Snapshot of the active project at the time the main process built this
   * request. The renderer rejects with PROJECT_KIND_MISMATCH if its current
   * active project differs — guards against project switches mid-flight.
   */
  expectedActiveKey: ActiveProjectKey;
  payload?: unknown;
}

export type McpBridgeErrorCode =
  | 'NO_ACTIVE_PROJECT'
  | 'AUTH_NOT_READY'
  | 'PROJECT_KIND_MISMATCH'
  | 'RENDERER_NOT_READY'
  | 'RENDERER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN_OP'
  | 'INVALID_PAYLOAD'
  | 'INTERNAL';

export type McpBridgeResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; code: McpBridgeErrorCode; message: string };

export interface McpBridgeProjectInfoResult {
  name: string;
  activeKey: ActiveProjectKey;
  uid: string | null;
  taskCounts: {
    backlog: number;
    'in-progress': number;
    'needs-input': number;
    done: number;
    total: number;
  };
}

/**
 * `tasks.update` returns both the pre-write snapshot view and the post-write
 * task so the main process can detect a status transition (e.g. → in-progress)
 * in a single round trip and trigger local-side effects (auto-start session).
 */
export interface McpBridgeTasksUpdateResult {
  previous: Task | null;
  updated: Task;
  /** Cloud + auto workspace cleanup on Done: broom-equivalent ran when the MCP user was assignee. */
  workspaceCleanedAfterDone?: boolean;
}
