import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationRunStore } from './ValidationRunStore';

describe('ValidationRunStore', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('creates a run, scaffolds artifact dir, and lists by task id', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const created = await store.create({
      taskId: 'task-1',
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });
    expect(created.status).toBe('queued');
    expect(created.artifactDir).toBe(path.join(tmp, 'validation-runs', created.id));
    await expect(fs.access(path.join(created.artifactDir, 'plan.json'))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(created.artifactDir, 'artifacts/screenshots')),
    ).resolves.toBeUndefined();
    const instructions = await fs.readFile(
      path.join(created.artifactDir, 'instructions.md'),
      'utf8',
    );
    expect(instructions).toContain('Electron Playwright');
    const script = await fs.readFile(
      path.join(created.artifactDir, 'validate-electron.mjs'),
      'utf8',
    );
    expect(script).toContain(created.id);
    expect(script).toContain('playwright');

    const listed = await store.listForTask('task-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const store2 = new ValidationRunStore({ getProjectDir: () => tmp });
    const reloaded = await store2.listForTask('task-1');
    expect(reloaded[0]?.id).toBe(created.id);
  });

  it('registerArtifact rejects paths that escape the run directory', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-escape-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't',
      projectId: 'p',
      validatorAgent: 'claude-code',
    });
    await expect(
      store.registerArtifact({
        runId: run.id,
        kind: 'screenshot',
        label: 'bad',
        path: '../outside.png',
      }),
    ).rejects.toThrow(/Invalid artifact path/);
  });

  it('marks missing artifact files without throwing', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-missing-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't',
      projectId: 'p',
      validatorAgent: 'cursor',
    });
    const updated = await store.registerArtifact({
      runId: run.id,
      kind: 'json',
      label: 'verdict',
      path: 'artifacts/data/verdict-copy.json',
    });
    expect(updated.artifacts[0]?.fileState).toBe('missing');

    const artifactPath = path.join(run.artifactDir, 'artifacts/data/verdict-copy.json');
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, '{}\n', 'utf8');
    const again = await store.get(run.id);
    expect(again?.artifacts[0]?.fileState).toBe('present');
  });

  it('updateStatus sets completedAt for terminal statuses', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-status-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't',
      projectId: 'p',
      validatorAgent: 'codex',
    });
    const done = await store.updateStatus({ runId: run.id, status: 'passed', summary: 'ok' });
    expect(done.status).toBe('passed');
    expect(done.completedAt).toBeTruthy();
    expect(done.summary).toBe('ok');
  });

  it('markLaunched transitions queued runs to running with guardrail metadata', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-launch-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't',
      projectId: 'p',
      validatorAgent: 'cursor',
    });
    const launched = await store.markLaunched({
      runId: run.id,
      validatorSessionId: 'sess-val-1',
      worktreeCwd: '/tmp/worktree',
      preValidationGitStatus: ' M src/a.ts',
    });
    expect(launched.status).toBe('running');
    expect(launched.validatorSessionId).toBe('sess-val-1');
    expect(launched.worktreeCwd).toBe('/tmp/worktree');
    expect(launched.gitGuardrails?.preValidationGitStatus).toBe(' M src/a.ts');
  });

  it('updateGuardrails persists post-validation git status drift', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-run-guard-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 't',
      projectId: 'p',
      validatorAgent: 'cursor',
    });
    await store.markLaunched({
      runId: run.id,
      validatorSessionId: 'sess-val-2',
      worktreeCwd: '/tmp/worktree',
      preValidationGitStatus: '',
    });
    const updated = await store.updateGuardrails({
      runId: run.id,
      postValidationGitStatus: ' M src/b.ts',
      gitStatusDriftDetected: true,
    });
    expect(updated.gitGuardrails?.postValidationGitStatus).toBe(' M src/b.ts');
    expect(updated.gitGuardrails?.gitStatusDriftDetected).toBe(true);
  });
});
