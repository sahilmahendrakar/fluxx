import { describe, expect, it } from 'vitest';
import {
  cloudExecutionDevicePatchRoute,
  firestoreUpdateIncludesExecutionDevice,
} from './cloudTaskDevicePatch';

describe('cloudExecutionDevicePatchRoute', () => {
  it('routes private ssh to local binding only', () => {
    expect(
      cloudExecutionDevicePatchRoute({ kind: 'ssh', deviceId: 'devbox' }),
    ).toBe('local-binding-only');
    expect(cloudExecutionDevicePatchRoute({ kind: 'local', deviceId: 'local' })).toBe(
      'local-binding-only',
    );
  });

  it('routes shared runner refs to Firestore', () => {
    expect(
      cloudExecutionDevicePatchRoute({
        kind: 'runner',
        deviceId: 'r1',
        ownerUid: 'u1',
      }),
    ).toBe('firestore-only');
  });

  it('clears local override on null', () => {
    expect(cloudExecutionDevicePatchRoute(null)).toBe('clear-local-binding');
  });
});

describe('firestoreUpdateIncludesExecutionDevice', () => {
  it('does not include private ssh in Firestore updates', () => {
    expect(
      firestoreUpdateIncludesExecutionDevice({ kind: 'ssh', deviceId: 'devbox' }),
    ).toBe(false);
    expect(
      firestoreUpdateIncludesExecutionDevice({
        kind: 'runner',
        deviceId: 'r1',
        ownerUid: 'u1',
      }),
    ).toBe(true);
  });
});
