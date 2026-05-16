import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { enrichPlanningDocsListForCloudWorkspace } from './planningDocsListEnrichment';
import { applyFirestorePlanningDocsSnapshot, persistPlanningDocsConflictLocal } from './planningDocsFirestoreHydrate';
import { patchPlanningDocsCloudMigrationState } from './planningDocsMigrationDisk';
import { planningRelativePathToFirestoreDocId } from '../planningDocs/path';

const CLOUD_ID = 'cloud-proj-enrich';

async function mkPlanningDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-enrich-'));
  const planningDir = path.join(root, 'planning');
  await fs.mkdir(planningDir, { recursive: true });
  return planningDir;
}

describe('enrichPlanningDocsListForCloudWorkspace', () => {
  let planningDir: string;

  beforeEach(async () => {
    planningDir = await mkPlanningDir();
    await patchPlanningDocsCloudMigrationState(planningDir, CLOUD_ID, {
      didInitialHydrateFromCloud: true,
    });
  });

  it('passes through list errors unchanged', async () => {
    const r = await enrichPlanningDocsListForCloudWorkspace(planningDir, CLOUD_ID, { error: 'IO_ERROR' });
    expect(r).toEqual({ error: 'IO_ERROR' });
  });

  it('marks synced when disk hash matches sync state', async () => {
    const rel = 'a.md';
    const docId = planningRelativePathToFirestoreDocId(rel);
    if (!docId) throw new Error('id');
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p',
      docs: [{ docId, relativePath: rel, markdown: 'same', remoteRevision: '1_0' }],
      removedDocIds: [],
    });

    const enriched = await enrichPlanningDocsListForCloudWorkspace(planningDir, CLOUD_ID, {
      files: [{ relativePath: rel }],
    });
    expect('error' in enriched).toBe(false);
    if ('error' in enriched) return;
    expect(enriched.files[0]?.syncStatus).toBe('synced');
    expect(enriched.files[0]?.metadata?.revision).toBe('1_0');
    expect(enriched.cloudListMeta?.totalSynced).toBe(1);
    expect(enriched.cloudListMeta?.totalPendingPush).toBe(0);
    expect(enriched.cloudListMeta?.source).toBe('cloud-firestore-mirror');
  });

  it('marks conflict when push is paused after persistConflict', async () => {
    const rel = 'b.md';
    await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', rel), 'local', 'utf8');
    await persistPlanningDocsConflictLocal(planningDir, {
      schemaVersion: 1,
      relativePath: rel,
      createdAt: new Date().toISOString(),
      baseRemoteRevision: '0_0',
      localMarkdown: 'local',
      remoteMarkdown: 'remote',
      remoteRevision: '1_0',
      remoteUpdatedBy: 'u2',
      localUpdatedBy: 'u1',
    });

    const enriched = await enrichPlanningDocsListForCloudWorkspace(planningDir, CLOUD_ID, {
      files: [{ relativePath: rel }],
    });
    expect('error' in enriched).toBe(false);
    if ('error' in enriched) return;
    expect(enriched.files[0]?.syncStatus).toBe('conflict');
    expect(enriched.files[0]?.syncInfo?.conflictPausedAt).toBeDefined();
    expect(enriched.cloudListMeta?.totalConflictPaths).toBe(1);
  });
});
