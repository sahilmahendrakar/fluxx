import { describe, expect, it } from 'vitest';
import { resolveValidationRunSelection } from './validationRunSelection';
import type { ValidationRun } from './types';

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

describe('resolveValidationRunSelection', () => {
  it('defaults to the latest run when nothing is stored', () => {
    const older = run({ id: 'run-a', status: 'failed', startedAt: '2026-05-22T10:00:00.000Z' });
    const newer = run({ id: 'run-b', status: 'passed', startedAt: '2026-05-22T12:00:00.000Z' });
    const result = resolveValidationRunSelection({
      runs: [older, newer],
      storedRunId: undefined,
      previousRunIds: new Set(),
    });
    expect(result.selectedRunId).toBe('run-b');
    expect(result.selectedRun?.id).toBe('run-b');
  });

  it('keeps an explicit stored selection when that run still exists', () => {
    const older = run({ id: 'run-a', status: 'failed', startedAt: '2026-05-22T10:00:00.000Z' });
    const newer = run({ id: 'run-b', status: 'passed', startedAt: '2026-05-22T12:00:00.000Z' });
    const result = resolveValidationRunSelection({
      runs: [older, newer],
      storedRunId: 'run-a',
      previousRunIds: new Set(['run-a', 'run-b']),
    });
    expect(result.selectedRunId).toBe('run-a');
    expect(result.selectedRun?.status).toBe('failed');
  });

  it('auto-selects a newly created run', () => {
    const older = run({ id: 'run-a', status: 'failed', startedAt: '2026-05-22T10:00:00.000Z' });
    const newer = run({ id: 'run-b', status: 'queued', startedAt: '2026-05-22T13:00:00.000Z' });
    const result = resolveValidationRunSelection({
      runs: [older, newer],
      storedRunId: 'run-a',
      previousRunIds: new Set(['run-a']),
    });
    expect(result.selectedRunId).toBe('run-b');
  });
});
