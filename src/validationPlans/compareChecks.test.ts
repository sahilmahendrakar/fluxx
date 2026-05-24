import { describe, expect, it } from 'vitest';
import { matchPlannedChecksToVerdict } from './compareChecks';

describe('validationPlans/compareChecks', () => {
  it('matches by plannedCheckIndex (preferred)', () => {
    const rows = matchPlannedChecksToVerdict(
      ['Open task details', 'Capture screenshot'],
      [
        {
          name: 'Runtime: details panel visible',
          status: 'passed',
          plannedCheckIndex: 0,
        },
        {
          name: 'Screenshot saved',
          status: 'passed',
          plannedCheckIndex: 1,
        },
      ],
    );
    expect(rows[0].verdictStatus).toBe('passed');
    expect(rows[0].matchMethod).toBe('index');
    expect(rows[1].verdictStatus).toBe('passed');
    expect(rows[1].matchMethod).toBe('index');
  });

  it('aggregates multiple verdict checks for the same plannedCheckIndex', () => {
    const rows = matchPlannedChecksToVerdict(['Verify header styling'], [
      {
        name: 'Static: header class',
        status: 'passed',
        plannedCheckIndex: 0,
      },
      {
        name: 'Runtime: header screenshot',
        status: 'passed',
        plannedCheckIndex: 0,
      },
    ]);
    expect(rows[0].verdictStatus).toBe('passed');
    expect(rows[0].matchMethod).toBe('index');
  });

  it('falls back to legacy name matching when plannedCheckIndex is absent', () => {
    const rows = matchPlannedChecksToVerdict(
      ['Open task details', 'Capture screenshot'],
      [
        { name: 'Capture screenshot of task details', status: 'passed' },
        { name: 'Open task details panel', status: 'passed' },
      ],
    );
    expect(rows[0].verdictStatus).toBe('passed');
    expect(rows[0].matchMethod).toBe('name');
    expect(rows[1].verdictStatus).toBe('passed');
    expect(rows[1].matchMethod).toBe('name');
  });
});
