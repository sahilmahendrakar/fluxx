import { describe, expect, it, vi } from 'vitest';
import { autoStartValidationOnEntry } from './validationTaskTransitions';
import type { ValidationRun } from '../validationRuns/types';
import type { Task } from '../types';

function task(partial: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    projectId: 'proj-1',
    title: 'Task',
    description: '',
    agent: 'cursor',
    ...partial,
  } as Task;
}

function run(partial: Partial<ValidationRun> & Pick<ValidationRun, 'id' | 'status' | 'startedAt'>): ValidationRun {
  return {
    taskId: 'task-1',
    projectId: 'proj-1',
    packId: 'electron-playwright',
    validatorAgent: 'cursor',
    artifactDir: '/tmp/run',
    artifacts: [],
    ...partial,
  };
}

describe('autoStartValidationOnEntry', () => {
  it('notifies renderer when a run is created and launched', async () => {
    const notifyValidationRunChanged = vi.fn();
    const created = run({ id: 'run-new', status: 'queued', startedAt: '2026-05-24T10:00:00.000Z' });
    const launched = run({
      id: 'run-new',
      status: 'running',
      startedAt: '2026-05-24T10:00:00.000Z',
      validatorSessionId: 'sess-val',
    });

    const validationRunStore = {
      listForTask: vi.fn(async () => []),
      create: vi.fn(async () => created),
      updateStatus: vi.fn(),
    };
    const launchValidatorSession = vi.fn(async () => ({
      ok: true as const,
      run: launched,
      sessionId: 'sess-val',
    }));

    await autoStartValidationOnEntry(
      task({ id: 'task-1', status: 'in-progress' }),
      task({ id: 'task-1', status: 'validation' }),
      {
        validationRunStore: validationRunStore as never,
        launchValidatorSession,
        getValidationEnabled: async () => true,
        getPrimaryRepoId: async () => 'repo-1',
        resolveWorktreePath: async () => '/tmp/worktree',
        notifyValidationRunChanged,
      },
      'test:auto-start',
    );

    expect(validationRunStore.create).toHaveBeenCalledOnce();
    expect(launchValidatorSession).toHaveBeenCalledOnce();
    expect(notifyValidationRunChanged).toHaveBeenCalledTimes(2);
    expect(notifyValidationRunChanged).toHaveBeenNthCalledWith(1, 'run-new');
    expect(notifyValidationRunChanged).toHaveBeenNthCalledWith(2, 'run-new');
  });
});
