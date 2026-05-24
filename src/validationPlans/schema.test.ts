import { describe, expect, it } from 'vitest';
import { parseTaskValidationPlan, taskValidationPlanToJson } from './schema';

describe('validationPlans/schema', () => {
  const valid = {
    goal: 'Verify validation section',
    pack: 'electron-playwright',
    checks: ['Open task details', 'Confirm Validation tab'],
    requiredArtifacts: ['task-detail-validation'],
    risks: ['Packaged build not tested'],
    notes: 'Use aux dev server.',
  };

  it('accepts a valid plan object', () => {
    const r = parseTaskValidationPlan(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.goal).toBe(valid.goal);
      expect(r.plan.checks).toHaveLength(2);
      expect(r.plan.risks).toEqual(['Packaged build not tested']);
    }
  });

  it('accepts a valid JSON string', () => {
    const r = parseTaskValidationPlan(JSON.stringify(valid));
    expect(r.ok).toBe(true);
  });

  it('rejects missing goal or checks', () => {
    expect(parseTaskValidationPlan({ ...valid, goal: '  ' }).ok).toBe(false);
    expect(parseTaskValidationPlan({ ...valid, checks: [] }).ok).toBe(false);
    expect(parseTaskValidationPlan({ ...valid, pack: 'unknown' }).ok).toBe(false);
  });

  it('round-trips through taskValidationPlanToJson', () => {
    const parsed = parseTaskValidationPlan(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = parseTaskValidationPlan(taskValidationPlanToJson(parsed.plan));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.plan).toEqual(parsed.plan);
  });
});
