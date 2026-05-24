import { describe, expect, it } from 'vitest';
import {
  isBrokenRemoteHelperInstallError,
  isRemoteHelperInstallComplete,
  isRemoteHelperVersionCompatible,
  mapHelperErrorCode,
  mapSshFailureToProbeError,
  parseRemoteHelperEnvelope,
} from './remoteHelperProtocol';
import { FLUXX_REMOTE_HELPER_VERSION } from '../../remoteHelper/constants';

describe('parseRemoteHelperEnvelope', () => {
  it('parses the last JSON line from stdout', () => {
    const envelope = parseRemoteHelperEnvelope<{ version: string }>(
      'noise\n{"ok":true,"version":"1.0.0","data":{"version":"1.0.0"}}\n',
    );
    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.data.version).toBe('1.0.0');
    }
  });

  it('parses helper error envelopes with capabilities', () => {
    const envelope = parseRemoteHelperEnvelope('{"ok":false,"error":{"code":"REMOTE_GIT_MISSING","message":"git missing"},"data":{"os":"Linux"}}');
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe('REMOTE_GIT_MISSING');
      expect(envelope.data?.os).toBe('Linux');
    }
  });
});

describe('isRemoteHelperVersionCompatible', () => {
  it('accepts the bundled helper version only', () => {
    expect(isRemoteHelperVersionCompatible(FLUXX_REMOTE_HELPER_VERSION)).toBe(true);
    expect(isRemoteHelperVersionCompatible('0.9.0')).toBe(false);
    expect(isRemoteHelperVersionCompatible(undefined)).toBe(false);
  });
});

describe('isBrokenRemoteHelperInstallError', () => {
  it('detects missing lib module on the remote host', () => {
    expect(
      isBrokenRemoteHelperInstallError(
        "Error: Cannot find module './lib/remoteWorktreePrep'",
      ),
    ).toBe(true);
    expect(isBrokenRemoteHelperInstallError('Connection refused')).toBe(false);
  });
});

describe('isRemoteHelperInstallComplete', () => {
  it('requires version and worktree reclaim feature', () => {
    expect(
      isRemoteHelperInstallComplete(FLUXX_REMOTE_HELPER_VERSION, { worktreeReclaim: true }),
    ).toBe(true);
    expect(isRemoteHelperInstallComplete(FLUXX_REMOTE_HELPER_VERSION, {})).toBe(false);
    expect(isRemoteHelperInstallComplete('0.2.4', { worktreeReclaim: true })).toBe(false);
  });
});

describe('mapSshFailureToProbeError', () => {
  it('maps host key failures', () => {
    expect(
      mapSshFailureToProbeError({
        exitCode: 255,
        stderr: 'Host key verification failed.',
        timedOut: false,
      }).code,
    ).toBe('SSH_HOST_KEY_FAILED');
  });

  it('maps auth failures', () => {
    expect(
      mapSshFailureToProbeError({
        exitCode: 255,
        stderr: 'builder@devbox: Permission denied (publickey).',
        timedOut: false,
      }).code,
    ).toBe('SSH_AUTH_FAILED');
  });

  it('maps timeouts', () => {
    expect(
      mapSshFailureToProbeError({
        exitCode: null,
        stderr: '',
        timedOut: true,
      }).code,
    ).toBe('SSH_TIMEOUT');
  });

  it('maps missing helper exit code 127', () => {
    expect(
      mapSshFailureToProbeError({
        exitCode: 127,
        stderr: 'fluxx-remote-helper: command not found',
        timedOut: false,
      }).code,
    ).toBe('SSH_HELPER_MISSING');
  });
});

describe('mapHelperErrorCode', () => {
  it('passes through known probe codes', () => {
    expect(mapHelperErrorCode('REMOTE_TMUX_MISSING')).toBe('REMOTE_TMUX_MISSING');
    expect(mapHelperErrorCode('UNKNOWN')).toBe('INTERNAL');
  });
});
