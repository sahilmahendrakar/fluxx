import { describe, expect, it } from 'vitest';
import {
  checkForUpdatesMenuLabel,
  isCheckForUpdatesMenuEnabled,
} from './macApplicationMenu';

describe('macApplicationMenu', () => {
  it('disables the menu item while checking or during download lifecycle', () => {
    expect(isCheckForUpdatesMenuEnabled({ status: 'checking' })).toBe(false);
    expect(
      isCheckForUpdatesMenuEnabled({
        status: 'downloading',
        currentVersion: '1',
        latestVersion: '2',
        percent: 0,
        transferred: 0,
        total: 1,
      }),
    ).toBe(false);
    expect(
      isCheckForUpdatesMenuEnabled({
        status: 'downloaded',
        currentVersion: '1',
        latestVersion: '2',
      }),
    ).toBe(false);
    expect(
      isCheckForUpdatesMenuEnabled({ status: 'no_update', currentVersion: '1.0.0' }),
    ).toBe(true);
    expect(
      isCheckForUpdatesMenuEnabled({
        status: 'available',
        currentVersion: '1',
        latestVersion: '2',
      }),
    ).toBe(true);
  });

  it('shows a checking label while metadata check is in flight', () => {
    expect(checkForUpdatesMenuLabel({ status: 'checking' })).toBe('Checking for Updates…');
    expect(checkForUpdatesMenuLabel({ status: 'no_update', currentVersion: '1' })).toBe(
      'Check for Updates…',
    );
  });
});
