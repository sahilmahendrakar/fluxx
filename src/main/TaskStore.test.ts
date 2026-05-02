import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskStore } from './TaskStore';

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
