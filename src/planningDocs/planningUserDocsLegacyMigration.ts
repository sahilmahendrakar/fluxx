import fs from 'node:fs/promises';
import path from 'node:path';
import { isPlanningInstructionSeedFile } from './cloudPlanningDocsMigration';
import {
  isPlanningMarkdownRelativePathForbiddenForUserWrite,
  normalizePlanningDocRelativePath,
  planningUserDocsDir,
} from './path';

import {
  FLUXX_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME,
  LEGACY_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME,
  resolvePlanningMetadataFileAbs,
} from './fluxxPlanningPaths';

/** One-time marker next to `planning/` agent files (not a planning doc). */
export const PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME =
  FLUXX_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME;

export interface PlanningUserDocsRootMigrationStateV1 {
  schemaVersion: 1;
  completedAt: string;
  migratedPaths: string[];
  /** Canonical `docs/` path already had different content — source left in place. */
  skippedDestExists: string[];
  errors: string[];
}

function migrationStatePathForWrite(planningDir: string): string {
  return path.join(planningDir, PLANNING_USER_DOCS_LEGACY_MIGRATION_STATE_BASENAME);
}

function hasInstructionFilenameSegment(norm: string): boolean {
  return norm.split('/').some((seg) => {
    const l = seg.toLowerCase();
    return l === 'claude.md' || l === 'agents.md';
  });
}

function isMigratableUserMarkdownRel(norm: string): boolean {
  if (!norm) return false;
  if (isPlanningMarkdownRelativePathForbiddenForUserWrite(norm)) return false;
  if (isPlanningInstructionSeedFile(norm)) return false;
  if (hasInstructionFilenameSegment(norm)) return false;
  return true;
}

/**
 * Lists repo-relative `.md` paths under `planningDir` outside `docs/`, `_flux_unsynced/`,
 * dot-directories, and `docs/`.
 */
async function collectLegacyMarkdownRelPathsForMigration(planningDir: string): Promise<string[]> {
  async function walk(dir: string, base: string): Promise<string[]> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of sorted) {
      const rel = base ? `${base}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      const relSlash = rel.split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (ent.name === 'docs' || ent.name === '_flux_unsynced' || ent.name.startsWith('.')) {
          continue;
        }
        out.push(...(await walk(full, rel)));
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        const norm = normalizePlanningDocRelativePath(relSlash);
        if (!norm || !isMigratableUserMarkdownRel(norm)) {
          continue;
        }
        out.push(relSlash);
      }
    }
    return out;
  }
  return walk(planningDir, '');
}

async function readCompletedMigrationState(
  planningDir: string,
): Promise<PlanningUserDocsRootMigrationStateV1 | null> {
  const statePath = await resolvePlanningMetadataFileAbs(
    planningDir,
    FLUXX_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME,
    LEGACY_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME,
  );
  if (!statePath) return null;
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as PlanningUserDocsRootMigrationStateV1).schemaVersion === 1 &&
      typeof (parsed as PlanningUserDocsRootMigrationStateV1).completedAt === 'string'
    ) {
      return parsed as PlanningUserDocsRootMigrationStateV1;
    }
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') {
      console.error('[planningUserDocsMigration] read state failed', err);
    }
  }
  return null;
}

async function filesByteIdentical(a: string, b: string): Promise<boolean> {
  try {
    const [bufA, bufB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return bufA.equals(bufB);
  } catch {
    return false;
  }
}

/**
 * Moves legacy planning markdown from the workspace root (outside `docs/`) into
 * `planning/docs/` once per workspace, preserving relative paths. Skips `CLAUDE.md` /
 * `AGENTS.md` (planning root instruction seeds) and any path segment named like those
 * files; leaves sources in place when `docs/` already has different content at the destination.
 */
export async function migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir: string): Promise<void> {
  const prev = await readCompletedMigrationState(planningDir);
  if (prev) {
    return;
  }

  try {
    await fs.mkdir(planningDir, { recursive: true });
    await fs.mkdir(planningUserDocsDir(planningDir), { recursive: true });
  } catch (err) {
    console.error('[planningUserDocsMigration] mkdir failed', err);
    return;
  }

  const relPaths = await collectLegacyMarkdownRelPathsForMigration(planningDir);
  const migratedPaths: string[] = [];
  const skippedDestExists: string[] = [];
  const errors: string[] = [];

  for (const relSlash of relPaths) {
    const norm = normalizePlanningDocRelativePath(relSlash);
    if (!norm) continue;
    const fromAbs = path.join(planningDir, ...norm.split('/'));
    const toAbs = path.join(planningUserDocsDir(planningDir), ...norm.split('/'));

    try {
      await fs.access(fromAbs);
    } catch {
      continue;
    }

    let destExists = false;
    try {
      await fs.access(toAbs);
      destExists = true;
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code !== 'ENOENT') {
        errors.push(`${norm}: stat dest: ${String(err)}`);
        continue;
      }
    }

    if (destExists) {
      const same = await filesByteIdentical(fromAbs, toAbs);
      if (same) {
        try {
          await fs.unlink(fromAbs);
          migratedPaths.push(norm);
        } catch (err) {
          errors.push(`${norm}: unlink duplicate source: ${String(err)}`);
        }
      } else {
        skippedDestExists.push(norm);
      }
      continue;
    }

    try {
      await fs.mkdir(path.dirname(toAbs), { recursive: true });
      await fs.rename(fromAbs, toAbs);
      migratedPaths.push(norm);
    } catch (err) {
      errors.push(`${norm}: ${String(err)}`);
    }
  }

  const state: PlanningUserDocsRootMigrationStateV1 = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    migratedPaths,
    skippedDestExists,
    errors,
  };

  try {
    await fs.writeFile(migrationStatePathForWrite(planningDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[planningUserDocsMigration] write state failed', err);
    return;
  }

  if (migratedPaths.length > 0) {
    console.info(
      `[planningUserDocsMigration] moved ${migratedPaths.length} legacy planning markdown file(s) into planning/docs/`,
    );
  }
  if (skippedDestExists.length > 0) {
    console.warn(
      `[planningUserDocsMigration] skipped ${skippedDestExists.length} path(s) with existing different content under planning/docs/`,
    );
  }
  if (errors.length > 0) {
    console.error('[planningUserDocsMigration] errors', errors);
  }
}
