/**
 * Protocol-neutral automation contract for Flux planning assistants.
 *
 * ## MCP → CLI command map (target surface)
 *
 * | Legacy MCP tool           | Planned CLI (JSON on stdout when `--json`) |
 * |--------------------------|---------------------------------------------|
 * | `flux__get_project_info` | `flux project info --json`                  |
 * | `flux__list_tasks`       | `flux tasks list --json`                    |
 * | `flux__create_task`      | `flux tasks create ... --json`            |
 * | `flux__update_task`      | `flux tasks update ... --json`              |
 * | `flux__start_task`       | `flux tasks start ... --json`               |
 * | `flux__delete_task`      | `flux tasks delete ... --confirm --json`    |
 * | `flux__list_members`     | `flux members list --json`                  |
 * | `flux__list_repo_branches` | `flux repo branches --json`              |
 *
 * ## JSON envelopes (`--json`)
 *
 * On success, the CLI should print a single JSON object:
 * `{ "ok": true, "data": <payload> }` where `<payload>` matches the historical
 * MCP tool body (task object, task array, project info, etc.).
 *
 * On failure:
 * `{ "ok": false, "error": "<human-readable message>" }`
 * Optional `"code"` when the failure originated from the cloud renderer bridge
 * (same string values as {@link McpBridgeErrorCode}).
 *
 * ## Exit codes (CLI process)
 *
 * - {@link FLUX_CLI_EXIT_SUCCESS} — command completed and `ok: true` was emitted.
 * - {@link FLUX_CLI_EXIT_USER_ERROR} — validation / business rules (`ok: false`, no bridge code or known user-facing errors).
 * - {@link FLUX_CLI_EXIT_INFRA} — renderer bridge timeout / not ready / internal transport errors (`ok: false` with bridge `code`).
 */

import type { McpBridgeErrorCode, McpBridgeProjectInfoRepoSummary } from '../../mcpBridge';
import type { TaskStatus } from '../../types';

export const FLUX_CLI_EXIT_SUCCESS = 0;
export const FLUX_CLI_EXIT_USER_ERROR = 1;
export const FLUX_CLI_EXIT_INFRA = 2;

/** Stable mapping from legacy MCP tool names to planned `flux` CLI invocations (JSON mode). */
export const MCP_TOOL_CLI_MAP = {
  flux__get_project_info: 'flux project info --json',
  flux__list_tasks: 'flux tasks list --json',
  flux__create_task: 'flux tasks create ... --json',
  flux__update_task: 'flux tasks update ... --json',
  flux__start_task: 'flux tasks start ... --json',
  flux__delete_task: 'flux tasks delete ... --confirm --json',
  flux__list_members: 'flux members list --json',
  flux__list_repo_branches: 'flux repo branches --json',
} as const satisfies Record<string, string>;

export type McpAutomationToolName = keyof typeof MCP_TOOL_CLI_MAP;

/** Maps an automation failure to a suggested CLI exit code. */
export function exitCodeForAutomationFailure(
  failure: Extract<ProjectAutomationResult<unknown>, { ok: false }>,
): number {
  if (failure.bridgeCode !== undefined) {
    return FLUX_CLI_EXIT_INFRA;
  }
  return FLUX_CLI_EXIT_USER_ERROR;
}

export type ProjectAutomationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; bridgeCode?: McpBridgeErrorCode };

export type TaskAgentArg = 'claude-code' | 'codex' | 'cursor' | 'none';

export type TaskStatusArg = 'backlog' | 'in-progress' | 'needs-input' | 'review' | 'done';

export interface ListTasksInput {
  excludeStatuses?: TaskStatus[] | undefined;
}

export interface CreateTaskInput {
  title: string;
  description?: string | undefined;
  agent?: TaskAgentArg | undefined;
  blockedByTaskIds?: string[] | undefined;
  labels?: string[] | undefined;
  assigneeEmail?: string | undefined;
  sourceBranch?: string | undefined;
  createSourceBranchIfMissing?: boolean | undefined;
  agentModel?: string | undefined;
  agentYolo?: boolean | undefined;
  repoId?: string | undefined;
}

export interface UpdateTaskInput {
  id: string;
  title?: string | undefined;
  description?: string | undefined;
  status?: TaskStatusArg | undefined;
  agent?: TaskAgentArg | undefined;
  blockedByTaskIds?: string[] | undefined;
  labels?: string[] | undefined;
  autoStartOnUnblock?: boolean | undefined;
  assigneeEmail?: string | undefined;
  unassignAssignee?: boolean | undefined;
  sourceBranch?: string | undefined;
  createSourceBranchIfMissing?: boolean | undefined;
  githubPr?: {
    url: string;
    number?: number | undefined;
    state?: 'open' | 'closed' | 'merged' | undefined;
    mergedAt?: string | undefined;
    headBranch?: string | undefined;
    baseBranch?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
  } | null | undefined;
  repoId?: string | undefined;
}

export interface StartTaskInput {
  id: string;
}

export interface DeleteTaskInput {
  id: string;
  /** Same as MCP: must be true to delete. */
  confirm: true;
}

export interface ListRepoBranchesInput {
  repoId?: string | undefined;
  classifyBranch?: string | undefined;
}

/** Local `flux__list_members` body (cloud returns a bare member array). */
export interface ListMembersLocalPayload {
  members: [];
  note: string;
}

export interface ProjectInfoTaskCounts {
  backlog: number;
  'in-progress': number;
  'needs-input': number;
  review: number;
  done: number;
  total: number;
}

/** Body returned by `getProjectInfo` / `flux project info --json` / `flux__get_project_info`. */
export interface ProjectInfoPayload {
  name: string;
  rootPath: string;
  taskCounts: ProjectInfoTaskCounts;
  defaultBranchShort?: string;
  branchDiscoveryError?: string;
  primaryRepoId?: string;
  repos?: McpBridgeProjectInfoRepoSummary[];
}
