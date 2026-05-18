import { describe, expect, it, vi } from 'vitest';
import {
  removeInviteEmailAtIndex,
  sendNewProjectTeamInvites,
  shouldShowInviteStep,
  summarizeNewProjectInviteOutcomes,
} from './newProjectTeamInvites';

describe('shouldShowInviteStep', () => {
  it('shows only when team sync is on and the user is signed in', () => {
    expect(shouldShowInviteStep(true, true)).toBe(true);
    expect(shouldShowInviteStep(true, false)).toBe(false);
    expect(shouldShowInviteStep(false, true)).toBe(false);
    expect(shouldShowInviteStep(false, false)).toBe(false);
  });
});

describe('removeInviteEmailAtIndex', () => {
  it('removes a row while keeping at least one field', () => {
    expect(removeInviteEmailAtIndex(['a@x.com', 'b@x.com'], 0)).toEqual(['b@x.com']);
  });

  it('resets to a single empty field when removing the only row', () => {
    expect(removeInviteEmailAtIndex(['a@x.com'], 0)).toEqual(['']);
  });
});

describe('sendNewProjectTeamInvites', () => {
  it('collects per-email outcomes without throwing on failure', async () => {
    const sendInviteFn = vi
      .fn()
      .mockResolvedValueOnce({ wrote: true, emailed: true })
      .mockRejectedValueOnce(new Error('permission denied'));

    const outcomes = await sendNewProjectTeamInvites(
      'pid',
      'uid',
      ['ok@x.com', 'bad@x.com'],
      { projectName: 'Test' },
      sendInviteFn,
    );

    expect(outcomes).toEqual([
      { email: 'ok@x.com', status: 'sent' },
      { email: 'bad@x.com', status: 'failed', error: 'permission denied' },
    ]);
  });

  it('records saved invites when email delivery fails', async () => {
    const sendInviteFn = vi.fn().mockResolvedValue({
      wrote: true,
      emailed: false,
      emailError: 'SMTP down',
    });

    const outcomes = await sendNewProjectTeamInvites(
      'pid',
      'uid',
      ['a@x.com'],
      { projectName: 'Test' },
      sendInviteFn,
    );

    expect(outcomes).toEqual([
      { email: 'a@x.com', status: 'saved', emailError: 'SMTP down' },
    ]);
  });
});

describe('summarizeNewProjectInviteOutcomes', () => {
  it('surfaces failed and email-only outcomes', () => {
    const lines = summarizeNewProjectInviteOutcomes([
      { email: 'a@x.com', status: 'failed', error: 'nope' },
      { email: 'b@x.com', status: 'saved', emailError: 'SMTP down' },
      { email: 'c@x.com', status: 'sent' },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('a@x.com');
    expect(lines[0]).toContain('Team settings');
    expect(lines[1]).toContain('b@x.com');
  });
});
