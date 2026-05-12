import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES,
  isPlanningMarkdownRelativePathForbiddenForUserWrite,
  normalizePlanningDocRelativePath,
  planningFirestoreDocIdToRelativePath,
  planningRelativePathToFirestoreDocId,
  safeResolvePlanningMarkdownAbsPath,
} from './path';

describe('normalizePlanningDocRelativePath', () => {
  it('accepts nested markdown paths', () => {
    expect(normalizePlanningDocRelativePath('notes/architecture.md')).toBe('notes/architecture.md');
  });

  it('normalizes backslashes', () => {
    expect(normalizePlanningDocRelativePath(String.raw`dir\file.md`)).toBe('dir/file.md');
  });

  it('rejects path traversal segments', () => {
    expect(normalizePlanningDocRelativePath('../evil.md')).toBeNull();
    expect(normalizePlanningDocRelativePath('foo/../../evil.md')).toBeNull();
    expect(normalizePlanningDocRelativePath('foo/../bar.md')).toBeNull();
  });

  it('rejects non-markdown files', () => {
    expect(normalizePlanningDocRelativePath('x/config.json')).toBeNull();
    expect(normalizePlanningDocRelativePath('readme.txt')).toBeNull();
  });

  it('accepts unicode file names', () => {
    expect(normalizePlanningDocRelativePath('文档/愿景.md')).toBe('文档/愿景.md');
  });
});

describe('safeResolvePlanningMarkdownAbsPath', () => {
  it('returns null for traversal attempts after normalization', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });
    await fs.writeFile(path.join(planningDir, 'real.md'), '# ok', 'utf8');

    const outside = path.join(root, 'outside.md');
    await fs.writeFile(outside, '# no', 'utf8');

    const rel = path.relative(planningDir, outside).split(path.sep).join('/');
    const resolved = safeResolvePlanningMarkdownAbsPath(planningDir, rel);
    expect(resolved).toBeNull();
  });

  it('resolves a valid nested markdown file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(path.join(planningDir, 'a'), { recursive: true });
    const target = path.join(planningDir, 'a', 'b.md');
    await fs.writeFile(target, 'x', 'utf8');
    expect(safeResolvePlanningMarkdownAbsPath(planningDir, 'a/b.md')).toBe(target);
  });
});

describe('planningRelativePathToFirestoreDocId', () => {
  it('round-trips canonical paths', () => {
    const rel = 'folder/hello.md';
    const id = planningRelativePathToFirestoreDocId(rel);
    expect(typeof id).toBe('string');
    if (typeof id !== 'string') return;
    expect(planningFirestoreDocIdToRelativePath(id)).toBe(rel);
  });

  it('rejects ids that do not round-trip', () => {
    expect(planningFirestoreDocIdToRelativePath('@@@@')).toBeNull();
  });

  it('returns null when UTF-8 path exceeds max length', () => {
    const filler = 'a'.repeat(MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES);
    expect(planningRelativePathToFirestoreDocId(`${filler}.md`)).toBeNull();
  });
});

describe('isPlanningMarkdownRelativePathForbiddenForUserWrite', () => {
  it('blocks .flux-docs-sync tree', () => {
    expect(isPlanningMarkdownRelativePathForbiddenForUserWrite('.flux-docs-sync/state.md')).toBe(true);
    expect(isPlanningMarkdownRelativePathForbiddenForUserWrite('notes/ok.md')).toBe(false);
  });

  it('blocks _flux_unsynced tree', () => {
    expect(isPlanningMarkdownRelativePathForbiddenForUserWrite('_flux_unsynced/backup.md')).toBe(true);
  });

  it('returns false for invalid paths (handled elsewhere)', () => {
    expect(isPlanningMarkdownRelativePathForbiddenForUserWrite('../x.md')).toBe(false);
  });
});
