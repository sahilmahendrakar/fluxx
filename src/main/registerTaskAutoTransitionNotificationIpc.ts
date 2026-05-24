import { ipcMain } from 'electron';
import type { AppStateStore } from './AppStateStore';
import {
  dispatchAutoTransitionNotification,
  getAutoTransitionNotificationPrefsFromStore,
  setAutoTransitionNotificationPrefsInStore,
} from './taskAutoTransitionNotificationDispatch';
import {
  normalizeAutoTransitionNotificationPrefs,
  type AutoTransitionNotificationPrefs,
} from '../taskAutoTransitionNotificationPrefs';
import type { AutoTransitionNotifyInput, AutoTransitionReason } from '../taskAutoTransitionNotification';
import type { TaskStatus } from '../types';

const REASONS: AutoTransitionReason[] = [
  'dependency-unblocked',
  'agent-silence',
  'agent-exited',
  'pr-opened',
  'pr-merged',
];

const STATUSES: TaskStatus[] = [
  'backlog',
  'in-progress',
  'needs-input',
  'review',
  'done',
];

function isReason(value: unknown): value is AutoTransitionReason {
  return typeof value === 'string' && (REASONS as string[]).includes(value);
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

function parseNotifyPayload(raw: unknown): AutoTransitionNotifyInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<AutoTransitionNotifyInput>;
  if (
    typeof o.taskTitle !== 'string' ||
    !isStatus(o.previousStatus) ||
    !isStatus(o.nextStatus) ||
    !isReason(o.reason)
  ) {
    return null;
  }
  return {
    taskTitle: o.taskTitle,
    previousStatus: o.previousStatus,
    nextStatus: o.nextStatus,
    reason: o.reason,
  };
}

export function registerTaskAutoTransitionNotificationIpc(
  appStateStore: AppStateStore,
): {
  dispatch: (input: AutoTransitionNotifyInput) => void;
} {
  ipcMain.handle('notifications:getAutoTransitionPrefs', () =>
    getAutoTransitionNotificationPrefsFromStore(appStateStore),
  );

  ipcMain.handle(
    'notifications:setAutoTransitionPrefs',
    async (_e, raw: unknown): Promise<{ ok: true; prefs: AutoTransitionNotificationPrefs }> => {
      const partial = normalizeAutoTransitionNotificationPrefs(raw);
      const prefs = await setAutoTransitionNotificationPrefsInStore(appStateStore, partial);
      return { ok: true, prefs };
    },
  );

  ipcMain.handle('notifications:notifyAutoTransition', (_e, raw: unknown) => {
    const payload = parseNotifyPayload(raw);
    if (!payload) return { ok: false as const, error: 'INVALID_PAYLOAD' };
    dispatchAutoTransitionNotification(appStateStore, payload);
    return { ok: true as const };
  });

  return {
    dispatch: (input) => dispatchAutoTransitionNotification(appStateStore, input),
  };
}
