import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readTaskCleanupSkipConfirmation,
  TASK_CLEANUP_SKIP_CONFIRMATION_KEY,
  writeTaskCleanupSkipConfirmation,
} from './taskCleanupConfirmationPrefs';

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
}

describe('taskCleanupConfirmationPrefs', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to showing confirmation', () => {
    expect(readTaskCleanupSkipConfirmation()).toBe(false);
    expect(localStorage.getItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY)).toBeNull();
  });

  it('persists skip when enabled and clears when disabled', () => {
    writeTaskCleanupSkipConfirmation(true);
    expect(readTaskCleanupSkipConfirmation()).toBe(true);
    expect(localStorage.getItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY)).toBe('1');

    writeTaskCleanupSkipConfirmation(false);
    expect(readTaskCleanupSkipConfirmation()).toBe(false);
    expect(localStorage.getItem(TASK_CLEANUP_SKIP_CONFIRMATION_KEY)).toBeNull();
  });
});
