import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
  normalizeAutoTransitionNotificationPrefs,
  shouldNotifyAutoTransition,
} from './taskAutoTransitionNotificationPrefs';

describe('normalizeAutoTransitionNotificationPrefs', () => {
  it('returns defaults for invalid input', () => {
    expect(normalizeAutoTransitionNotificationPrefs(null)).toEqual(
      DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
    );
  });

  it('merges partial destination flags', () => {
    expect(
      normalizeAutoTransitionNotificationPrefs({
        enabled: false,
        destinations: { done: false, review: true },
      }),
    ).toEqual({
      enabled: false,
      destinations: {
        'in-progress': true,
        'needs-input': true,
        review: true,
        done: false,
      },
    });
  });
});

describe('shouldNotifyAutoTransition', () => {
  it('is false when globally disabled', () => {
    expect(
      shouldNotifyAutoTransition('needs-input', {
        enabled: false,
        destinations: DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS.destinations,
      }),
    ).toBe(false);
  });

  it('is false for backlog even when enabled', () => {
    expect(
      shouldNotifyAutoTransition('backlog', DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS),
    ).toBe(false);
  });

  it('respects per-destination toggles', () => {
    const prefs = normalizeAutoTransitionNotificationPrefs({
      enabled: true,
      destinations: {
        'in-progress': false,
        'needs-input': true,
        review: false,
        done: false,
      },
    });
    expect(shouldNotifyAutoTransition('in-progress', prefs)).toBe(false);
    expect(shouldNotifyAutoTransition('needs-input', prefs)).toBe(true);
    expect(shouldNotifyAutoTransition('review', prefs)).toBe(false);
    expect(shouldNotifyAutoTransition('done', prefs)).toBe(false);
  });
});
