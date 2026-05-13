import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { FilesystemPlanningDocsProvider } from './FilesystemPlanningDocsProvider';

async function mkPlanningTree(): Promise<{ root: string; planningDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-plan-fsprov-'));
  const planningDir = path.join(root, 'planning');
  await fs.mkdir(path.join(planningDir, 'notes'), { recursive: true });
  await fs.writeFile(path.join(planningDir, 'top.md'), '# root', 'utf8');
  await fs.writeFile(path.join(planningDir, 'notes', 'deep.md'), 'x', 'utf8');
  await fs.writeFile(path.join(planningDir, 'readme.txt'), 'not md', 'utf8');
  return { root, planningDir };
}

describe('FilesystemPlanningDocsProvider', () => {
  let planningDir: string;
  let provider: FilesystemPlanningDocsProvider;

  beforeEach(async () => {
    const t = await mkPlanningTree();
    planningDir = t.planningDir;
    provider = new FilesystemPlanningDocsProvider(() => planningDir, 'local-disk');
  });

  it('lists only markdown files with forward-slash relative paths', async () => {
    const r = await provider.list();
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const paths = r.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['notes/deep.md', 'top.md']);
  });

  it('returns NO_PROJECT when planning dir resolver is null', async () => {
    const empty = new FilesystemPlanningDocsProvider(() => null, 'local-disk');
    const list = await empty.list();
    expect(list).toEqual({ error: 'NO_PROJECT' });
    const read = await empty.read('x.md');
    expect(read).toEqual({ error: 'NO_PROJECT' });
  });

  it('read returns INVALID_PATH for traversal', async () => {
    const got = await provider.read('../outside.md');
    expect(got).toEqual({ error: 'INVALID_PATH' });
  });

  it('read returns NOT_FOUND for missing markdown', async () => {
    const got = await provider.read('missing.md');
    expect(got).toEqual({ error: 'NOT_FOUND' });
  });

  it('read returns file contents for valid nested path', async () => {
    const got = await provider.read('notes/deep.md');
    expect(got).toEqual({ content: 'x' });
  });

  it('write persists utf8 and read round-trips', async () => {
    const w = await provider.write('notes/deep.md', 'updated body');
    expect(w).toEqual({ ok: true });
    const got = await provider.read('notes/deep.md');
    expect(got).toEqual({ content: 'updated body' });
  });

  it('write returns FORBIDDEN_PATH under .flux-docs-sync', async () => {
    const w = await provider.write('.flux-docs-sync/nope.md', 'x');
    expect(w).toEqual({ error: 'FORBIDDEN_PATH' });
  });

  it('write returns INVALID_PATH for traversal', async () => {
    const w = await provider.write('../outside.md', 'x');
    expect(w).toEqual({ error: 'INVALID_PATH' });
  });

  it('write returns INVALID_CONTENT for embedded null', async () => {
    const w = await provider.write('top.md', 'a\0b');
    expect(w).toEqual({ error: 'INVALID_CONTENT' });
  });
});
