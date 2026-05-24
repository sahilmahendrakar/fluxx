import { describe, expect, it } from 'vitest';
import { BUILTIN_LOCAL_DEVICE_ID } from './constants';
import {
  synthesizeBuiltInLocalDevice,
  parseExecutionDeviceConfig,
  parseTaskExecutionDeviceRef,
  shouldPersistExecutionDeviceToFirestore,
  validateTaskExecutionDeviceRef,
} from './parse';
import {
  executionDeviceFieldForFirestoreWrite,
  parseSharedExecutionDeviceFromFirestore,
} from './firestoreTaskDevice';

describe('parseTaskExecutionDeviceRef', () => {
  it('parses local and ssh refs', () => {
    expect(parseTaskExecutionDeviceRef({ kind: 'local', deviceId: 'local' })).toEqual({
      kind: 'local',
      deviceId: 'local',
    });
    expect(parseTaskExecutionDeviceRef({ kind: 'ssh', deviceId: 'devbox' })).toEqual({
      kind: 'ssh',
      deviceId: 'devbox',
    });
  });

  it('rejects invalid shapes', () => {
    expect(parseTaskExecutionDeviceRef(null)).toBeNull();
    expect(parseTaskExecutionDeviceRef({ kind: 'ssh' })).toBeNull();
  });
});

describe('validateTaskExecutionDeviceRef', () => {
  const ids = new Set(['local', 'devbox']);

  it('requires local id to be built-in', () => {
    expect(validateTaskExecutionDeviceRef({ kind: 'local', deviceId: 'local' }, ids).ok).toBe(
      true,
    );
    expect(validateTaskExecutionDeviceRef({ kind: 'local', deviceId: 'other' }, ids).ok).toBe(
      false,
    );
  });

  it('requires ssh device to exist in registry', () => {
    expect(validateTaskExecutionDeviceRef({ kind: 'ssh', deviceId: 'devbox' }, ids).ok).toBe(
      true,
    );
    expect(validateTaskExecutionDeviceRef({ kind: 'ssh', deviceId: 'missing' }, ids).ok).toBe(
      false,
    );
  });
});

describe('synthesizeBuiltInLocalDevice', () => {
  it('creates local device with tmux flag', () => {
    const d = synthesizeBuiltInLocalDevice({ tmuxEnabled: true, now: '2026-01-01T00:00:00.000Z' });
    expect(d.id).toBe(BUILTIN_LOCAL_DEVICE_ID);
    expect(d.kind).toBe('local');
    expect(d.tmux.enabled).toBe(true);
  });
});

describe('parseExecutionDeviceConfig', () => {
  it('parses ssh device config', () => {
    const raw = synthesizeBuiltInLocalDevice({ now: '2026-01-01T00:00:00.000Z' });
    expect(parseExecutionDeviceConfig(raw)?.id).toBe('local');
  });
});

describe('firestore execution device visibility', () => {
  it('does not persist private ssh to Firestore', () => {
    expect(
      shouldPersistExecutionDeviceToFirestore({ kind: 'ssh', deviceId: 'devbox' }),
    ).toBe(false);
  });

  it('may persist shared runner refs', () => {
    expect(
      shouldPersistExecutionDeviceToFirestore({
        kind: 'runner',
        deviceId: 'r1',
        ownerUid: 'uid',
      }),
    ).toBe(true);
  });

  it('omits private ssh from Firestore write helper', () => {
    expect(
      executionDeviceFieldForFirestoreWrite({ kind: 'ssh', deviceId: 'devbox' }),
    ).toBeUndefined();
    expect(
      executionDeviceFieldForFirestoreWrite({ kind: 'local', deviceId: 'local' }),
    ).toBeUndefined();
    expect(
      executionDeviceFieldForFirestoreWrite({
        kind: 'runner',
        deviceId: 'r1',
        ownerUid: 'u1',
      }),
    ).toEqual({ kind: 'runner', deviceId: 'r1', ownerUid: 'u1' });
  });

  it('does not expose private ssh from Firestore parse', () => {
    expect(
      parseSharedExecutionDeviceFromFirestore({ kind: 'ssh', deviceId: 'devbox' }),
    ).toEqual({});
    expect(
      parseSharedExecutionDeviceFromFirestore({
        kind: 'runner',
        deviceId: 'r1',
        ownerUid: 'u1',
      }),
    ).toEqual({
      executionDevice: { kind: 'runner', deviceId: 'r1', ownerUid: 'u1' },
    });
  });
});
