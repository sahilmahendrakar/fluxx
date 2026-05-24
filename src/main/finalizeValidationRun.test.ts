import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizeValidationRun } from './finalizeValidationRun';
import { ValidationRunStore } from './ValidationRunStore';

describe('finalizeValidationRun', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('ingests verdict and transitions run to terminal status on finish', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-finish-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 'task-1',
      projectId: 'proj-1',
      packId: 'electron-playwright',
      validatorAgent: 'cursor',
      worktreeCwd: tmp,
    });
    await store.markLaunched({
      runId: run.id,
      validatorSessionId: 'sess-1',
      worktreeCwd: tmp,
      preValidationGitStatus: '',
    });
    const shotRel = 'artifacts/screenshots/evidence.png';
    await fs.mkdir(path.dirname(path.join(run.artifactDir, shotRel)), { recursive: true });
    await fs.writeFile(path.join(run.artifactDir, shotRel), 'x', 'utf8');
    await fs.writeFile(
      path.join(run.artifactDir, 'verdict.json'),
      JSON.stringify({
        verdict: 'passed',
        summary: 'Looks good',
        checks: [{ name: 'Evidence captured', status: 'passed', artifactPaths: [shotRel] }],
        artifacts: [{ kind: 'screenshot', label: 'Evidence', path: shotRel }],
      }),
      'utf8',
    );

    const result = await finalizeValidationRun(store, { runId: run.id, source: 'finish' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingested).toBe(true);
    expect(result.run.status).toBe('passed');
    expect(result.run.artifacts.length).toBeGreaterThan(0);
  });

  it('is idempotent when run is already terminal', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-finish-idem-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 'task-1',
      projectId: 'proj-1',
      packId: 'electron-playwright',
      validatorAgent: 'cursor',
    });
    const done = await store.updateStatus({ runId: run.id, status: 'passed', summary: 'ok' });
    const first = await finalizeValidationRun(store, { runId: run.id, source: 'finish' });
    const second = await finalizeValidationRun(store, { runId: run.id, source: 'finish' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.ingested).toBe(false);
    expect(second.ingested).toBe(false);
    expect(second.run.status).toBe('passed');
    expect(second.run.completedAt).toBe(done.completedAt);
  });
});
