import fs from 'node:fs/promises';
import path from 'node:path';

/** Canonical planning sync metadata directory (writes always use this). */
export const FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX = '.fluxx-docs-sync';
export const LEGACY_PLANNING_DOCS_DISK_SYNC_PREFIX = '.flux-docs-sync';

/** @deprecated Import {@link FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX} — kept for transitional imports. */
export const PLANNING_DOCS_DISK_SYNC_REL_PREFIX = FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX;

export const FLUXX_PLANNING_INSTRUCTIONS_STATE_BASENAME = '.fluxx-instructions.json';
export const LEGACY_PLANNING_INSTRUCTIONS_STATE_BASENAME = '.flux-instructions.json';

/** @deprecated Import {@link FLUXX_PLANNING_INSTRUCTIONS_STATE_BASENAME}. */
export const PLANNING_INSTRUCTIONS_STATE_BASENAME = FLUXX_PLANNING_INSTRUCTIONS_STATE_BASENAME;

export const FLUXX_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME = '.fluxx-cloud-docs-migration.json';
export const LEGACY_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME = '.flux-cloud-docs-migration.json';

export const FLUXX_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME =
  '.fluxx-planning-user-docs-root-migration-v1.json';
export const LEGACY_PLANNING_USER_DOCS_LEGACY_MIGRATION_BASENAME =
  '.flux-planning-user-docs-root-migration-v1.json';

export const PLANNING_DISK_SYNC_DIR_NAMES = [
  FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX,
  LEGACY_PLANNING_DOCS_DISK_SYNC_PREFIX,
] as const;

export function isPlanningDiskSyncDirName(name: string): boolean {
  return (PLANNING_DISK_SYNC_DIR_NAMES as readonly string[]).includes(name);
}

export function isUnderPlanningDiskSyncRelPrefix(norm: string): boolean {
  for (const prefix of PLANNING_DISK_SYNC_DIR_NAMES) {
    if (norm === prefix || norm.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

export function isPlanningInstructionsStateBasename(name: string): boolean {
  return (
    name === FLUXX_PLANNING_INSTRUCTIONS_STATE_BASENAME ||
    name === LEGACY_PLANNING_INSTRUCTIONS_STATE_BASENAME
  );
}

export function isPlanningInstructionsStateRelPath(norm: string): boolean {
  return isPlanningInstructionsStateBasename(norm);
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Absolute path to the active sync dir for reads (prefers `.fluxx-docs-sync`). */
export async function resolvePlanningDiskSyncDirAbs(planningDir: string): Promise<string | null> {
  const candidates = PLANNING_DISK_SYNC_DIR_NAMES.map((name) => path.join(planningDir, name));
  return firstExistingPath(candidates);
}

/** All sync dirs present on disk (canonical first), for reads that must see legacy data. */
export async function listPlanningDiskSyncDirsAbs(planningDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of PLANNING_DISK_SYNC_DIR_NAMES) {
    const p = path.join(planningDir, name);
    try {
      await fs.access(p);
      out.push(p);
    } catch {
      /* not present */
    }
  }
  return out;
}

/** Absolute path for new sync metadata writes. */
export function planningDiskSyncDirAbsForWrite(planningDir: string): string {
  return path.join(planningDir, FLUXX_PLANNING_DOCS_DISK_SYNC_PREFIX);
}

export async function resolvePlanningMetadataFileAbs(
  planningDir: string,
  fluxxBasename: string,
  legacyBasename: string,
): Promise<string | null> {
  return firstExistingPath([
    path.join(planningDir, fluxxBasename),
    path.join(planningDir, legacyBasename),
  ]);
}

export function planningMetadataFileAbsForWrite(
  planningDir: string,
  fluxxBasename: string,
): string {
  return path.join(planningDir, fluxxBasename);
}
