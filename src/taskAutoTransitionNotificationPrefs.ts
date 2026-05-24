import type { TaskStatus } from './types';

/** Destination columns that automatic-transition notifications can target. */
export type AutoTransitionNotificationDestination =
  | 'in-progress'
  | 'needs-input'
  | 'review'
  | 'done';

export const AUTO_TRANSITION_NOTIFICATION_DESTINATIONS: AutoTransitionNotificationDestination[] =
  ['in-progress', 'needs-input', 'review', 'done'];

export type AutoTransitionNotificationPrefs = {
  enabled: boolean;
  destinations: Record<AutoTransitionNotificationDestination, boolean>;
};

export const DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS: AutoTransitionNotificationPrefs =
  {
    enabled: true,
    destinations: {
      'in-progress': true,
      'needs-input': true,
      review: true,
      done: true,
    },
  };

function isDestination(
  value: unknown,
): value is AutoTransitionNotificationDestination {
  return (
    value === 'in-progress' ||
    value === 'needs-input' ||
    value === 'review' ||
    value === 'done'
  );
}

/** Normalize persisted / IPC partial prefs onto defaults. */
export function normalizeAutoTransitionNotificationPrefs(
  raw: unknown,
): AutoTransitionNotificationPrefs {
  const base = DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS;
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: base.enabled,
      destinations: { ...base.destinations },
    };
  }
  const o = raw as Partial<AutoTransitionNotificationPrefs>;
  const destinations = { ...base.destinations };
  if (o.destinations && typeof o.destinations === 'object') {
    for (const key of AUTO_TRANSITION_NOTIFICATION_DESTINATIONS) {
      const v = (o.destinations as Record<string, unknown>)[key];
      if (typeof v === 'boolean') {
        destinations[key] = v;
      }
    }
  }
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    destinations,
  };
}

export function shouldNotifyAutoTransition(
  nextStatus: TaskStatus,
  prefs: AutoTransitionNotificationPrefs,
): boolean {
  if (!prefs.enabled) return false;
  if (!isDestination(nextStatus)) return false;
  return prefs.destinations[nextStatus] === true;
}
