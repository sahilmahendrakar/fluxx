import { describe, expect, it } from 'vitest';
import { validateNewPlanningDocPathInput } from './validateNewPlanningDocPath';

describe('validateNewPlanningDocPathInput', () => {
  it('accepts canonical and docs/-prefixed paths', () => {
    expect(validateNewPlanningDocPathInput('overview.md', [])).toEqual({
      ok: true,
      relativePath: 'overview.md',
    });
    expect(validateNewPlanningDocPathInput('docs/notes/x.md', [])).toEqual({
      ok: true,
      relativePath: 'notes/x.md',
    });
  });

  it('rejects duplicates', () => {
    expect(validateNewPlanningDocPathInput('overview.md', ['overview.md'])).toEqual({
      ok: false,
      message: 'A document with this path already exists.',
    });
  });

  it('rejects reserved agent paths', () => {
    const r = validateNewPlanningDocPathInput('CLAUDE.md', []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/reserved/i);
    }
  });
});
