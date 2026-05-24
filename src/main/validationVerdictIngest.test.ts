import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationRunStore } from './ValidationRunStore';
import { ingestValidationVerdict } from './validationVerdictIngest';

describe('ingestValidationVerdict', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('marks missing verdict as needs-human-review', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ingest-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't1',
      projectId: 'p1',
      validatorAgent: 'cursor',
    });
    const result = await ingestValidationVerdict(store, run.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.status).toBe('needs-human-review');
      expect(result.run.verdictReason).toContain('missing');
    }
  });

  it('never marks invalid verdict JSON as passed', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ingest-bad-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't1',
      projectId: 'p1',
      validatorAgent: 'cursor',
    });
    await fs.writeFile(
      path.join(run.artifactDir, 'verdict.json'),
      JSON.stringify({ verdict: 'passed', summary: 'ok', checks: [] }),
      'utf8',
    );
    const result = await ingestValidationVerdict(store, run.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.status).not.toBe('passed');
      expect(result.run.status).toBe('needs-human-review');
    }
  });

  it('ingests a valid passed verdict and registers artifacts', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ingest-pass-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't1',
      projectId: 'p1',
      validatorAgent: 'cursor',
    });
    const shotRel = 'artifacts/screenshots/ok.png';
    const shotAbs = path.join(run.artifactDir, shotRel);
    await fs.mkdir(path.dirname(shotAbs), { recursive: true });
    await fs.writeFile(shotAbs, 'png', 'utf8');
    await fs.writeFile(
      path.join(run.artifactDir, 'verdict.json'),
      JSON.stringify({
        verdict: 'passed',
        summary: 'All checks passed',
        checks: [
          {
            name: 'Screenshot captured',
            status: 'passed',
            artifactPaths: [shotRel],
          },
        ],
        artifacts: [
          { kind: 'screenshot', label: 'OK', path: shotRel },
        ],
      }),
      'utf8',
    );
    const result = await ingestValidationVerdict(store, run.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.status).toBe('passed');
      expect(result.run.summary).toBe('All checks passed');
      expect(result.run.artifacts.some((a) => a.path === shotRel)).toBe(true);
    }
  });

  it('maps errored verdict outcome to errored run status', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-ingest-err-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't1',
      projectId: 'p1',
      validatorAgent: 'cursor',
    });
    await fs.writeFile(
      path.join(run.artifactDir, 'verdict.json'),
      JSON.stringify({
        verdict: 'errored',
        summary: 'Playwright could not launch',
        checks: [{ name: 'Launch', status: 'failed' }],
        error: 'ENOENT launch command',
      }),
      'utf8',
    );
    const result = await ingestValidationVerdict(store, run.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.status).toBe('errored');
      expect(result.run.verdictReason).toBe('ENOENT launch command');
    }
  });
});
