import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  applyFirestorePlanningDocsSnapshot,
  persistPlanningDocsConflictLocal,
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

function userDocAbs(planningDir: string, rel: string): string {
  return path.join(planningDir, 'docs', rel);
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

    const body = await fs.readFile(userDocAbs(planningDir, rel), 'utf8');
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

    await fs.writeFile(userDocAbs(planningDir, rel), 'local-edit', 'utf8');

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

    const body = await fs.readFile(userDocAbs(planningDir, rel), 'utf8');
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

    await expect(fs.access(userDocAbs(planningDir, rel))).rejects.toMatchObject({
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

    await fs.writeFile(userDocAbs(planningDir, rel), 'edited', 'utf8');

    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [],
      removedDocIds: [docId],
    });
    expect(r).toEqual({ ok: true, changed: false });

    const body = await fs.readFile(userDocAbs(planningDir, rel), 'utf8');
    expect(body).toBe('edited');
    const state = await readPlanningDocsSyncState(planningDir);
    expect(state.files[rel]?.lastSyncedContentHash).toBe(sha('synced'));
  });

  it('skips rows when docId does not match encoded relativePath', async () => {
    const wrongId = planningRelativePathToFirestoreDocId('other.md');
    if (!wrongId) throw new Error('id');
    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId: wrongId,
          relativePath: rel,
          markdown: 'nope',
          remoteRevision: '1_0',
        },
      ],
      removedDocIds: [],
    });
    expect(r).toEqual({ ok: true, changed: false });
    await expect(fs.access(userDocAbs(planningDir, rel))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op when markdown and remote revision already match sync state', async () => {
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: '# stable',
          remoteRevision: '5_0',
        },
      ],
      removedDocIds: [],
    });

    const r2 = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: '# stable',
          remoteRevision: '5_0',
        },
      ],
      removedDocIds: [],
    });
    expect(r2).toEqual({ ok: true, changed: false });
  });

  it('returns INVALID_PAYLOAD for malformed snapshot', async () => {
    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: '',
      docs: [],
      removedDocIds: [],
    });
    expect(r).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
  });

  it('clears pausedPushPaths when a snapshot successfully applies after prior conflict pause', async () => {
    await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'base',
          remoteRevision: '1_0',
        },
      ],
      removedDocIds: [],
    });

    await persistPlanningDocsConflictLocal(planningDir, {
      schemaVersion: 1,
      relativePath: rel,
      createdAt: new Date().toISOString(),
      baseRemoteRevision: '1_0',
      localMarkdown: 'x',
      remoteMarkdown: 'y',
      remoteRevision: '2_0',
      remoteUpdatedBy: 'b',
      localUpdatedBy: 'a',
    });

    let st = await readPlanningDocsSyncState(planningDir);
    expect(st.pausedPushPaths?.[rel]).toBeDefined();

    await fs.writeFile(userDocAbs(planningDir, rel), 'base', 'utf8');

    const r = await applyFirestorePlanningDocsSnapshot(planningDir, {
      projectId: 'p1',
      docs: [
        {
          docId,
          relativePath: rel,
          markdown: 'from-cloud',
          remoteRevision: '3_0',
        },
      ],
      removedDocIds: [],
    });
    expect(r).toEqual({ ok: true, changed: true });

    st = await readPlanningDocsSyncState(planningDir);
    expect(st.pausedPushPaths?.[rel]).toBeUndefined();
    expect(st.files[rel]?.remoteRevision).toBe('3_0');
  });
});
