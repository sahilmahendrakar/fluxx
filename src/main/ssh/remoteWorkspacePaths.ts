import path from 'node:path';

/** Join remote SSH paths without expanding `~` (expansion happens on the remote host). */
export function joinRemoteWorkspacePath(workspaceRoot: string, ...segments: string[]): string {
  const root = workspaceRoot.trim() || '~/.fluxx/workspaces';
  const parts = [root.replace(/\/+$/, ''), ...segments.filter(Boolean)];
  return path.posix.join(...parts);
}

export function remoteRepoCachePath(
  workspaceRoot: string,
  projectId: string,
  repoId: string,
): string {
  return joinRemoteWorkspacePath(
    workspaceRoot,
    'repos',
    sanitizePathSegment(projectId),
    sanitizePathSegment(repoId),
  );
}

export function remoteTaskWorktreePath(
  workspaceRoot: string,
  projectId: string,
  repoId: string,
  taskId: string,
): string {
  return joinRemoteWorkspacePath(
    workspaceRoot,
    'worktrees',
    sanitizePathSegment(projectId),
    sanitizePathSegment(repoId),
    sanitizePathSegment(taskId),
  );
}

export function remoteDeviceManifestPath(deviceId: string): string {
  return path.join('~/.fluxx', 'devices', sanitizePathSegment(deviceId), 'terminal-sessions.json');
}

function sanitizePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return '_';
  return trimmed.replace(/[/\\]/g, '_');
}
