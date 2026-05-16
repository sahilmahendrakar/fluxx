import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { listPlanningDocsPushCandidates } from './planningDocsFirestorePush';
import {
  applyFirestorePlanningDocsSnapshot,
  persistPlanningDocsConflictLocal,
  readPlanningDocsSyncState,
} from './planningDocsFirestoreHydrate';
import { patchPlanningDocsCloudMigrationState } from './planningDocsMigrationDisk';
import { planningRelativePathToFirestoreDocId } from '../planningDocs/path';

const TEST_CLOUD_PROJECT_ID = 'test-cloud-project';

function sha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function mkPlanningDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-push-'));
  const planningDir = path.join(root, 'planning');
  await fs.mkdir(planningDir, { recursive: true });
  return planningDir;
}

describe('listPlanningDocsPushCandidates', () => {
  let planningDir: string;

  beforeEach(async () => {
    planningDir = await mkPlanningDir();
    await patchPlanningDocsCloudMigrationState(planningDir, TEST_CLOUD_PROJECT_ID, {
      didInitialHydrateFromCloud: true,
    });
  });

  it('returns paths whose content differs from last synced hash', async () => {
    const rel = 'notes/a.md';
    const docId = planningRelativePathToFirestoreDocId(rel);
    if (!docId) throw new Error('id');
    await fs.mkdir(path.join(planningDir, 'docs', 'notes'), { recursive: true });

    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'remote',
          remoteRevision: '1_0',
        },
      ],
      removedDocIds: [],
    });

    await fs.writeFile(path.join(planningDir, 'docs', rel), 'edited', 'utf8');

    const candidates = await listPlanningDocsPushCandidates(planningDir, TEST_CLOUD_PROJECT_ID);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.relativePath).toBe(rel);
    expect(candidates[0]?.markdown).toBe('edited');
    expect(candidates[0]?.contentSha256).toBe(sha('edited'));
    expect(candidates[0]?.expectedRemoteRevision).toBe('1_0');
  });

  it('skips markdown under .flux-docs-sync and _flux_unsynced', async () => {
    await fs.mkdir(path.join(planningDir, '.flux-docs-sync', 'nested'), { recursive: true });
    await fs.writeFile(
      path.join(planningDir, '.flux-docs-sync', 'nested', 'x.md'),
      'secret',
      'utf8',
    );
    await fs.mkdir(path.join(planningDir, '_flux_unsynced'), { recursive: true });
    await fs.writeFile(path.join(planningDir, '_flux_unsynced', 'y.md'), 'backup', 'utf8');

    await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', 'ok.md'), 'body', 'utf8');

    const candidates = await listPlanningDocsPushCandidates(planningDir, TEST_CLOUD_PROJECT_ID);
    expect(candidates.map((c) => c.relativePath)).toEqual(['ok.md']);
  });

  it('skips paths paused after a conflict', async () => {
    const rel = 'notes/a.md';
    await fs.mkdir(path.join(planningDir, 'docs', 'notes'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', rel), 'local', 'utf8');

    await persistPlanningDocsConflictLocal(planningDir, {
      schemaVersion: 1,
      relativePath: rel,
      createdAt: new Date().toISOString(),
      baseRemoteRevision: '1_0',
      localMarkdown: 'local',
      remoteMarkdown: 'remote',
      remoteRevision: '2_0',
      remoteUpdatedBy: 'other',
      localUpdatedBy: 'me',
    });

    const candidates = await listPlanningDocsPushCandidates(planningDir, TEST_CLOUD_PROJECT_ID);
    expect(candidates).toHaveLength(0);

    const state = await readPlanningDocsSyncState(planningDir);
    expect(state.pausedPushPaths?.[rel]).toBeDefined();
  });

  it('unlocks push when sync state exists without migration metadata', async () => {
    const freshDir = await mkPlanningDir();
    const rel = 'solo.md';
    const docId = planningRelativePathToFirestoreDocId(rel);
    if (!docId) throw new Error('id');
    await applyFirestorePlanningDocsSnapshot(freshDir, {
      projectId: 'p1',
      docs: [{ docId, relativePath: rel, markdown: 'remote', remoteRevision: '9_0' }],
      removedDocIds: [],
    });
    await fs.mkdir(path.join(freshDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(freshDir, 'docs', rel), 'local', 'utf8');
    const candidates = await listPlanningDocsPushCandidates(freshDir, TEST_CLOUD_PROJECT_ID);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.markdown).toBe('local');
  });

  it('returns no candidates until migration unlocks push', async () => {
    const freshDir = await mkPlanningDir();
    await fs.mkdir(path.join(freshDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(freshDir, 'docs', 'only.md'), 'x', 'utf8');

    const blocked = await listPlanningDocsPushCandidates(freshDir, 'other-cloud-id');
    expect(blocked).toHaveLength(0);

    await patchPlanningDocsCloudMigrationState(freshDir, 'other-cloud-id', {
      seedOfferResolved: 'skipped',
    });
    const unlocked = await listPlanningDocsPushCandidates(freshDir, 'other-cloud-id');
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]?.relativePath).toBe('only.md');
  });
});
