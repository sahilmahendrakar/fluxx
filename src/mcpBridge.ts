import type {
  ActiveProjectKey,
  Agent,
  RepoPathStatus,
  Task,
  TaskGithubPr,
  TaskStatus,
} from './types';

export const MCP_BRIDGE_REQUEST_CHANNEL = 'mcp:rendererBridge:request';
export const MCP_BRIDGE_RESPONSE_CHANNEL = 'mcp:rendererBridge:response';
export const MCP_BRIDGE_READY_CHANNEL = 'mcp:rendererBridge:ready';

export type McpBridgeOp =
  | 'tasks.list'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.delete'
  | 'projectInfo'
  | 'repo.branchDiscovery'
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
  /** Short branch name; defaults from project repo when omitted. */
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  agentModel?: string;
  agentYolo?: boolean;
  /** Multi-repo2; local tasks validate against project repos; omitted uses primary. */
  repoId?: string;
}

export interface McpBridgeTaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  agent?: Agent;
  blockedByTaskIds?: string[];
  labels?: string[];
  autoStartOnUnblock?: boolean | null;
  assigneeId?: string | null;
  githubPr?: TaskGithubPr | null;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  repoId?: string;
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

/** One repository row for `flux__get_project_info` when multi-repo2 is enabled. */
export interface McpBridgeProjectInfoRepoSummary {
  id: string;
  /** Human-readable name (cloud: Firestore label; local: Flux repo name / folder). */
  label: string;
  /** True for the repo that supplies the project workspace root / primary clone. */
  isPrimary: boolean;
  /** Branch configured in Flux as the integration line for this repo. */
  configuredDefaultBranch: string;
  /** Resolved default short branch name from git discovery on this machine, when it succeeds. */
  defaultBranchShort?: string;
  /** Absolute clone path when this machine has a binding (cloud) or local config path. */
  rootPath?: string;
  /** Local disk: whether the configured path exists and looks like a git repo. */
  pathStatus?: RepoPathStatus;
  /** Cloud: whether this machine has a clone registered for the shared repo id. */
  binding?: 'bound' | 'missing_binding';
}

export interface McpBridgeProjectInfoResult {
  name: string;
  activeKey: ActiveProjectKey;
  uid: string | null;
  taskCounts: {
    backlog: number;
    'in-progress': number;
    'needs-input': number;
    review: number;
    done: number;
    total: number;
  };
  /** Short default branch name for the bound git repo, when discovery succeeds. */
  defaultBranchShort?: string;
  /** When branch discovery failed (e.g. missing git), explains why defaultBranchShort is absent. */
  branchDiscoveryError?: string;
  /**
   * Multi-repo2: every configured repository with labels, primary marker, and binding/path hints.
   * Omitted when the feature flag is off (single-repo shape unchanged for agents).
   */
  repos?: McpBridgeProjectInfoRepoSummary[];
  /** Multi-repo2: stable id of the primary repo (same as {@link McpBridgeProjectInfoRepoSummary.isPrimary}). */
  primaryRepoId?: string;
}

export interface McpBridgeRepoBranchDiscoveryPayload {
  repoId?: string;
  classifyBranch?: string;
}

/**
 * `tasks.update` returns both the pre-write snapshot view and the post-write
 * task so the main process can detect a status transition (e.g. backlog → in-progress)
 * in a single round trip and trigger local-side effects (column auto-start session when enabled).
 */
export interface McpBridgeTasksUpdateResult {
  previous: Task | null;
  updated: Task;
  /** Cloud + auto workspace cleanup on Done: broom-equivalent ran when the MCP user was assignee. */
  workspaceCleanedAfterDone?: boolean;
}
