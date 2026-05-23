import { describe, expect, it } from 'vitest';
import { matchPlannedChecksToVerdict } from './compareChecks';

describe('validationPlans/compareChecks', () => {
  it('matches planned checks to verdict check names', () => {
    const rows = matchPlannedChecksToVerdict(
      ['Open task details', 'Capture screenshot'],
      [
        { name: 'Capture screenshot of task details', status: 'passed' },
        { name: 'Open task details panel', status: 'passed' },
      ],
    );
    expect(rows[0].verdictStatus).toBe('passed');
    expect(rows[1].verdictStatus).toBe('passed');
  });
});
