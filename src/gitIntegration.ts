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

export const GIT_INTEGRATION_DISABLED_NOTE =
  'git integration is disabled for this project';

export function gitBranchFlagIgnoredNote(flagName: string): string {
  return `${GIT_INTEGRATION_DISABLED_NOTE}; ${flagName} ignored`;
}

export const GIT_BRANCH_DISCOVERY_DISABLED_NOTE =
  `${GIT_INTEGRATION_DISABLED_NOTE}; branch discovery returns empty`;

export type GitBranchCliFields = {
  sourceBranch?: string;
  createSourceBranchIfMissing?: boolean;
};

/** Strip git branch CLI fields when git is off; collect human-readable stderr notes. */
export function stripGitBranchCliFields<T extends GitBranchCliFields>(
  input: T,
  gitIntegrationEnabled: boolean,
): { value: T; stderrNotes: string[] } {
  if (gitIntegrationEnabled) {
    return { value: input, stderrNotes: [] };
  }
  const stderrNotes: string[] = [];
  const value = { ...input };
  if (value.sourceBranch !== undefined) {
    stderrNotes.push(gitBranchFlagIgnoredNote('--source-branch'));
    delete value.sourceBranch;
  }
  if (value.createSourceBranchIfMissing !== undefined) {
    stderrNotes.push(gitBranchFlagIgnoredNote('--create-source-branch-if-missing'));
    delete value.createSourceBranchIfMissing;
  }
  return { value, stderrNotes };
}

export function joinGitCliStderrNotes(notes: string[]): string | undefined {
  if (notes.length === 0) return undefined;
  return notes.join('\n');
}

export function gitDisabledBranchDiscoveryResponse(): {
  defaultBranchShort: string;
  localBranches: string[];
  remoteBranches: string[];
} {
  return {
    defaultBranchShort: '',
    localBranches: [],
    remoteBranches: [],
  };
}
