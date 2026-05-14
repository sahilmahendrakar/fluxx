import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Nested layout root: `~/.flux/projects/<projectId>/`. */
export const FLUX_PROJECTS_SUBDIR = 'projects';

/** Pre-unification cloud workspace root (still honored when present). */
export const FLUX_LEGACY_CLOUD_SUBDIR = 'cloud-projects';

/** Written into a legacy project dir after a copy-based migration so discovery dedupes. */
export const FLUX_SUPERSEDED_SENTINEL = '.flux-superseded-by';

/** Written when legacy and canonical project dirs cannot be safely reconciled. */
export const FLUX_MIGRATION_CONFLICT_FILE = '.flux-migration-conflict.json';

const RESERVED_TOP_LEVEL = new Set([
  FLUX_PROJECTS_SUBDIR,
  FLUX_LEGACY_CLOUD_SUBDIR,
]);

export function stableLocalProjectIdForRoot(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex');
}

export function sanitizeCloudProjectDirSegment(cloudProjectId: string): string {
  return cloudProjectId.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function canonicalLocalProjectDir(fluxBaseDir: string, localProjectId: string): string {
  return path.join(fluxBaseDir, FLUX_PROJECTS_SUBDIR, localProjectId);
}

export function canonicalCloudProjectDir(fluxBaseDir: string, cloudProjectId: string): string {
  return path.join(
    fluxBaseDir,
    FLUX_PROJECTS_SUBDIR,
    sanitizeCloudProjectDirSegment(cloudProjectId),
  );
}

export function legacyBasenameLocalProjectDir(fluxBaseDir: string, resolvedRoot: string): string {
  return path.join(fluxBaseDir, path.basename(resolvedRoot));
}

export function legacyCloudProjectDir(fluxBaseDir: string, cloudProjectId: string): string {
  return path.join(
    fluxBaseDir,
    FLUX_LEGACY_CLOUD_SUBDIR,
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
 * Canonical per-project workspace directory under `~/.flux/projects/<id>/`.
 * - Local `id` is the stable SHA-256 of the resolved primary root (matches `config.json` `id`).
 * - Cloud `id` is the Firestore project id (sanitized for the path segment).
 */
export function resolveCanonicalProjectDir(
  fluxBaseDir: string,
  input: ProjectDirResolverInput,
): string {
  if (input.kind === 'local') {
    return canonicalLocalProjectDir(fluxBaseDir, input.id);
  }
  return canonicalCloudProjectDir(fluxBaseDir, input.id);
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
 * When `~/.flux/projects/config.json` exists, `projects` was the repo basename, not the
 * nested layout container. Move the tree to `~/.flux/projects/<id>/` using a temp path so
 * `projects/` can become a normal container for other repos' nested dirs.
 */
export async function hoistLegacyFlatProjectsDirToNested(fluxBaseDir: string): Promise<string> {
  const projectsRoot = path.join(fluxBaseDir, FLUX_PROJECTS_SUBDIR);
  const directConfig = path.join(projectsRoot, 'config.json');
  if (!(await pathExists(directConfig))) {
    throw new Error('hoistLegacyFlatProjectsDirToNested: expected ~/.flux/projects/config.json');
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
      `Flux cannot migrate ~/.flux/projects/: invalid config.json (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const target = canonicalLocalProjectDir(fluxBaseDir, id);
  if (await pathExists(path.join(target, 'config.json'))) {
    throw new Error(
      `Flux cannot migrate ~/.flux/projects/: ${target} already exists with a different layout.`,
    );
  }
  const staging = path.join(
    fluxBaseDir,
    `.flux-relayout-staging-${id}-${process.pid}`,
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
  const p = path.join(dir, FLUX_SUPERSEDED_SENTINEL);
  try {
    const raw = (await fs.readFile(p, 'utf8')).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Enumerate `~/.flux/projects/<id>/` directories that look like Flux projects. */
export async function listNestedProjectDirsUnderProjects(
  fluxBaseDir: string,
): Promise<string[]> {
  const root = path.join(fluxBaseDir, FLUX_PROJECTS_SUBDIR);
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

/** `~/.flux/projects/config.json` — legacy repo whose folder name was `projects`. */
export async function legacyFlatProjectsDirIfPresent(fluxBaseDir: string): Promise<string | null> {
  const root = path.join(fluxBaseDir, FLUX_PROJECTS_SUBDIR);
  if (await pathExists(path.join(root, 'config.json'))) {
    return root;
  }
  return null;
}

export async function listLegacyCloudProjectDirs(fluxBaseDir: string): Promise<string[]> {
  const root = path.join(fluxBaseDir, FLUX_LEGACY_CLOUD_SUBDIR);
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
 * Refuses deletion of `~/.flux/projects/` when it is the legacy flat layout (direct
 * `projects/config.json`) but nested `projects/<id>/` directories also exist — `fs.rm`
 * on the root would destroy unrelated projects.
 */
export async function assertSafeToDeleteLegacyFlatProjectsRoot(
  fluxBaseDir: string,
  materialDir: string,
): Promise<void> {
  const projectsRoot = path.join(fluxBaseDir, FLUX_PROJECTS_SUBDIR);
  if (path.resolve(materialDir) !== path.resolve(projectsRoot)) return;
  const nested = await listNestedProjectDirsUnderProjects(fluxBaseDir);
  if (nested.length > 0) {
    throw new Error(
      'Refusing to delete ~/.flux/projects/: nested project directories exist alongside the legacy flat config.json.',
    );
  }
}
