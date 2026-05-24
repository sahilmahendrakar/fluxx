import { COLUMNS, type TaskStatus } from './types';
import {
  shouldNotifyAutoTransition,
  type AutoTransitionNotificationPrefs,
} from './taskAutoTransitionNotificationPrefs';

export type AutoTransitionReason =
  | 'dependency-unblocked'
  | 'agent-silence'
  | 'agent-exited'
  | 'pr-opened'
  | 'pr-merged';

export type AutoTransitionNotifyInput = {
  taskTitle: string;
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  reason: AutoTransitionReason;
};

const REASON_PHRASE: Record<AutoTransitionReason, string> = {
  'dependency-unblocked': 'Dependency completed — task unblocked',
  'agent-silence': 'Agent went silent — needs your input',
  'agent-exited': 'Agent finished — needs your input',
  'pr-opened': 'Pull request opened',
  'pr-merged': 'Pull request merged',
};

function statusLabel(status: TaskStatus): string {
  return COLUMNS.find((c) => c.id === status)?.label ?? status;
}

export function formatAutoTransitionNotificationTitle(input: AutoTransitionNotifyInput): string {
  const title = input.taskTitle.trim() || 'Task';
  return `${statusLabel(input.nextStatus)}: ${title}`;
}

export function formatAutoTransitionNotificationBody(input: AutoTransitionNotifyInput): string {
  const from = statusLabel(input.previousStatus);
  const to = statusLabel(input.nextStatus);
  return `${from} → ${to}. ${REASON_PHRASE[input.reason]}.`;
}

export function shouldDispatchAutoTransitionNotification(
  input: AutoTransitionNotifyInput,
  prefs: AutoTransitionNotificationPrefs,
): boolean {
  if (input.previousStatus === input.nextStatus) return false;
  return shouldNotifyAutoTransition(input.nextStatus, prefs);
}

/**
 * Manual QA (macOS): With notifications enabled in Project settings, trigger each
 * automation path (unblock → In progress, silence → Needs input, PR open → Review,
 * PR merge → Done) and confirm a system notification appears. Deny notification
 * permission in System Settings and confirm task updates still succeed with a console warn.
 */
