import { Notification } from 'electron';
import type { AppStateStore } from './AppStateStore';
import {
  DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS,
  normalizeAutoTransitionNotificationPrefs,
  type AutoTransitionNotificationPrefs,
} from '../taskAutoTransitionNotificationPrefs';
import {
  formatAutoTransitionNotificationBody,
  formatAutoTransitionNotificationTitle,
  shouldDispatchAutoTransitionNotification,
  type AutoTransitionNotifyInput,
} from '../taskAutoTransitionNotification';

export function getAutoTransitionNotificationPrefsFromStore(
  appStateStore: AppStateStore,
): AutoTransitionNotificationPrefs {
  return normalizeAutoTransitionNotificationPrefs(
    appStateStore.get().autoTransitionNotifications,
  );
}

export async function setAutoTransitionNotificationPrefsInStore(
  appStateStore: AppStateStore,
  partial: Partial<AutoTransitionNotificationPrefs>,
): Promise<AutoTransitionNotificationPrefs> {
  const current = getAutoTransitionNotificationPrefsFromStore(appStateStore);
  const next = normalizeAutoTransitionNotificationPrefs({
    enabled: partial.enabled ?? current.enabled,
    destinations: {
      ...current.destinations,
      ...(partial.destinations ?? {}),
    },
  });
  await appStateStore.set({ autoTransitionNotifications: next });
  return next;
}

/**
 * Shows a macOS desktop notification when prefs allow. Never throws; logs warnings only.
 */
export function dispatchAutoTransitionNotification(
  appStateStore: AppStateStore,
  input: AutoTransitionNotifyInput,
): void {
  try {
    const prefs = getAutoTransitionNotificationPrefsFromStore(appStateStore);
    if (!shouldDispatchAutoTransitionNotification(input, prefs)) {
      return;
    }
    if (!Notification.isSupported()) {
      console.warn('[task:notify] desktop notifications not supported on this platform');
      return;
    }
    const n = new Notification({
      title: formatAutoTransitionNotificationTitle(input),
      body: formatAutoTransitionNotificationBody(input),
      silent: false,
    });
    n.on('failed', (_event, error) => {
      console.warn('[task:notify] notification failed', {
        taskTitle: input.taskTitle,
        nextStatus: input.nextStatus,
        error,
      });
    });
    n.show();
  } catch (err) {
    console.warn('[task:notify] could not show notification', {
      taskTitle: input.taskTitle,
      nextStatus: input.nextStatus,
      err: String(err),
    });
  }
}

export { DEFAULT_AUTO_TRANSITION_NOTIFICATION_PREFS };
