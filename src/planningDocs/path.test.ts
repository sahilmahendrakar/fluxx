import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PLANNING_RELATIVE_PATH_UTF8_BYTES,
  isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite,
  isPlanningMarkdownRelativePathForbiddenForUserWrite,
  isPlanningUserDocRelativePathDisallowed,
  normalizePlanningDocRelativePath,
  planningFirestoreDocIdToRelativePath,
  planningLegacyUserMarkdownAbsPath,
  planningRelativePathToFirestoreDocId,
  planningUserDocsDir,
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

  it('strips a leading docs/ segment (planning workspace cwd)', () => {
    expect(normalizePlanningDocRelativePath('docs/readme.md')).toBe('readme.md');
    expect(normalizePlanningDocRelativePath('docs/nested/x.md')).toBe('nested/x.md');
    expect(normalizePlanningDocRelativePath('docs/2026-05-sprint.md')).toBe('2026-05-sprint.md');
  });

  it('dedupes docs/ prefix with canonical paths', () => {
    expect(normalizePlanningDocRelativePath('docs/flux-web-redesign-plan.md')).toBe(
      'flux-web-redesign-plan.md',
    );
    expect(normalizePlanningDocRelativePath('flux-web-redesign-plan.md')).toBe(
      'flux-web-redesign-plan.md',
    );
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
    await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(planningDir, 'docs', 'real.md'), '# ok', 'utf8');

    const outside = path.join(root, 'outside.md');
    await fs.writeFile(outside, '# no', 'utf8');

    const rel = path.relative(planningDir, outside).split(path.sep).join('/');
    const resolved = safeResolvePlanningMarkdownAbsPath(planningDir, rel);
    expect(resolved).toBeNull();
  });

  it('resolves user markdown under planning/docs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(path.join(planningDir, 'docs', 'a'), { recursive: true });
    const target = path.join(planningDir, 'docs', 'a', 'b.md');
    await fs.writeFile(target, 'x', 'utf8');
    expect(safeResolvePlanningMarkdownAbsPath(planningDir, 'a/b.md')).toBe(target);
  });

  it('resolves instruction seeds at the planning workspace root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-planning-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });
    const claude = path.join(planningDir, 'CLAUDE.md');
    await fs.writeFile(claude, 'x', 'utf8');
    expect(safeResolvePlanningMarkdownAbsPath(planningDir, 'CLAUDE.md')).toBe(claude);
  });
});

describe('planningLegacyUserMarkdownAbsPath', () => {
  it('returns a path outside docs/ for legacy layouts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-legacy-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });
    const legacy = path.join(planningDir, 'old.md');
    await fs.writeFile(legacy, 'z', 'utf8');
    expect(planningLegacyUserMarkdownAbsPath(planningDir, 'old.md')).toBe(legacy);
  });

  it('still maps top-level relative names to the planning root (outside docs/)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-legacy-'));
    const planningDir = path.join(root, 'planning');
    await fs.mkdir(planningDir, { recursive: true });
    expect(planningLegacyUserMarkdownAbsPath(planningDir, 'readme.md')).toBe(
      path.join(planningDir, 'readme.md'),
    );
  });
});

describe('planningUserDocsDir', () => {
  it('joins planning and docs segment', () => {
    expect(planningUserDocsDir('/p/planning')).toBe(path.join('/p/planning', 'docs'));
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

describe('isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite', () => {
  it('blocks CLAUDE.md, AGENTS.md, and .cursor paths', () => {
    expect(isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite('CLAUDE.md')).toBe(true);
    expect(isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite('AGENTS.md')).toBe(true);
    expect(isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite('.cursor/mcp.md')).toBe(true);
    expect(isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite('notes/ok.md')).toBe(false);
  });
});

describe('isPlanningUserDocRelativePathDisallowed', () => {
  it('blocks the Flux instruction state sidecar', () => {
    expect(isPlanningUserDocRelativePathDisallowed('.fluxx-instructions.json')).toBe(true);
    expect(isPlanningUserDocRelativePathDisallowed('.flux-instructions.json')).toBe(true);
  });
});

describe('isPlanningMarkdownRelativePathForbiddenForUserWrite', () => {
  it('blocks .fluxx-docs-sync and legacy .flux-docs-sync trees', () => {
    expect(isPlanningMarkdownRelativePathForbiddenForUserWrite('.fluxx-docs-sync/state.md')).toBe(true);
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
