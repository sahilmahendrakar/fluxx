import type { RemoteSessionLifecycleStatus, TaskAgentSessionRecord } from '../../types';

const LIFECYCLE_TO_END_REASON: Record<
  RemoteSessionLifecycleStatus,
  TaskAgentSessionRecord['endedReason']
> = {
  'device-unreachable': 'device-unreachable',
  'tmux-missing': 'tmux-missing',
  'helper-mismatch': 'helper-mismatch',
  'workspace-missing': 'workspace-deleted',
};

export function mapRemoteLifecycleToEndedReason(
  status: RemoteSessionLifecycleStatus,
): NonNullable<TaskAgentSessionRecord['endedReason']> {
  return LIFECYCLE_TO_END_REASON[status] ?? 'tmux-missing';
}

export function mapEndedReasonToRemoteLifecycle(
  reason: TaskAgentSessionRecord['endedReason'],
): RemoteSessionLifecycleStatus | undefined {
  if (reason === 'device-unreachable') return 'device-unreachable';
  if (reason === 'helper-mismatch') return 'helper-mismatch';
  if (reason === 'tmux-missing') return 'tmux-missing';
  if (reason === 'workspace-deleted') return 'workspace-missing';
  return undefined;
}
