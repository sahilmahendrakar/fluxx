/**
 * Resend-backed transactional email for team invites. The API key ships in
 * the main-process bundle (see vite.main.config.ts `define`), so anyone with
 * the desktop binary can extract it. Acceptable for internal dev; for a
 * public release, move this to a Firebase Cloud Function triggered by writes
 * to `projects/{pid}/invites/{email}` and keep the key server-side.
 */

const RESEND_API = 'https://api.resend.com/emails';

const API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN ?? '';
const FROM_NAME = process.env.RESEND_FROM_NAME ?? 'Fluxx';
const APP_URL = process.env.FLUX_APP_URL || 'http://localhost:5173';

export interface InviteEmailInput {
  to: string;
  projectName: string;
  inviterName?: string;
  inviterEmail?: string;
}

export class EmailService {
  isConfigured(): boolean {
    return Boolean(API_KEY && FROM_DOMAIN);
  }

  async sendInviteEmail(input: InviteEmailInput): Promise<void> {
    if (!this.isConfigured()) {
      // No-op when unconfigured — the invite still lands in Firestore and will
      // surface on the invitee's homepage when they sign in.
      console.warn('[EmailService] Resend not configured; skipping invite email.');
      return;
    }

    const fromAddress = `${FROM_NAME} <noreply@${FROM_DOMAIN}>`;
    const inviter =
      input.inviterName && input.inviterEmail
        ? `${input.inviterName} (${input.inviterEmail})`
        : input.inviterName ?? input.inviterEmail ?? 'A teammate';

    const subject = `${inviter} invited you to "${input.projectName}" on Fluxx`;
    const html = renderInviteHtml({
      projectName: input.projectName,
      inviter,
      appUrl: APP_URL,
    });
    const text = renderInviteText({
      projectName: input.projectName,
      inviter,
      appUrl: APP_URL,
    });

    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [input.to],
        subject,
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Resend responded ${resp.status}: ${body.slice(0, 240)}`,
      );
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInviteHtml(args: {
  projectName: string;
  inviter: string;
  appUrl: string;
}): string {
  const project = escapeHtml(args.projectName);
  const inviter = escapeHtml(args.inviter);
  const appUrl = escapeHtml(args.appUrl);
  return `<!doctype html><html><body style="background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;margin:0;padding:32px">
<div style="max-width:480px;margin:0 auto;padding:28px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02)">
  <h1 style="margin:0 0 8px;font-size:18px;font-weight:600">You've been invited to Fluxx</h1>
  <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6">
    ${inviter} invited you to the project <strong style="color:#fafafa">${project}</strong>.
  </p>
  <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;line-height:1.6">
    Open Fluxx and sign in with this email address. The invite will appear on your homepage — click <em>Accept</em> to join the project.
  </p>
  <p style="margin:0 0 20px">
    <a href="${appUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#ffffff;color:#09090b;font-size:13px;font-weight:600;text-decoration:none">Open Fluxx</a>
  </p>
  <p style="margin:0 0 16px;color:#71717a;font-size:12px;line-height:1.5">
    Or paste this into your browser: <a href="${appUrl}" style="color:#a1a1aa">${appUrl}</a>
  </p>
  <p style="margin:0;color:#71717a;font-size:12px;line-height:1.5">
    If you didn't expect this, you can safely ignore the email.
  </p>
</div>
</body></html>`;
}

function renderInviteText(args: {
  projectName: string;
  inviter: string;
  appUrl: string;
}): string {
  return `${args.inviter} invited you to the Fluxx project "${args.projectName}".

Open Fluxx: ${args.appUrl}

Sign in with this email address. The invite will appear on your homepage — click Accept to join the project.

If you didn't expect this, you can safely ignore the email.`;
}
