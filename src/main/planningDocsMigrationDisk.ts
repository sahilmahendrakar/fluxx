import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type FirestoreHydrationWritePlan,
  PLANNING_CLOUD_UNSYNCED_PREFIX,
} from '../planningDocs/cloudPlanningDocsMigration';
import { safeResolvePlanningMarkdownAbsPath } from '../planningDocs/path';
import type { PlanningDocsCloudMigrationPersistedV1 } from '../planningDocs/types';

import {
  FLUXX_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME,
  LEGACY_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME,
  resolvePlanningMetadataFileAbs,
} from '../planningDocs/fluxxPlanningPaths';

function migrationStatePathForWrite(planningDir: string): string {
  return path.join(planningDir, FLUXX_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME);
}

export async function readPlanningDocsCloudMigrationState(
  planningDir: string,
  expectedCloudProjectId: string,
): Promise<PlanningDocsCloudMigrationPersistedV1 | null> {
  const statePath = await resolvePlanningMetadataFileAbs(
    planningDir,
    FLUXX_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME,
    LEGACY_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME,
  );
  if (!statePath) return null;
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as PlanningDocsCloudMigrationPersistedV1;
    if (parsed?.version !== 1 || typeof parsed.cloudProjectId !== 'string') return null;
    if (parsed.cloudProjectId !== expectedCloudProjectId) return null;
    return parsed;
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') return null;
    console.error('[planningDocsMigration] read state failed', err);
    return null;
  }
}

export async function writePlanningDocsCloudMigrationState(
  planningDir: string,
  next: PlanningDocsCloudMigrationPersistedV1,
): Promise<void> {
  await fs.mkdir(planningDir, { recursive: true });
  const payload = `${JSON.stringify(next, null, 2)}\n`;
  await fs.writeFile(migrationStatePathForWrite(planningDir), payload, 'utf8');
}

export async function patchPlanningDocsCloudMigrationState(
  planningDir: string,
  cloudProjectId: string,
  patch: Partial<
    Pick<PlanningDocsCloudMigrationPersistedV1, 'didInitialHydrateFromCloud' | 'seedOfferResolved'>
  >,
): Promise<PlanningDocsCloudMigrationPersistedV1> {
  const prev =
    (await readPlanningDocsCloudMigrationState(planningDir, cloudProjectId)) ?? ({
      version: 1,
      cloudProjectId,
    } satisfies PlanningDocsCloudMigrationPersistedV1);
  const merged: PlanningDocsCloudMigrationPersistedV1 = {
    ...prev,
    cloudProjectId,
    ...patch,
  };
  await writePlanningDocsCloudMigrationState(planningDir, merged);
  return merged;
}

/**
 * Writes `_flux_unsynced/*` backups then canonical planning files from Firestore.
 */
export async function applyPlanningDocsFirestoreHydrationPlan(
  planningDir: string,
  plan: FirestoreHydrationWritePlan,
): Promise<{ ok: true } | { error: string }> {
  try {
    await fs.mkdir(planningDir, { recursive: true });
  } catch {
    return { error: 'Could not create planning directory.' };
  }

  for (const b of plan.backups) {
    const unsyncedRel = `${PLANNING_CLOUD_UNSYNCED_PREFIX}/${b.relativePath}`;
    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, unsyncedRel);
    if (!abs) {
      return { error: `Invalid backup path: ${unsyncedRel}` };
    }
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, b.markdown, 'utf8');
    } catch (err) {
      console.error('[planningDocsMigration] backup write failed', err);
      return { error: 'Failed to write unsynced backup copy.' };
    }
  }

  for (const w of plan.writes) {
    const abs = safeResolvePlanningMarkdownAbsPath(planningDir, w.relativePath);
    if (!abs) {
      return { error: `Invalid write path: ${w.relativePath}` };
    }
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, w.markdown, 'utf8');
    } catch (err) {
      console.error('[planningDocsMigration] canonical write failed', err);
      return { error: 'Failed to write planning file from cloud.' };
    }
  }

  return { ok: true };
}
