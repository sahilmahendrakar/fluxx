import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationRunStore } from './ValidationRunStore';
import { teardownValidationRunsForTask } from './teardownValidationRunsForTask';
import { registerValidatorSession } from './validatorSessionLifecycle';

describe('teardownValidationRunsForTask', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  it('stops live validator sessions and deletes all runs for the task', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-teardown-'));
    const store = new ValidationRunStore({ getProjectDir: () => tmp });
    const run = await store.create({
      taskId: 'task-1',
      projectId: 'proj-1',
      validatorAgent: 'cursor',
    });
    await store.markLaunched({
      runId: run.id,
      validatorSessionId: 'sess-val-1',
      worktreeCwd: '/tmp/worktree',
      preValidationGitStatus: '',
    });
    registerValidatorSession('sess-val-1', { runId: run.id, taskId: 'task-1' });

    const closeShellsForSession = vi.fn(async () => {});
    const stopSession = vi.fn(async () => {});
    const terminalBackend = {
      listSessions: vi.fn(async () => [
        {
          id: 'sess-val-1',
          taskId: 'task-1',
          status: 'running',
        },
      ]),
      closeShellsForSession,
      stopSession,
    };

    const result = await teardownValidationRunsForTask({
      validationRunStore: store,
      terminalBackend: terminalBackend as never,
      taskId: 'task-1',
    });

    expect(result.errors).toEqual([]);
    expect(result.deletedRunIds).toEqual([run.id]);
    expect(closeShellsForSession).toHaveBeenCalledWith('sess-val-1');
    expect(stopSession).toHaveBeenCalledWith('sess-val-1');
    expect(await store.listForTask('task-1')).toEqual([]);
    await expect(fs.access(run.artifactDir)).rejects.toThrow();
  });
});
