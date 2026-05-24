import { describe, expect, it, vi } from 'vitest';
import { evaluateManualValidationEligibility } from './display';

describe('manualValidationAction wiring', () => {
  it('runManualValidationForTask creates then launches with electron-playwright pack', async () => {
    const create = vi.fn(async () => ({
      ok: true as const,
      run: {
        id: 'run-1',
        taskId: 'task-1',
        projectId: 'proj-1',
        packId: 'electron-playwright' as const,
        status: 'queued' as const,
        validatorAgent: 'cursor' as const,
        startedAt: '2026-05-22T10:00:00.000Z',
        artifactDir: '/tmp/run-1',
        artifacts: [],
      },
    }));
    const launchValidator = vi.fn(async () => ({
      ok: true as const,
      run: {
        id: 'run-1',
        taskId: 'task-1',
        projectId: 'proj-1',
        packId: 'electron-playwright' as const,
        status: 'running' as const,
        validatorAgent: 'cursor' as const,
        startedAt: '2026-05-22T10:00:00.000Z',
        artifactDir: '/tmp/run-1',
        artifacts: [],
      },
      validatorSessionId: 'sess-1',
    }));

    const prev = globalThis.window;
    globalThis.window = {
      electronAPI: {
        validationRuns: { create, launchValidator },
      },
    } as unknown as Window & typeof globalThis;

    const { runManualValidationForTask } = await import('./manualValidationAction');
    const result = await runManualValidationForTask({
      task: {
        id: 'task-1',
        title: 'Review me',
        status: 'validation',
        agent: 'cursor',
        projectId: 'proj-1',
        createdAt: '2026-05-22T09:00:00.000Z',
      },
      primaryRepoId: 'repo-main',
      worktreePath: '/tmp/worktree',
    });

    globalThis.window = prev;

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
        worktreeCwd: '/tmp/worktree',
      }),
    );
    expect(launchValidator).toHaveBeenCalledWith({ runId: 'run-1', task: expect.any(Object) });
  });

  it('blocks manual validation when eligibility fails before IPC', async () => {
    const blocked = evaluateManualValidationEligibility({
      task: { status: 'backlog', agent: 'cursor' },
      latestRun: null,
    });
    expect(blocked.canRun).toBe(false);
  });
});
