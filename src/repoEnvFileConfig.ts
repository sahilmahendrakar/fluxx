import type {
  RepoConfig,
  RepoEnvFileEnablement,
  RepoEnvFileName,
  RepoEnvFileSource,
  RepoEnvFileSourcesConfig,
} from './types';

/** Root-level env files auto-detected in v1 (stable scan order). */
export const REPO_ENV_FILE_ALLOWLIST: readonly RepoEnvFileName[] = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
] as const;

/**
 * Filenames excluded from auto-detection (templates, production, nested discovery).
 * v1 only scans {@link REPO_ENV_FILE_ALLOWLIST} at the repo root.
 */
export const REPO_ENV_FILE_EXCLUDED_NAMES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.production',
] as const;

const ALLOWLIST_SET = new Set<string>(REPO_ENV_FILE_ALLOWLIST);
const EXCLUDED_SET = new Set<string>(REPO_ENV_FILE_EXCLUDED_NAMES);

export function isRepoEnvFileName(name: string): name is RepoEnvFileName {
  return ALLOWLIST_SET.has(name);
}

export function isExcludedRepoEnvFileName(name: string): boolean {
  return EXCLUDED_SET.has(name);
}

export function hasLegacyPastedRepoEnv(
  repo: Pick<RepoConfig, 'env'>,
): boolean {
  return typeof repo.env === 'string' && repo.env.length > 0;
}

export function parseRepoEnvFileSourcesConfig(
  value: unknown,
): RepoEnvFileSourcesConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const sources = parseRepoEnvFileSources(raw.sources);
  const lastDetectedAt =
    typeof raw.lastDetectedAt === 'string' && raw.lastDetectedAt.length > 0
      ? raw.lastDetectedAt
      : undefined;
  if (!sources && !lastDetectedAt) return undefined;
  return {
    ...(sources ? { sources } : {}),
    ...(lastDetectedAt ? { lastDetectedAt } : {}),
  };
}

function parseRepoEnvFileSources(value: unknown): RepoEnvFileSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RepoEnvFileSource[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const fileName = r.fileName;
    const enablement = r.enablement;
    if (typeof fileName !== 'string' || !isRepoEnvFileName(fileName)) continue;
    if (enablement !== 'enabled' && enablement !== 'disabled') continue;
    out.push({ fileName, enablement });
  }
  return out.length > 0 ? out : undefined;
}

/** Merges machine-binding env file prefs over repo config (cloud localBindings). */
export function mergeRepoEnvFileSources(
  repoEnvFiles: RepoEnvFileSourcesConfig | undefined,
  bindingEnvFiles: RepoEnvFileSourcesConfig | undefined,
): RepoEnvFileSourcesConfig | undefined {
  if (!repoEnvFiles && !bindingEnvFiles) return undefined;
  const lastDetectedAt =
    bindingEnvFiles?.lastDetectedAt ?? repoEnvFiles?.lastDetectedAt;
  const sources = bindingEnvFiles?.sources ?? repoEnvFiles?.sources;
  return {
    ...(lastDetectedAt ? { lastDetectedAt } : {}),
    ...(sources ? { sources } : {}),
  };
}

function configuredEnablement(
  config: RepoEnvFileSourcesConfig | undefined,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement | undefined {
  const hit = config?.sources?.find((s) => s.fileName === fileName);
  return hit?.enablement;
}

export function defaultRepoEnvFileEnablement(
  presence: 'found' | 'missing',
  legacyPastedEnvActive: boolean,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement {
  if (legacyPastedEnvActive && fileName === '.env') {
    return 'disabled';
  }
  return presence === 'found' ? 'enabled' : 'disabled';
}

export function resolveRepoEnvFileEnablement(
  configured: RepoEnvFileEnablement | undefined,
  presence: 'found' | 'missing',
  legacyPastedEnvActive: boolean,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement {
  return (
    configured ??
    defaultRepoEnvFileEnablement(presence, legacyPastedEnvActive, fileName)
  );
}

export function configuredRepoEnvFileEnablement(
  config: RepoEnvFileSourcesConfig | undefined,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement | undefined {
  return configuredEnablement(config, fileName);
}
