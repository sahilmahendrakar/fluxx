import { describe, expect, it } from 'vitest';
import { parseCliValidationPlanInput } from './persist';

describe('validationPlans/persist parseCliValidationPlanInput', () => {
  it('parses inline JSON string', () => {
    const r = parseCliValidationPlanInput(
      '{"goal":"g","pack":"electron-playwright","checks":["a"],"requiredArtifacts":[]}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.goal).toBe('g');
  });

  it('parses object payload from automation bridge', () => {
    const r = parseCliValidationPlanInput({
      goal: 'g',
      pack: 'electron-playwright',
      checks: ['step'],
      requiredArtifacts: ['shot'],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    expect(parseCliValidationPlanInput('{bad').ok).toBe(false);
  });
});
