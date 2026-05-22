import type { AgentState } from './terminal-runtime/protocol';
import type { Task, TaskGithubPr, TaskStatus } from './types';
import { expectedTaskFluxxWorkBranch } from './taskBranch';
import { normalizeGitBranchShortName } from './taskBranches';

/**
 * Columns from which an open PR may auto-move a task into Review. Keeps Needs input /
 * Review / Done untouched so enabling the pref does not surprise users, and pairs with
 * a future “Done when PR merged” automation (merged PRs are never `open`, so no
 * review ↔ done oscillation from this rule).
 */
export const AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'in-progress',
];

/** Agent silence for a task's running session, or no running session linked. */
export type LinkedAgentSessionState = 'active' | 'silent' | 'none';

export function linkedAgentSessionStateForTask(
  taskId: string,
  silenceStates: { id: string; taskId?: string; state: AgentState }[],
): LinkedAgentSessionState {
  const forTask = silenceStates.filter((s) => s.taskId === taskId);
  if (forTask.length === 0) return 'none';
  if (forTask.some((s) => s.state === 'active')) return 'active';
  return 'silent';
}

function githubPrHeadMatchesTaskFluxBranch(
  task: Pick<Task, 'id' | 'fluxxWorkBranch'>,
  githubPr: TaskGithubPr,
): boolean {
  const head = githubPr.headBranch?.trim() ?? '';
  if (head.length === 0) return true;
  const expected = expectedTaskFluxxWorkBranch(task);
  const nh = normalizeGitBranchShortName(head);
  const ne = normalizeGitBranchShortName(expected);
  if (nh && ne && nh !== ne) return false;
  return true;
}

function openPrAutomationBase(input: {
  enabled: boolean;
  githubPr: TaskGithubPr | undefined;
  task: Pick<Task, 'id' | 'fluxxWorkBranch'>;
}): boolean {
  if (!input.enabled) return false;
  if (input.githubPr?.state !== 'open') return false;
  return githubPrHeadMatchesTaskFluxBranch(input.task, input.githubPr);
}

/** Open PR + pref: move into Review only when the linked agent is silent (or not running). */
export function shouldAutoMoveTaskToReviewForOpenPr(input: {
  enabled: boolean;
  taskStatus: TaskStatus;
  githubPr: TaskGithubPr | undefined;
  task: Pick<Task, 'id' | 'fluxxWorkBranch'>;
  linkedAgentSessionState?: LinkedAgentSessionState;
}): boolean {
  if (!openPrAutomationBase(input)) return false;
  if (!AUTO_MOVE_TO_REVIEW_WHEN_PR_OPEN_SOURCE_STATUSES.includes(input.taskStatus)) {
    return false;
  }
  if (input.linkedAgentSessionState === 'active') return false;
  return true;
}

/** Open PR + pref: move Review → In progress while the linked agent is actively outputting. */
export function shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive(input: {
  enabled: boolean;
  taskStatus: TaskStatus;
  githubPr: TaskGithubPr | undefined;
  task: Pick<Task, 'id' | 'fluxxWorkBranch'>;
  linkedAgentSessionState?: LinkedAgentSessionState;
}): boolean {
  if (!openPrAutomationBase(input)) return false;
  if (input.taskStatus !== 'review') return false;
  if (input.linkedAgentSessionState !== 'active') return false;
  return true;
}

/**
 * Status transition driven by agent-state for a task with a running session.
 * Returns null when the task column should not change.
 */
export function agentStateTaskStatusTransition(input: {
  state: AgentState;
  task: Pick<Task, 'id' | 'status' | 'fluxxWorkBranch' | 'githubPr'>;
  autoMoveToReviewWhenPrOpen: boolean;
  linkedAgentSessionState: LinkedAgentSessionState;
}): 'review' | 'in-progress' | 'needs-input' | null {
  if (input.state === 'active') {
    if (
      shouldAutoMoveTaskToInProgressForOpenPrWhenAgentActive({
        enabled: input.autoMoveToReviewWhenPrOpen,
        taskStatus: input.task.status,
        githubPr: input.task.githubPr,
        task: input.task,
        linkedAgentSessionState: 'active',
      })
    ) {
      return 'in-progress';
    }
    return null;
  }

  if (input.task.status !== 'in-progress') return null;

  if (
    shouldAutoMoveTaskToReviewForOpenPr({
      enabled: input.autoMoveToReviewWhenPrOpen,
      taskStatus: 'in-progress',
      githubPr: input.task.githubPr,
      task: input.task,
      linkedAgentSessionState: input.linkedAgentSessionState,
    })
  ) {
    return 'review';
  }

  return 'needs-input';
}
