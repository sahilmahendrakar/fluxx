import { describe, expect, it } from 'vitest';
import { compactPlanningDocPathLabel } from './taskPlanningDocAttachments';

describe('compactPlanningDocPathLabel', () => {
  it('returns the full path when short', () => {
    expect(compactPlanningDocPathLabel('short.md')).toBe('short.md');
  });

  it('prefixes with ellipsis when long', () => {
    expect(compactPlanningDocPathLabel('planning/very/long/nested/document-name-here.md')).toMatch(
      /^…\/document-name-here\.md$/,
    );
  });
});
