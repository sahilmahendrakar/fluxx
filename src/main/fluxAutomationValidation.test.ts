import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../types';
import { ValidationRunStore } from './ValidationRunStore';
import {
  automationRunValidationArtifacts,
  automationRunValidationFinish,
  automationRunValidationList,
  automationRunValidationRun,
  type FluxAutomationValidationHost,
} from './fluxAutomationValidation';
import type { FluxAutomationResolvedActive } from './fluxAutomationRuns';

describe('fluxAutomationValidation', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  function makeHost(task: Task, store: ValidationRunStore): FluxAutomationValidationHost {
    const notifyValidationRunChanged = vi.fn();
    const active: FluxAutomationResolvedActive = {
      kind: 'local',
      activeKey: { kind: 'local', id: 'proj-1' },
      project: {
        id: 'proj-1',
        name: 'Demo',
        rootPath: tmp,
        createdAt: new Date().toISOString(),
        defaultTaskAgent: 'cursor',
      },
      projectDir: tmp,
    };
    return {
      resolveActive: () => active,
      getTaskInCurrentProject: (id) => (id === task.id ? task : null),
      notifyTasksChanged: () => undefined,
      bridge: { request: vi.fn() } as unknown as FluxAutomationValidationHost['bridge'],
      taskStore: {} as FluxAutomationValidationHost['taskStore'],
      projectStore: {} as FluxAutomationValidationHost['projectStore'],
      bindingStore: {} as FluxAutomationValidationHost['bindingStore'],
      validationRunStore: store,
      listTerminalSessions: async () => [],
      getRecordProjectDir: () => tmp,
      notifyValidationRunChanged,
      taskActions: {} as FluxAutomationValidationHost['taskActions'],
      bridgeFailureToInvoke: (r) => ({ ok: false, error: r.error }),
      buildLocalProjectInfoRepoSummaries: async () => [],
      probeRepoPathStatus: async () => 'missing',
    };
  }

  it('returns error for missing task on run', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-auto-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const host = makeHost(
      {
        id: 'task-real',
        title: 'T',
        status: 'review',
        agent: 'cursor',
        projectId: 'proj-1',
        orderKey: 'a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      store,
    );
    const result = await automationRunValidationRun(host, {
      taskId: 'missing-task',
      packId: 'electron-playwright',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it('returns error for unsupported pack', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-auto-pack-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const task: Task = {
      id: 'task-1',
      title: 'T',
      status: 'review',
      agent: 'cursor',
      projectId: 'proj-1',
      orderKey: 'a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const host = makeHost(task, store);
    const result = await automationRunValidationRun(host, {
      taskId: task.id,
      packId: 'unknown-pack',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unsupported validation pack/i);
    }
  });

  it('creates a run with stable JSON fields', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-auto-create-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const task: Task = {
      id: 'task-1',
      title: 'T',
      status: 'review',
      agent: 'cursor',
      projectId: 'proj-1',
      orderKey: 'a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const host = makeHost(task, store);
    const result = await automationRunValidationRun(host, {
      taskId: task.id,
      packId: 'electron-playwright',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        runId: string;
        artifactDir: string;
        run: { id: string; taskId: string; artifactDir: string; packId: string };
      };
      expect(data.runId).toBeTruthy();
      expect(data.artifactDir).toContain('validation-runs');
      expect(data.run.id).toBe(data.runId);
      expect(data.run.taskId).toBe(task.id);
      expect(data.run.packId).toBe('electron-playwright');
      expect(data.run.artifactDir).toBe(data.artifactDir);
    }
  });

  it('lists artifacts after verdict ingestion', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-auto-art-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const task: Task = {
      id: 'task-1',
      title: 'T',
      status: 'review',
      agent: 'cursor',
      projectId: 'proj-1',
      orderKey: 'a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const host = makeHost(task, store);
    const created = await automationRunValidationRun(host, {
      taskId: task.id,
      packId: 'electron-playwright',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { runId, artifactDir } = created.data as { runId: string; artifactDir: string };
    const shotRel = 'artifacts/screenshots/evidence.png';
    await fs.mkdir(path.dirname(path.join(artifactDir, shotRel)), { recursive: true });
    await fs.writeFile(path.join(artifactDir, shotRel), 'x', 'utf8');
    await fs.writeFile(
      path.join(artifactDir, 'verdict.json'),
      JSON.stringify({
        verdict: 'failed',
        summary: 'Button missing',
        checks: [{ name: 'Button visible', status: 'failed', artifactPaths: [shotRel] }],
        artifacts: [{ kind: 'screenshot', label: 'Evidence', path: shotRel }],
      }),
      'utf8',
    );
    const listed = await automationRunValidationList(host, { taskId: task.id });
    expect(listed.ok).toBe(true);
    const artifacts = await automationRunValidationArtifacts(host, { runId });
    expect(artifacts.ok).toBe(true);
    if (artifacts.ok) {
      const data = artifacts.data as {
        runId: string;
        artifacts: { path: string; fileState: string }[];
      };
      expect(data.runId).toBe(runId);
      expect(data.artifacts.length).toBeGreaterThan(0);
      expect(data.artifacts[0]?.path).toBe(shotRel);
      const reloaded = await store.get(runId);
      expect(reloaded?.status).toBe('failed');
    }
  });

  it('finalizes a run via validation.finish and notifies listeners', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-auto-finish-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const task: Task = {
      id: 'task-1',
      title: 'T',
      status: 'review',
      agent: 'cursor',
      projectId: 'proj-1',
      orderKey: 'a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const host = makeHost(task, store);
    const created = await automationRunValidationRun(host, {
      taskId: task.id,
      packId: 'electron-playwright',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { runId, artifactDir } = created.data as { runId: string; artifactDir: string };
    await store.markLaunched({
      runId,
      validatorSessionId: 'sess-1',
      worktreeCwd: tmp,
      preValidationGitStatus: '',
    });
    await fs.writeFile(
      path.join(artifactDir, 'verdict.json'),
      JSON.stringify({
        verdict: 'passed',
        summary: 'All good',
        checks: [{ name: 'Validation complete', status: 'passed' }],
      }),
      'utf8',
    );
    const finished = await automationRunValidationFinish(host, { runId });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      const data = finished.data as { ingested: boolean; run: { status: string } };
      expect(data.ingested).toBe(true);
      expect(data.run.status).toBe('passed');
    }
    expect(host.notifyValidationRunChanged).toHaveBeenCalledWith(runId);
  });
});
