import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  FLUXX_PROJECTS_SUBDIR,
  canonicalCloudProjectDir,
  sanitizeCloudProjectDirSegment,
} from '../projectDirPaths';

export { FLUXX_PROJECTS_SUBDIR, canonicalCloudProjectDir, sanitizeCloudProjectDirSegment };
/** @deprecated Use {@link FLUXX_PROJECTS_SUBDIR}. */
export const FLUX_PROJECTS_SUBDIR = FLUXX_PROJECTS_SUBDIR;

/** Pre-unification cloud workspace root (still honored when present). */
export const FLUXX_LEGACY_CLOUD_SUBDIR = 'cloud-projects';
/** @deprecated Use {@link FLUXX_LEGACY_CLOUD_SUBDIR}. */
export const FLUX_LEGACY_CLOUD_SUBDIR = FLUXX_LEGACY_CLOUD_SUBDIR;

/** Written into a legacy project dir after a copy-based migration so discovery dedupes. */
export const FLUXX_SUPERSEDED_SENTINEL = '.fluxx-superseded-by';
export const LEGACY_FLUX_SUPERSEDED_SENTINEL = '.flux-superseded-by';
export const FLUX_SUPERSEDED_SENTINEL = FLUXX_SUPERSEDED_SENTINEL;

/** Written when legacy and canonical project dirs cannot be safely reconciled. */
export const FLUXX_MIGRATION_CONFLICT_FILE = '.fluxx-migration-conflict.json';
export const LEGACY_FLUX_MIGRATION_CONFLICT_FILE = '.flux-migration-conflict.json';
export const FLUX_MIGRATION_CONFLICT_FILE = FLUXX_MIGRATION_CONFLICT_FILE;

const SUPERSEDED_SENTINEL_NAMES = [FLUXX_SUPERSEDED_SENTINEL, LEGACY_FLUX_SUPERSEDED_SENTINEL] as const;
const MIGRATION_CONFLICT_NAMES = [FLUXX_MIGRATION_CONFLICT_FILE, LEGACY_FLUX_MIGRATION_CONFLICT_FILE] as const;

const RESERVED_TOP_LEVEL = new Set([
  FLUXX_PROJECTS_SUBDIR,
  FLUXX_LEGACY_CLOUD_SUBDIR,
]);

export function stableLocalProjectIdForRoot(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex');
}

export function canonicalLocalProjectDir(fluxxBaseDir: string, localProjectId: string): string {
  return path.join(fluxxBaseDir, FLUXX_PROJECTS_SUBDIR, localProjectId);
}

export function legacyBasenameLocalProjectDir(fluxxBaseDir: string, resolvedRoot: string): string {
  return path.join(fluxxBaseDir, path.basename(resolvedRoot));
}

export function legacyCloudProjectDir(fluxxBaseDir: string, cloudProjectId: string): string {
  return path.join(
    fluxxBaseDir,
    FLUXX_LEGACY_CLOUD_SUBDIR,
    sanitizeCloudProjectDirSegment(cloudProjectId),
  );
}

export function isFluxTopLevelReservedDirName(name: string): boolean {
  return RESERVED_TOP_LEVEL.has(name);
}

export type ProjectMaterializationKind = 'local' | 'cloud';

export type ProjectDirResolverInput =
  | { kind: 'local'; id: string; rootPath: string }
  | { kind: 'cloud'; id: string; rootPath: string };

/**
 * Canonical per-project workspace directory under `~/.fluxx/projects/<id>/`.
 * - Local `id` is the stable SHA-256 of the resolved primary root (matches `config.json` `id`).
 * - Cloud `id` is the Firestore project id (sanitized for the path segment).
 */
export function resolveCanonicalProjectDir(
  fluxxBaseDir: string,
  input: ProjectDirResolverInput,
): string {
  if (input.kind === 'local') {
    return canonicalLocalProjectDir(fluxxBaseDir, input.id);
  }
  return canonicalCloudProjectDir(fluxxBaseDir, input.id);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function markProjectDirSuperseded(
  legacyDir: string,
  canonicalDir: string,
): Promise<void> {
  await fs.writeFile(
    path.join(legacyDir, FLUX_SUPERSEDED_SENTINEL),
    `${canonicalDir}\n`,
    'utf8',
  );
}

export async function writeProjectDirMigrationConflict(params: {
  legacyDir: string;
  canonicalDir: string;
  reason: string;
}): Promise<void> {
  const payload = {
    schemaVersion: 1,
    detectedAt: new Date().toISOString(),
    legacyDir: params.legacyDir,
    canonicalDir: params.canonicalDir,
    reason: params.reason,
  };
  await fs.writeFile(
    path.join(params.legacyDir, FLUX_MIGRATION_CONFLICT_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

export async function projectDirHasWorktrees(projectDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(path.join(projectDir, 'worktrees'));
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * When `~/.fluxx/projects/config.json` exists, `projects` was the repo basename, not the
 * nested layout container. Move the tree to `~/.fluxx/projects/<id>/` using a temp path so
 * `projects/` can become a normal container for other repos' nested dirs.
 */
export async function hoistLegacyFlatProjectsDirToNested(fluxxBaseDir: string): Promise<string> {
  const projectsRoot = path.join(fluxxBaseDir, FLUXX_PROJECTS_SUBDIR);
  const directConfig = path.join(projectsRoot, 'config.json');
  if (!(await pathExists(directConfig))) {
    throw new Error('hoistLegacyFlatProjectsDirToNested: expected ~/.fluxx/projects/config.json');
  }
  let id: string;
  try {
    const raw = JSON.parse(await fs.readFile(directConfig, 'utf8')) as { id?: unknown };
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new Error('missing id');
    }
    id = raw.id;
  } catch (e) {
    throw new Error(
      `Flux cannot migrate ~/.fluxx/projects/: invalid config.json (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const target = canonicalLocalProjectDir(fluxxBaseDir, id);
  if (await pathExists(path.join(target, 'config.json'))) {
    throw new Error(
      `Flux cannot migrate ~/.fluxx/projects/: ${target} already exists with a different layout.`,
    );
  }
  const staging = path.join(
    fluxxBaseDir,
    `.fluxx-relayout-staging-${id}-${process.pid}`,
  );
  await fs.rename(projectsRoot, staging);
  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.rename(staging, target);
  return target;
}

/**
 * Moves or copies `fromDir` → `toDir` when `fromDir` holds a project and `toDir` is unused.
 * After a copy (fallback), writes {@link FLUX_SUPERSEDED_SENTINEL} into `fromDir`.
 */
export async function migrateProjectDirToCanonical(
  fromDir: string,
  toDir: string,
): Promise<boolean> {
  if (path.resolve(fromDir) === path.resolve(toDir)) return true;

  const fromConfig = path.join(fromDir, 'config.json');
  if (!(await pathExists(fromConfig))) {
    return true;
  }

  if (await projectDirHasWorktrees(fromDir)) {
    return false;
  }

  const toConfig = path.join(toDir, 'config.json');
  if (await pathExists(toConfig)) {
    let same = false;
    try {
      const a = await fs.readFile(fromConfig, 'utf8');
      const b = await fs.readFile(toConfig, 'utf8');
      same = a === b;
    } catch {
      same = false;
    }
    if (same) {
      await markProjectDirSuperseded(fromDir, toDir);
      return true;
    }
    await writeProjectDirMigrationConflict({
      legacyDir: fromDir,
      canonicalDir: toDir,
      reason: 'Both directories contain config.json with different contents.',
    });
    throw new Error(
      `Flux project migration conflict: both "${fromDir}" and "${toDir}" contain config.json ` +
        'for different projects. Refusing to overwrite.',
    );
  }

  await fs.mkdir(path.dirname(toDir), { recursive: true });

  try {
    await fs.rename(fromDir, toDir);
    return true;
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== 'EXDEV' && code !== 'ENOTEMPTY' && code !== 'EPERM') {
      throw err;
    }
  }

  await fs.cp(fromDir, toDir, { recursive: true });
  await markProjectDirSuperseded(fromDir, toDir);
  return true;
}

export async function readSupersededTarget(dir: string): Promise<string | null> {
  for (const name of SUPERSEDED_SENTINEL_NAMES) {
    const p = path.join(dir, name);
    try {
      const raw = (await fs.readFile(p, 'utf8')).trim();
      if (raw.length > 0) return raw;
    } catch {
      /* try legacy sentinel */
    }
  }
  return null;
}

export async function readProjectDirMigrationConflict(
  legacyDir: string,
): Promise<{ legacyDir: string; canonicalDir: string; reason: string } | null> {
  for (const name of MIGRATION_CONFLICT_NAMES) {
    const p = path.join(legacyDir, name);
    try {
      const raw = await fs.readFile(p, 'utf8');
      const parsed = JSON.parse(raw) as {
        legacyDir?: unknown;
        canonicalDir?: unknown;
        reason?: unknown;
      };
      if (
        typeof parsed.legacyDir === 'string' &&
        typeof parsed.canonicalDir === 'string' &&
        typeof parsed.reason === 'string'
      ) {
        return parsed;
      }
    } catch {
      /* try legacy filename */
    }
  }
  return null;
}

/** Enumerate `~/.fluxx/projects/<id>/` directories that look like Flux projects. */
export async function listNestedProjectDirsUnderProjects(
  fluxxBaseDir: string,
): Promise<string[]> {
  const root = path.join(fluxxBaseDir, FLUXX_PROJECTS_SUBDIR);
  if (!(await isDirectory(root))) return [];
  const out: string[] = [];
  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const projectDir = path.join(root, ent.name);
    if (await pathExists(path.join(projectDir, 'config.json'))) {
      out.push(projectDir);
    }
  }
  return out;
}

/** `~/.fluxx/projects/config.json` — legacy repo whose folder name was `projects`. */
export async function legacyFlatProjectsDirIfPresent(fluxxBaseDir: string): Promise<string | null> {
  const root = path.join(fluxxBaseDir, FLUXX_PROJECTS_SUBDIR);
  if (await pathExists(path.join(root, 'config.json'))) {
    return root;
  }
  return null;
}

export async function listLegacyCloudProjectDirs(fluxxBaseDir: string): Promise<string[]> {
  const root = path.join(fluxxBaseDir, FLUXX_LEGACY_CLOUD_SUBDIR);
  if (!(await isDirectory(root))) return [];
  const out: string[] = [];
  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const projectDir = path.join(root, ent.name);
    if (await pathExists(path.join(projectDir, 'config.json'))) {
      out.push(projectDir);
    }
  }
  return out;
}

/**
 * Refuses deletion of `~/.fluxx/projects/` when it is the legacy flat layout (direct
 * `projects/config.json`) but nested `projects/<id>/` directories also exist — `fs.rm`
 * on the root would destroy unrelated projects.
 */
export async function assertSafeToDeleteLegacyFlatProjectsRoot(
  fluxxBaseDir: string,
  materialDir: string,
): Promise<void> {
  const projectsRoot = path.join(fluxxBaseDir, FLUXX_PROJECTS_SUBDIR);
  if (path.resolve(materialDir) !== path.resolve(projectsRoot)) return;
  const nested = await listNestedProjectDirsUnderProjects(fluxxBaseDir);
  if (nested.length > 0) {
    throw new Error(
      'Refusing to delete ~/.fluxx/projects/: nested project directories exist alongside the legacy flat config.json.',
    );
  }
}
