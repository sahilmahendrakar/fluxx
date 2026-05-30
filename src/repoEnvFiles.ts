import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  RepoConfig,
  RepoEnvFileDetectionEntry,
  RepoEnvFileDetectionResult,
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

function sha256FileHex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function configuredEnablement(
  config: RepoEnvFileSourcesConfig | undefined,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement | undefined {
  const hit = config?.sources?.find((s) => s.fileName === fileName);
  return hit?.enablement;
}

function defaultEnablement(
  presence: 'found' | 'missing',
  legacyPastedEnvActive: boolean,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement {
  if (legacyPastedEnvActive && fileName === '.env') {
    return 'disabled';
  }
  return presence === 'found' ? 'enabled' : 'disabled';
}

function resolveEnablement(
  configured: RepoEnvFileEnablement | undefined,
  presence: 'found' | 'missing',
  legacyPastedEnvActive: boolean,
  fileName: RepoEnvFileName,
): RepoEnvFileEnablement {
  return (
    configured ??
    defaultEnablement(presence, legacyPastedEnvActive, fileName)
  );
}

/** True when `filePath` is a direct child of `repoRoot` (excludes nested monorepo paths). */
export function isRepoRootEnvFilePath(repoRoot: string, filePath: string): boolean {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedFile = path.resolve(filePath);
  return path.dirname(resolvedFile) === resolvedRoot;
}

export type DetectRepoRootEnvFilesOptions = {
  envFiles?: RepoEnvFileSourcesConfig;
  legacyPastedEnvActive?: boolean;
  /** Injectable for deterministic tests. */
  detectedAt?: string;
  readFile?: (filePath: string) => Promise<Buffer>;
  stat?: (filePath: string) => Promise<{ size: number; mtimeMs: number }>;
};

/**
 * Scans allowlisted env files at the repository root and returns stable metadata
 * (no secret contents). Always returns one row per allowlisted filename.
 */
export async function detectRepoRootEnvFiles(
  repoRoot: string,
  options: DetectRepoRootEnvFilesOptions = {},
): Promise<RepoEnvFileDetectionResult> {
  const resolvedRoot = path.resolve(repoRoot);
  const legacyPastedEnvActive = options.legacyPastedEnvActive ?? false;
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const readFile = options.readFile ?? ((p) => fs.readFile(p));
  const stat =
    options.stat ??
    (async (p) => {
      const s = await fs.stat(p);
      return { size: s.size, mtimeMs: s.mtimeMs };
    });

  const files: RepoEnvFileDetectionEntry[] = [];

  for (const fileName of REPO_ENV_FILE_ALLOWLIST) {
    const sourcePath = path.join(resolvedRoot, fileName);
    let presence: 'found' | 'missing' = 'missing';
    let sizeBytes: number | undefined;
    let modifiedAt: string | undefined;
    let contentHash: string | undefined;

    if (isRepoRootEnvFilePath(resolvedRoot, sourcePath)) {
      try {
        const st = await stat(sourcePath);
        presence = 'found';
        sizeBytes = st.size;
        modifiedAt = new Date(st.mtimeMs).toISOString();
        const body = await readFile(sourcePath);
        contentHash = sha256FileHex(body);
      } catch (err: unknown) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as NodeJS.ErrnoException).code)
            : '';
        if (code !== 'ENOENT') {
          throw err;
        }
      }
    }

    const enablement = resolveEnablement(
      configuredEnablement(options.envFiles, fileName),
      presence,
      legacyPastedEnvActive,
      fileName,
    );

    files.push({
      fileName,
      sourcePath,
      presence,
      enablement,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(contentHash ? { contentHash } : {}),
    });
  }

  return {
    repoRoot: resolvedRoot,
    detectedAt,
    files,
    legacyPastedEnvActive,
  };
}

export type LegacyEnvMigrationKind =
  | 'none'
  | 'enable_detected_file'
  | 'keep_pasted';

/**
 * Whether legacy pasted {@link RepoConfig.env} can move to file-based sources without
 * losing the active worktree contract.
 */
export function resolveLegacyEnvMigrationKind(
  repo: Pick<RepoConfig, 'env' | 'envFiles'>,
  detection: RepoEnvFileDetectionResult,
): LegacyEnvMigrationKind {
  if (!hasLegacyPastedRepoEnv(repo)) return 'none';
  if (repo.envFiles?.sources && repo.envFiles.sources.length > 0) return 'none';
  const dotEnv = detection.files.find((f) => f.fileName === '.env');
  if (dotEnv?.presence === 'found') return 'enable_detected_file';
  return 'keep_pasted';
}

/**
 * Enables `.env` file sourcing and clears pasted `env` when a root `.env` file exists.
 * Otherwise returns the repo unchanged (safe no-op).
 */
export function migrateLegacyPastedEnvToEnvFiles(repo: RepoConfig): RepoConfig {
  if (repo.envFiles?.sources && repo.envFiles.sources.length > 0) {
    return repo;
  }
  if (!hasLegacyPastedRepoEnv(repo)) {
    return repo;
  }
  const next: RepoConfig = { ...repo };
  delete next.env;
  next.envFiles = {
    sources: [{ fileName: '.env', enablement: 'enabled' }],
  };
  return next;
}

/**
 * Applies {@link migrateLegacyPastedEnvToEnvFiles} only when detection shows a root `.env`.
 */
export async function migrateLegacyPastedEnvIfSafe(
  repo: RepoConfig,
  detectOptions?: Omit<DetectRepoRootEnvFilesOptions, 'legacyPastedEnvActive'>,
): Promise<{ repo: RepoConfig; migrated: boolean; kind: LegacyEnvMigrationKind }> {
  const detection = await detectRepoRootEnvFiles(repo.rootPath, {
    ...detectOptions,
    envFiles: repo.envFiles,
    legacyPastedEnvActive: hasLegacyPastedRepoEnv(repo),
  });
  const kind = resolveLegacyEnvMigrationKind(repo, detection);
  if (kind !== 'enable_detected_file') {
    return { repo, migrated: false, kind };
  }
  return {
    repo: migrateLegacyPastedEnvToEnvFiles(repo),
    migrated: true,
    kind,
  };
}

export async function detectAndBuildEnvFilesConfig(
  repo: Pick<RepoConfig, 'rootPath' | 'env' | 'envFiles'>,
  bindingEnvFiles?: RepoEnvFileSourcesConfig,
): Promise<{
  detection: RepoEnvFileDetectionResult;
  envFiles: RepoEnvFileSourcesConfig;
}> {
  const envFilesMerged = mergeRepoEnvFileSources(repo.envFiles, bindingEnvFiles);
  const detection = await detectRepoRootEnvFiles(repo.rootPath, {
    envFiles: envFilesMerged,
    legacyPastedEnvActive: hasLegacyPastedRepoEnv(repo),
  });
  return {
    detection,
    envFiles: envFileSourcesConfigFromDetection(detection),
  };
}

/** Persists detection enablement choices (no secret file bodies). */
export function envFileSourcesConfigFromDetection(
  detection: RepoEnvFileDetectionResult,
): RepoEnvFileSourcesConfig {
  return {
    lastDetectedAt: detection.detectedAt,
    sources: detection.files.map((f) => ({
      fileName: f.fileName,
      enablement: f.enablement,
    })),
  };
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
