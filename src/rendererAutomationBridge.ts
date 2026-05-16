import type {
  ActiveProjectKey,
  Agent,
  RepoPathStatus,
  Task,
  TaskGithubPr,
  TaskStatus,
} from './types';

export const AUTOMATION_BRIDGE_REQUEST_CHANNEL = 'automation:rendererBridge:request';
export const AUTOMATION_BRIDGE_RESPONSE_CHANNEL = 'automation:rendererBridge:response';
export const AUTOMATION_BRIDGE_READY_CHANNEL = 'automation:rendererBridge:ready';

export type AutomationBridgeOp =
  | 'tasks.list'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.delete'
  | 'projectInfo'
  | 'repo.branchDiscovery'
  | 'members.list';

/** One project member row for `members.list` / `flux__list_members` (cloud). */
export interface AutomationBridgeMember {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  photoURL?: string;
}

export interface AutomationBridgeTaskCreateInput {
  title: string;
  agent: Agent | null;
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

export interface AutomationBridgeTaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  agent?: Agent | null;
  blockedByTaskIds?: string[];
  labels?: string[];
  autoStartOnUnblock?: boolean | null;
  assigneeId?: string | null;
  githubPr?: TaskGithubPr | null;
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
  repoId?: string;
}

export interface AutomationBridgeTasksCreatePayload {
  input: AutomationBridgeTaskCreateInput;
}

export interface AutomationBridgeTasksUpdatePayload {
  taskId: string;
  patch: AutomationBridgeTaskPatch;
}

export interface AutomationBridgeTasksDeletePayload {
  taskId: string;
}

export interface AutomationBridgeRequest {
  id: string;
  op: AutomationBridgeOp;
  /**
   * Snapshot of the active project at the time the main process built this
   * request. The renderer rejects with PROJECT_KIND_MISMATCH if its current
   * active project differs — guards against project switches mid-flight.
   */
  expectedActiveKey: ActiveProjectKey;
  payload?: unknown;
}

export type AutomationBridgeErrorCode =
  | 'NO_ACTIVE_PROJECT'
  | 'AUTH_NOT_READY'
  | 'PROJECT_KIND_MISMATCH'
  | 'RENDERER_NOT_READY'
  | 'RENDERER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN_OP'
  | 'INVALID_PAYLOAD'
  | 'INTERNAL';

export type AutomationBridgeResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; code: AutomationBridgeErrorCode; message: string };

/** One repository row for `flux__get_project_info` when multi-repo2 is enabled. */
export interface AutomationBridgeProjectInfoRepoSummary {
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

export interface AutomationBridgeProjectInfoResult {
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
  repos?: AutomationBridgeProjectInfoRepoSummary[];
  /** Multi-repo2: stable id of the primary repo (same as {@link AutomationBridgeProjectInfoRepoSummary.isPrimary}). */
  primaryRepoId?: string;
}

export interface AutomationBridgeRepoBranchDiscoveryPayload {
  repoId?: string;
  classifyBranch?: string;
}

/**
 * `tasks.update` returns both the pre-write snapshot view and the post-write
 * task so the main process can detect a status transition (e.g. backlog → in-progress)
 * in a single round trip and trigger local-side effects (column auto-start session when enabled).
 */
export interface AutomationBridgeTasksUpdateResult {
  previous: Task | null;
  updated: Task;
  /** Cloud + auto workspace cleanup on Done: broom-equivalent ran when the automation actor was assignee. */
  workspaceCleanedAfterDone?: boolean;
}

export function isAutomationBridgeResponse(value: unknown): value is AutomationBridgeResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string') return false;
  if (r.ok === true) return 'data' in r;
  if (r.ok === false) {
    return typeof r.code === 'string' && typeof r.message === 'string';
  }
  return false;
}

export function automationBridgeErrorResponse(
  id: string,
  code: AutomationBridgeErrorCode,
  message: string,
): AutomationBridgeResponse {
  return { id, ok: false, code, message };
}
