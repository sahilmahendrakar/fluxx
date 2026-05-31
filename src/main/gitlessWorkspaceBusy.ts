import path from 'node:path';
import type { Session } from '../types';
import { isDirectWorkspaceKind } from './DirectFolderWorkspaceProvider';

/** Busy key for gitless concurrency: resolved folder path + execution device id. */
export function buildGitlessWorkspaceBusyKey(folderPath: string, deviceId: string): string {
  const folder = path.resolve(folderPath.trim());
  const device = deviceId.trim();
  return `${folder}\0${device}`;
}

export type GitlessBusySessionRow = Pick<
  Session,
  'status' | 'worktreePath' | 'workspaceKind' | 'deviceId' | 'taskId'
>;

/**
 * Returns the other running task that holds the busy key, if any.
 * Only considers direct (gitless) workspaces.
 */
export function findGitlessWorkspaceBusyHolder(
  sessions: readonly GitlessBusySessionRow[],
  busyKey: string,
  excludeTaskId: string,
): Pick<Session, 'taskId'> | null {
  for (const s of sessions) {
    if (s.status !== 'running') continue;
    if (s.taskId === excludeTaskId) continue;
    if (!isDirectWorkspaceKind(s.workspaceKind)) continue;
    const wt = s.worktreePath?.trim();
    if (!wt) continue;
    const deviceId = s.deviceId?.trim() ?? '';
    if (!deviceId) continue;
    if (buildGitlessWorkspaceBusyKey(wt, deviceId) !== busyKey) continue;
    return { taskId: s.taskId };
  }
  return null;
}

export function gitlessMultiSessionWarningMessage(): string {
  return (
    'Another agent session may already be editing this folder. ' +
    'Multiple concurrent sessions can overwrite each other’s changes.'
  );
}

export function workspaceBusyErrorMessage(holderTaskId: string, holderTitle?: string): string {
  const label = holderTitle?.trim() || holderTaskId;
  return `This folder is already in use by task “${label}”. Stop that session or disable “One session per folder” in project settings.`;
}
