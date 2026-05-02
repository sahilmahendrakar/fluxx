import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  applyFirestorePlanningDocsSnapshot,
  readPlanningDocsSyncState,
} from './planningDocsFirestoreHydrate';
import { planningRelativePathToFirestoreDocId } from '../planningDocs/path';

async function mkPlanningDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-hydrate-'));
  const planningDir = path.join(root, 'planning');
  await fs.mkdir(planningDir, { recursive: true });
  return planningDir;
}

function sha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('applyFirestorePlanningDocsSnapshot', () => {
  let planningDir: string;
  const rel = 'notes/shared.md';
  let docId: string;

  beforeEach(async () => {
    planningDir = await mkPlanningDir();
    const id = planningRelativePathToFirestoreDocId(rel);
    if (!id) throw new Error('doc id');
    docId = id;
  });

  it('writes markdown and records sync metadata', async () => {
    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: '# hello',
          remoteRevision: '1_0',
        },
      ],
      removedDocIds: [],
    });
    expect(r).toEqual({ ok: true, changed: true });

    const body = await fs.readFile(path.join(planningDir, rel), 'utf8');
    expect(body).toBe('# hello');

    const state = await readPlanningDocsSyncState(planningDir);
    expect(state.files[rel]?.remoteRevision).toBe('1_0');
    expect(state.files[rel]?.lastSyncedContentHash).toBe(sha('# hello'));
  });

  it('does not overwrite when local file diverged from last synced revision', async () => {
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'v1',
          remoteRevision: '1_0',
        },
      ],
      removedDocIds: [],
    });

    await fs.writeFile(path.join(planningDir, rel), 'local-edit', 'utf8');

    const r2 = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'v2',
          remoteRevision: '2_0',
        },
      ],
      removedDocIds: [],
    });
    expect(r2).toEqual({ ok: true, changed: false });

    const body = await fs.readFile(path.join(planningDir, rel), 'utf8');
    expect(body).toBe('local-edit');
  });

  it('removes local file on remote delete when disk still matches last sync', async () => {
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'gone',
          remoteRevision: '9_0',
        },
      ],
      removedDocIds: [],
    });

    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [],
      removedDocIds: [docId],
    });
    expect(r).toEqual({ ok: true, changed: true });

    await expect(fs.access(path.join(planningDir, rel))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const state = await readPlanningDocsSyncState(planningDir);
    expect(state.files[rel]).toBeUndefined();
  });

  it('keeps local file on remote delete when disk diverged', async () => {
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'synced',
          remoteRevision: '9_0',
        },
      ],
      removedDocIds: [],
    });

    await fs.writeFile(path.join(planningDir, rel), 'edited', 'utf8');

    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [],
      removedDocIds: [docId],
    });
    expect(r).toEqual({ ok: true, changed: false });

    const body = await fs.readFile(path.join(planningDir, rel), 'utf8');
    expect(body).toBe('edited');
    const state = await readPlanningDocsSyncState(planningDir);
    expect(state.files[rel]?.lastSyncedContentHash).toBe(sha('synced'));
  });
});
