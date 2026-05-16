import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PLANNING_CLOUD_UNSYNCED_PREFIX } from './planningDocs/cloudPlanningDocsMigration';
import { PLANNING_DOCS_DISK_SYNC_REL_PREFIX } from './planningDocs/path';
import {
  MAX_TASK_ATTACHED_PLANNING_DOCS,
  assertAttachedPlanningMarkdownFilesExist,
  parsePersistedTaskAttachedPlanningDocs,
  parseTaskAttachedPlanningDocsForMcp,
  sanitizeTaskAttachedPlanningDocsInput,
} from './taskAttachedPlanningDocs';

describe('sanitizeTaskAttachedPlanningDocsInput', () => {
  it('normalizes slashes, dedupes, and keeps .md paths', () => {
    expect(
      sanitizeTaskAttachedPlanningDocsInput([
        { relativePath: 'Spec\\\\foo.md' },
        { relativePath: '/Spec/foo.md' },
        { relativePath: 'other.md' },
      ]),
    ).toEqual([{ relativePath: 'Spec/foo.md' }, { relativePath: 'other.md' }]);
  });

  it('drops traversal, non-markdown, and malformed entries', () => {
    expect(
      sanitizeTaskAttachedPlanningDocsInput([
        { relativePath: '../escape.md' },
        { relativePath: 'readme.txt' },
        { relativePath: '' },
        'not-an-object' as unknown as { relativePath: string },
        { relativePath: 'ok.md' },
      ]),
    ).toEqual([{ relativePath: 'ok.md' }]);
  });

  it('drops .flux-docs-sync and _flux_unsynced trees', () => {
    expect(
      sanitizeTaskAttachedPlanningDocsInput([
        { relativePath: `${PLANNING_DOCS_DISK_SYNC_REL_PREFIX}/x.md` },
        { relativePath: `${PLANNING_CLOUD_UNSYNCED_PREFIX}/y.md` },
        { relativePath: 'plans/z.md' },
      ]),
    ).toEqual([{ relativePath: 'plans/z.md' }]);
  });

  it('caps list length to MAX_TASK_ATTACHED_PLANNING_DOCS (aligns with Firestore rules)', () => {
    expect(MAX_TASK_ATTACHED_PLANNING_DOCS).toBe(32);
    const raw = Array.from({ length: 40 }, (_, i) => ({
      relativePath: `f${i}.md`,
    }));
    expect(sanitizeTaskAttachedPlanningDocsInput(raw)).toHaveLength(32);
  });
});

describe('parsePersistedTaskAttachedPlanningDocs', () => {
  it('returns undefined when nothing survives', () => {
    expect(parsePersistedTaskAttachedPlanningDocs([{ relativePath: 'nope.txt' }])).toBeUndefined();
    expect(parsePersistedTaskAttachedPlanningDocs([{ relativePath: 'y.md' }])).toEqual([
      { relativePath: 'y.md' },
    ]);
  });
});

describe('parseTaskAttachedPlanningDocsForMcp', () => {
  it('accepts undefined, null on update only, and valid arrays', () => {
    expect(parseTaskAttachedPlanningDocsForMcp(undefined, 'create')).toEqual({
      ok: true,
      docs: undefined,
    });
    expect(parseTaskAttachedPlanningDocsForMcp(undefined, 'update')).toEqual({
      ok: true,
      docs: undefined,
    });
    expect(parseTaskAttachedPlanningDocsForMcp(null, 'update')).toEqual({ ok: true, docs: null });
    expect(parseTaskAttachedPlanningDocsForMcp(null, 'create').ok).toBe(false);
    expect(parseTaskAttachedPlanningDocsForMcp([], 'create')).toEqual({ ok: true, docs: [] });
    expect(parseTaskAttachedPlanningDocsForMcp([{ relativePath: 'a.md' }], 'create')).toEqual({
      ok: true,
      docs: [{ relativePath: 'a.md' }],
    });
  });

  it('rejects invalid shapes and paths', () => {
    expect(parseTaskAttachedPlanningDocsForMcp('x', 'create').ok).toBe(false);
    expect(parseTaskAttachedPlanningDocsForMcp([{ relativePath: '../x.md' }], 'create').ok).toBe(
      false,
    );
    expect(
      parseTaskAttachedPlanningDocsForMcp(
        [{ relativePath: `${PLANNING_DOCS_DISK_SYNC_REL_PREFIX}/x.md` }],
        'update',
      ).ok,
    ).toBe(false);
    expect(
      parseTaskAttachedPlanningDocsForMcp(
        [{ relativePath: `${PLANNING_CLOUD_UNSYNCED_PREFIX}/x.md` }],
        'update',
      ).ok,
    ).toBe(false);
    expect(parseTaskAttachedPlanningDocsForMcp([{ relativePath: 'a.md' }, { relativePath: 'a.md' }], 'create')).toEqual({
      ok: true,
      docs: [{ relativePath: 'a.md' }],
    });
  });

  it('rejects lists longer than MAX_TASK_ATTACHED_PLANNING_DOCS', () => {
    const raw = Array.from({ length: MAX_TASK_ATTACHED_PLANNING_DOCS + 1 }, (_, i) => ({
      relativePath: `f${i}.md`,
    }));
    expect(parseTaskAttachedPlanningDocsForMcp(raw, 'create').ok).toBe(false);
  });
});

describe('assertAttachedPlanningMarkdownFilesExist', () => {
  it('passes when each path is an existing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-attach-'));
    await fs.writeFile(path.join(dir, 'ok.md'), '# x', 'utf8');
    await expect(
      assertAttachedPlanningMarkdownFilesExist(dir, [{ relativePath: 'ok.md' }]),
    ).resolves.toEqual({ ok: true });
  });

  it('fails when planning dir missing or file missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-attach-'));
    const r = await assertAttachedPlanningMarkdownFilesExist(dir, [{ relativePath: 'nope.md' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('not found');
    }
    const bad = await assertAttachedPlanningMarkdownFilesExist(
      path.join(dir, 'nonexistent-planning'),
      [{ relativePath: 'x.md' }],
    );
    expect(bad.ok).toBe(false);
  });
});
