import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLUXX_INVITE_APP_URL,
  resolveFluxxInviteAppUrl,
} from './fluxxAppUrl';

describe('resolveFluxxInviteAppUrl', () => {
  it('defaults to the fluxx deep link when unset', () => {
    expect(resolveFluxxInviteAppUrl({})).toBe(DEFAULT_FLUXX_INVITE_APP_URL);
    expect(DEFAULT_FLUXX_INVITE_APP_URL).toBe('fluxx://open');
  });

  it('prefers FLUXX_APP_URL over the legacy FLUX_APP_URL name', () => {
    expect(
      resolveFluxxInviteAppUrl({
        FLUXX_APP_URL: 'fluxx://projects',
        FLUX_APP_URL: 'http://localhost:5173',
      }),
    ).toBe('fluxx://projects');
  });

  it('falls back to FLUX_APP_URL when FLUXX_APP_URL is blank', () => {
    expect(
      resolveFluxxInviteAppUrl({
        FLUXX_APP_URL: '   ',
        FLUX_APP_URL: 'https://example.com',
      }),
    ).toBe('https://example.com');
  });
});
