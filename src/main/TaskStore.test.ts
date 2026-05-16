import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskStore } from './TaskStore';

describe('TaskStore attachedPlanningDocs', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('persists attachedPlanningDocs on create and round-trips from tasks.json', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-attached-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      attachedPlanningDocs: [
        { relativePath: 'plans/a.md' },
        { relativePath: 'bad/../x.md' },
        { relativePath: 'plans/b.md' },
      ],
    });
    expect(created.attachedPlanningDocs).toEqual([
      { relativePath: 'plans/a.md' },
      { relativePath: 'plans/b.md' },
    ]);

    const store2 = new TaskStore(dir);
    await store2.init();
    const reloaded = store2.getAll('p1').find((t) => t.id === created.id);
    expect(reloaded?.attachedPlanningDocs).toEqual(created.attachedPlanningDocs);
  });

  it('patch replaces attachments; null clears', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-attached-patch-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      attachedPlanningDocs: [{ relativePath: 'a.md' }],
    });
    const replaced = await store.update(created.id, {
      attachedPlanningDocs: [{ relativePath: 'b.md' }, { relativePath: 'c.md' }],
    });
    expect(replaced.attachedPlanningDocs).toEqual([{ relativePath: 'b.md' }, { relativePath: 'c.md' }]);

    const cleared = await store.update(created.id, { attachedPlanningDocs: null });
    expect(cleared.attachedPlanningDocs).toBeUndefined();
  });
});

describe('TaskStore multi-repo2 repoId migration', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('backfills missing repoId on existing rows to the primary repo and persists once', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-repoid-'));
    // Seed a legacy tasks.json: one task with no `repoId`, one already tagged.
    const tasksPath = path.join(dir, 'tasks.json');
    await fs.writeFile(
      tasksPath,
      JSON.stringify(
        [
          {
            id: 'a',
            title: 'legacy',
            status: 'backlog',
            agent: 'cursor',
            createdAt: '2025-01-01T00:00:00.000Z',
            projectId: 'p1',
          },
          {
            id: 'b',
            title: 'already-tagged',
            status: 'backlog',
            agent: 'cursor',
            createdAt: '2025-01-01T00:00:00.000Z',
            projectId: 'p1',
            repoId: 'custom-repo',
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const store = new TaskStore(dir);
    await store.init();

    await store.migrateMissingRepoIds('primary');
    const all = store.getAll();
    expect(all.find((t) => t.id === 'a')?.repoId).toBe('primary');
    expect(all.find((t) => t.id === 'b')?.repoId).toBe('custom-repo');

    // Persisted to disk.
    const onDisk = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as Array<{
      id: string;
      repoId?: string;
    }>;
    expect(onDisk.find((r) => r.id === 'a')?.repoId).toBe('primary');
    expect(onDisk.find((r) => r.id === 'b')?.repoId).toBe('custom-repo');

    // Idempotent: a second migration call doesn't rewrite anything.
    const before = await fs.stat(tasksPath);
    await new Promise((r) => setTimeout(r, 10));
    await store.migrateMissingRepoIds('primary');
    const after = await fs.stat(tasksPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('update keeps repoId when patching title or status', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-repoid-preserve-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      repoId: 'repo-a',
    });
    const titlePatched = await store.update(created.id, { title: 'new title' });
    expect(titlePatched.repoId).toBe('repo-a');

    const statusPatched = await store.update(created.id, { status: 'in-progress' });
    expect(statusPatched.repoId).toBe('repo-a');

    const labelsPatched = await store.update(created.id, { labels: ['x'] });
    expect(labelsPatched.repoId).toBe('repo-a');
  });

  it('create accepts an explicit repoId and round-trips it', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-repoid-create-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      repoId: 'r-extra',
    });
    expect(created.repoId).toBe('r-extra');

    const updated = await store.update(created.id, { repoId: '' });
    expect(updated.repoId).toBeUndefined();
  });
});

describe('TaskStore sourceBranch fields', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trips sourceBranch and createSourceBranchIfMissing', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-taskstore-'));
    const store = new TaskStore(dir);
    await store.init();
    const created = await store.create({
      title: 't',
      agent: 'cursor',
      projectId: 'p1',
      sourceBranch: 'develop',
      createSourceBranchIfMissing: true,
    });
    expect(created.sourceBranch).toBe('develop');
    expect(created.createSourceBranchIfMissing).toBe(true);

    const updated = await store.update(created.id, {
      sourceBranch: ' main ',
      createSourceBranchIfMissing: false,
    });
    expect(updated.sourceBranch).toBe('main');
    expect(updated.createSourceBranchIfMissing).toBeUndefined();

    const raw = JSON.parse(await fs.readFile(path.join(dir, 'tasks.json'), 'utf8')) as unknown[];
    const row = raw.find((t) => (t as { id: string }).id === created.id) as {
      sourceBranch?: string;
      createSourceBranchIfMissing?: boolean;
    };
    expect(row.sourceBranch).toBe('main');
    expect(row.createSourceBranchIfMissing).toBeUndefined();
  });
});
