export const DEFAULT_GIT_INTEGRATION_ENABLED = true;
export const DEFAULT_GITLESS_SINGLE_SESSION_PER_FOLDER = true;

/** Missing or non-false values normalize to on (default). */
export function normalizeGitIntegrationEnabled(value: unknown): boolean {
  return value !== false;
}

/** Missing or non-false values normalize to on (default). */
export function normalizeGitlessSingleSessionPerFolder(value: unknown): boolean {
  return value !== false;
}

export function isGitIntegrationEnabled(
  project: { gitIntegrationEnabled?: unknown } | null | undefined,
): boolean {
  return normalizeGitIntegrationEnabled(project?.gitIntegrationEnabled);
}

export type GitIntegrationActiveProjectReader = {
  getProjectDir: () => string | null;
  getGitIntegrationEnabledAt: (projectDir: string) => Promise<boolean>;
};

/** Host-side read site for later gitless gating (config.json on disk). */
export async function gitEnabledForActiveProject(
  reader: GitIntegrationActiveProjectReader,
): Promise<boolean> {
  const dir = reader.getProjectDir();
  if (!dir) return DEFAULT_GIT_INTEGRATION_ENABLED;
  return reader.getGitIntegrationEnabledAt(dir);
}
