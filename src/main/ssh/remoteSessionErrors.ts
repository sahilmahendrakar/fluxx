import type { DeviceProbeErrorCode, SessionStartErrorCode } from '../../types';
import { mapHelperErrorCode } from './remoteHelperProtocol';

const SESSION_START_PROBE_CODES = new Set<SessionStartErrorCode>([
  'SSH_CONNECT_FAILED',
  'SSH_HELPER_MISSING',
  'SSH_HELPER_VERSION_MISMATCH',
  'REMOTE_TMUX_MISSING',
  'REMOTE_GIT_MISSING',
  'REMOTE_AGENT_NOT_FOUND',
  'REMOTE_WORKSPACE_UNWRITABLE',
  'REMOTE_REPO_ACCESS_FAILED',
]);

export function mapRemoteHelperCodeToSessionStart(code: string): SessionStartErrorCode {
  const mapped = mapHelperErrorCode(code);
  if (SESSION_START_PROBE_CODES.has(mapped as SessionStartErrorCode)) {
    return mapped as SessionStartErrorCode;
  }
  switch (code) {
    case 'REMOTE_NON_GIT_UNSUPPORTED':
      return 'REMOTE_NON_GIT_UNSUPPORTED';
    case 'REMOTE_SETUP_FAILED':
      return 'REMOTE_SETUP_FAILED';
    case 'WORKTREE_SOURCE_BRANCH_MISSING':
      return 'WORKTREE_SOURCE_BRANCH_MISSING';
    case 'WORKTREE_SOURCE_BRANCH_AMBIGUOUS':
      return 'WORKTREE_SOURCE_BRANCH_AMBIGUOUS';
    case 'WORKTREE_SOURCE_BRANCH_CREATE_FAILED':
      return 'WORKTREE_SOURCE_BRANCH_CREATE_FAILED';
    case 'WORKTREE_BASE_BRANCH_UNAVAILABLE':
      return 'WORKTREE_BASE_BRANCH_UNAVAILABLE';
    case 'WORKTREE_FETCH_FAILED':
      return 'WORKTREE_FETCH_FAILED';
    case 'WORKTREE_FAILED':
      return 'WORKTREE_FAILED';
    case 'REMOTE_REPO_MISMATCH':
      return 'REMOTE_REPO_ACCESS_FAILED';
    default:
      return 'INTERNAL';
  }
}

export function mapDeviceProbeCodeToSessionStart(code: DeviceProbeErrorCode): SessionStartErrorCode {
  if (SESSION_START_PROBE_CODES.has(code as SessionStartErrorCode)) {
    return code as SessionStartErrorCode;
  }
  return 'INTERNAL';
}
