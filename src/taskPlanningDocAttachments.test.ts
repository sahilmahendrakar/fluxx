import { describe, expect, it } from 'vitest';
import {
  attachedPlanningDocChipPresence,
  compactPlanningDocPathLabel,
} from './taskPlanningDocAttachments';

describe('attachedPlanningDocChipPresence', () => {
  const paths = new Set(['docs/plan.md', 'vision.md']);

  it('returns pending while the list is loading', () => {
    expect(
      attachedPlanningDocChipPresence('docs/plan.md', paths, true, true),
    ).toBe('pending');
  });

  it('returns pending before the list has been fetched', () => {
    expect(
      attachedPlanningDocChipPresence('docs/plan.md', paths, false, false),
    ).toBe('pending');
  });

  it('returns present when the path is in the fetched list', () => {
    expect(
      attachedPlanningDocChipPresence('docs/plan.md', paths, true, false),
    ).toBe('present');
  });

  it('returns missing when the list is known and the path is absent', () => {
    expect(
      attachedPlanningDocChipPresence('ghost.md', paths, true, false),
    ).toBe('missing');
  });

  it('does not treat an empty set as missing before fetch completes', () => {
    expect(
      attachedPlanningDocChipPresence('docs/plan.md', new Set(), false, false),
    ).toBe('pending');
  });
});

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
