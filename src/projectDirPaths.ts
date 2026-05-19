import path from 'node:path';

/** Nested layout root: `~/.fluxx/projects/<projectId>/`. Shared by main + renderer (no Node crypto). */
export const FLUXX_PROJECTS_SUBDIR = 'projects';

export function sanitizeCloudProjectDirSegment(cloudProjectId: string): string {
  return cloudProjectId.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function canonicalCloudProjectDir(
  fluxxBaseDir: string,
  cloudProjectId: string,
): string {
  return path.join(
    fluxxBaseDir,
    FLUXX_PROJECTS_SUBDIR,
    sanitizeCloudProjectDirSegment(cloudProjectId),
  );
}
