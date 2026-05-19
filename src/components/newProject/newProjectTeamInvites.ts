import {
  sendInvite,
  type SendInviteResult,
} from '../../renderer/invites/invites';

/** Whether the creation wizard should show the optional invite step. */
export function shouldShowInviteStep(teamSyncEnabled: boolean, signedIn: boolean): boolean {
  return teamSyncEnabled && signedIn;
}

/** Removes an invite email row; always keeps at least one empty field. */
export function removeInviteEmailAtIndex(emails: string[], index: number): string[] {
  if (index < 0 || index >= emails.length) return emails.length > 0 ? emails : [''];
  if (emails.length <= 1) return [''];
  return emails.filter((_, i) => i !== index);
}

export type NewProjectInviteOutcome =
  | { email: string; status: 'sent' }
  | { email: string; status: 'saved'; emailError?: string }
  | { email: string; status: 'failed'; error: string };

export type SendInviteFn = (
  projectId: string,
  invitedByUid: string,
  email: string,
  options: {
    projectName: string;
    inviterName?: string;
    inviterEmail?: string;
  },
) => Promise<SendInviteResult>;

/** Sends invites after project creation; individual failures do not throw. */
export async function sendNewProjectTeamInvites(
  projectId: string,
  invitedByUid: string,
  emails: string[],
  options: {
    projectName: string;
    inviterName?: string;
    inviterEmail?: string;
  },
  sendInviteFn: SendInviteFn = sendInvite,
): Promise<NewProjectInviteOutcome[]> {
  const outcomes: NewProjectInviteOutcome[] = [];
  for (const email of emails) {
    try {
      const result = await sendInviteFn(projectId, invitedByUid, email, options);
      if (result.emailed) {
        outcomes.push({ email, status: 'sent' });
      } else {
        outcomes.push({ email, status: 'saved', emailError: result.emailError });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ email, status: 'failed', error: message });
    }
  }
  return outcomes;
}

/**
 * User-visible warnings after create when some invites did not fully succeed.
 * The project is already created; Team settings can retry failed invites.
 */
export function summarizeNewProjectInviteOutcomes(
  outcomes: NewProjectInviteOutcome[],
): string[] {
  const warnings: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'failed') {
      warnings.push(
        `Could not invite ${outcome.email}: ${outcome.error} You can retry in Team settings.`,
      );
    } else if (outcome.status === 'saved') {
      const detail = outcome.emailError
        ? ` Email delivery failed: ${outcome.emailError}.`
        : ' Email delivery is not configured.';
      warnings.push(
        `Invite saved for ${outcome.email} but no email was sent.${detail} They can still accept from the Fluxx homepage.`,
      );
    }
  }
  return warnings;
}
