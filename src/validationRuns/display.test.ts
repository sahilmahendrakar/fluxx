import { describe, expect, it } from 'vitest';
import {
  evaluateManualValidationEligibility,
  formatValidationTimestamp,
  pickLatestValidationRun,
  validationBoardBadgeFromRuns,
  validationBoardBadgeLabel,
  validationRunStatusToBoardBadge,
  taskCardShouldShowValidationBadge,
  taskWorkspaceShouldShowValidationTab,
} from './display';
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

describe('validationRuns/display', () => {
  it('pickLatestValidationRun chooses newest startedAt', () => {
    const older = run({ id: 'a', status: 'passed', startedAt: '2026-05-22T10:00:00.000Z' });
    const newer = run({ id: 'b', status: 'failed', startedAt: '2026-05-22T12:00:00.000Z' });
    expect(pickLatestValidationRun([older, newer])?.id).toBe('b');
  });

  it('maps run statuses to board badges', () => {
    expect(validationRunStatusToBoardBadge('running')).toBe('running');
    expect(validationRunStatusToBoardBadge('passed')).toBe('passed');
    expect(validationRunStatusToBoardBadge('needs-human-review')).toBe('review-needed');
    expect(validationRunStatusToBoardBadge(null)).toBe('not-run');
  });

  it('derives board badge from runs', () => {
    const runs = [run({ id: 'a', status: 'passed', startedAt: '2026-05-22T10:00:00.000Z' })];
    expect(validationBoardBadgeFromRuns(runs)).toBe('passed');
    expect(validationBoardBadgeLabel('review-needed')).toBe('Validation: review needed');
  });

  it('shows validation badge on review tasks and when runs exist', () => {
    expect(taskCardShouldShowValidationBadge('review', [])).toBe(true);
    expect(taskCardShouldShowValidationBadge('backlog', [])).toBe(false);
    expect(
      taskCardShouldShowValidationBadge(
        'done',
        [run({ id: 'a', status: 'passed', startedAt: '2026-05-22T10:00:00.000Z' })],
      ),
    ).toBe(true);
  });

  it('evaluateManualValidationEligibility gates review, agent, and active runs', () => {
    expect(
      evaluateManualValidationEligibility({
        task: { status: 'in-progress', agent: 'cursor' },
        latestRun: null,
      }).canRun,
    ).toBe(false);
    expect(
      evaluateManualValidationEligibility({
        task: { status: 'review', agent: null },
        latestRun: null,
      }).reason,
    ).toBe('no-agent');
    expect(
      evaluateManualValidationEligibility({
        task: { status: 'review', agent: 'cursor' },
        latestRun: run({ id: 'a', status: 'running', startedAt: '2026-05-22T10:00:00.000Z' }),
      }).reason,
    ).toBe('already-running');
    expect(
      evaluateManualValidationEligibility({
        task: { status: 'review', agent: 'cursor' },
        latestRun: null,
      }).canRun,
    ).toBe(true);
  });

  it('taskWorkspaceShouldShowValidationTab when run or validator PTY is active', () => {
    expect(
      taskWorkspaceShouldShowValidationTab({
        latestRun: run({ id: 'a', status: 'running', startedAt: '2026-05-22T10:00:00.000Z' }),
        validatorSession: null,
      }),
    ).toBe(true);
    expect(
      taskWorkspaceShouldShowValidationTab({
        latestRun: run({ id: 'a', status: 'passed', startedAt: '2026-05-22T10:00:00.000Z' }),
        validatorSession: { status: 'running' },
      }),
    ).toBe(true);
    expect(
      taskWorkspaceShouldShowValidationTab({
        latestRun: run({ id: 'a', status: 'passed', startedAt: '2026-05-22T10:00:00.000Z' }),
        validatorSession: { status: 'stopped' },
      }),
    ).toBe(false);
  });

  it('formatValidationTimestamp returns em dash for invalid input', () => {
    expect(formatValidationTimestamp(undefined)).toBe('—');
    expect(formatValidationTimestamp('not-a-date')).toBe('—');
  });
});
