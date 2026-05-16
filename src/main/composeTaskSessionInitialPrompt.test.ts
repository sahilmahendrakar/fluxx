import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { taskInitialPrompt } from './agentSpawn';
import { composeTaskSessionInitialPrompt } from './composeTaskSessionInitialPrompt';

function baseTask(over: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Example',
    status: 'backlog',
    agent: 'cursor',
    createdAt: '2020-01-01T00:00:00.000Z',
    projectId: 'proj-1',
    ...over,
  };
}

describe('composeTaskSessionInitialPrompt', () => {
  it('matches taskInitialPrompt when attachedPlanningDocs is absent', async () => {
    const task = baseTask({ description: 'Do the thing' });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    await mkdir(path.join(dir, 'planning'), { recursive: true });
    const planningDir = path.join(dir, 'planning');
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got).toBe(taskInitialPrompt(task));
  });

  it('matches taskInitialPrompt when attachedPlanningDocs is empty', async () => {
    const task = baseTask({ attachedPlanningDocs: [] });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    expect(await composeTaskSessionInitialPrompt(task, planningDir)).toBe(taskInitialPrompt(task));
  });

  it('appends paths and file URLs for one readable doc', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    await writeFile(path.join(planningDir, 'vision.md'), '# Vision\n', 'utf8');
    const task = baseTask({
      description: 'Slice A',
      attachedPlanningDocs: [{ relativePath: 'vision.md' }],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got.startsWith('Example\n\nSlice A')).toBe(true);
    expect(got).toContain('## Attached Planning Docs');
    expect(got).toContain('- `vision.md`');
    expect(got).toContain(`Path: \`${path.join(planningDir, 'vision.md')}\``);
    expect(got).toContain('URL: `file://');
    expect(got).toContain('Use these docs for broader context');
  });

  it('lists multiple distinct attachments', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    await writeFile(path.join(planningDir, 'a.md'), 'a', 'utf8');
    await writeFile(path.join(planningDir, 'b.md'), 'b', 'utf8');
    const task = baseTask({
      attachedPlanningDocs: [{ relativePath: 'a.md' }, { relativePath: 'b.md' }],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got).toContain('- `a.md`');
    expect(got).toContain('- `b.md`');
  });

  it('dedupes repeated normalized paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    await writeFile(path.join(planningDir, 'a.md'), 'a', 'utf8');
    const task = baseTask({
      attachedPlanningDocs: [{ relativePath: 'a.md' }, { relativePath: './a.md' }],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    const n = got.split('`a.md`').length - 1;
    expect(n).toBe(1);
  });

  it('calls out a missing file while keeping the relative path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    const task = baseTask({
      attachedPlanningDocs: [{ relativePath: 'ghost.md' }],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got).toContain('- `ghost.md`');
    expect(got).toMatch(/missing|not readable|syncing/i);
    expect(got).toContain('URL: _not available_');
  });

  it('includes invalid attachment entries without throwing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    const task = baseTask({
      attachedPlanningDocs: [
        { relativePath: '../outside.md' } as { relativePath: string },
        { relativePath: 'nope.txt' } as { relativePath: string },
      ],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got).toContain('Invalid planning markdown path');
    expect(got).toContain('## Attached Planning Docs');
  });

  it('rejects forbidden planning paths in the prompt', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flux-plan-'));
    const planningDir = path.join(dir, 'planning');
    await mkdir(planningDir, { recursive: true });
    const task = baseTask({
      attachedPlanningDocs: [{ relativePath: '_flux_unsynced/x.md' }],
    });
    const got = await composeTaskSessionInitialPrompt(task, planningDir);
    expect(got).toContain('not allowed as an attached planning doc');
  });
});
