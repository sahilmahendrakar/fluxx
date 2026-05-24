import { describe, expect, it } from 'vitest';
import {
  formatAutoTransitionNotificationBody,
  formatAutoTransitionNotificationTitle,
  shouldDispatchAutoTransitionNotification,
  type AutoTransitionReason,
} from './taskAutoTransitionNotification';
import { DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS } from './taskAutoTransitionNotificationPrefs';
import type { TaskStatus } from './types';

const AUTOMATION_SOURCES: {
  reason: AutoTransitionReason;
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
}[] = [
  {
    reason: 'dependency-unblocked',
    previousStatus: 'backlog',
    nextStatus: 'in-progress',
  },
  {
    reason: 'agent-silence',
    previousStatus: 'in-progress',
    nextStatus: 'needs-input',
  },
  {
    reason: 'agent-exited',
    previousStatus: 'in-progress',
    nextStatus: 'needs-input',
  },
  {
    reason: 'pr-opened',
    previousStatus: 'in-progress',
    nextStatus: 'review',
  },
  {
    reason: 'pr-merged',
    previousStatus: 'review',
    nextStatus: 'done',
  },
];

describe('automatic transition notification copy', () => {
  it.each(AUTOMATION_SOURCES)(
    'formats title and body for $reason',
    ({ reason, previousStatus, nextStatus }) => {
      const input = {
        taskTitle: 'Ship feature',
        previousStatus,
        nextStatus,
        reason,
      };
      expect(formatAutoTransitionNotificationTitle(input)).toContain('Ship feature');
      expect(formatAutoTransitionNotificationTitle(input)).not.toContain('Task →');
      expect(formatAutoTransitionNotificationBody(input)).toContain('→');
    },
  );

  it('prefixes title with destination column label', () => {
    expect(
      formatAutoTransitionNotificationTitle({
        taskTitle: 'Ship feature',
        previousStatus: 'in-progress',
        nextStatus: 'needs-input',
        reason: 'agent-silence',
      }),
    ).toBe('Needs input: Ship feature');
  });
});

describe('shouldDispatchAutoTransitionNotification', () => {
  it.each(AUTOMATION_SOURCES)(
    'dispatches by default for $reason → $nextStatus',
    ({ reason, previousStatus, nextStatus }) => {
      expect(
        shouldDispatchAutoTransitionNotification(
          { taskTitle: 'T', previousStatus, nextStatus, reason },
          DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
        ),
      ).toBe(true);
    },
  );

  it('does not dispatch when status unchanged', () => {
    expect(
      shouldDispatchAutoTransitionNotification(
        {
          taskTitle: 'T',
          previousStatus: 'in-progress',
          nextStatus: 'in-progress',
          reason: 'agent-silence',
        },
        DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
      ),
    ).toBe(false);
  });

  it('does not dispatch manual-looking in-progress when destination disabled', () => {
    expect(
      shouldDispatchAutoTransitionNotification(
        {
          taskTitle: 'T',
          previousStatus: 'backlog',
          nextStatus: 'in-progress',
          reason: 'dependency-unblocked',
        },
        {
          enabled: true,
          destinations: {
            'in-progress': false,
            'needs-input': true,
            review: true,
            done: true,
          },
        },
      ),
    ).toBe(false);
  });
});
