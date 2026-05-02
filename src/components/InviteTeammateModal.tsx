import { useState } from 'react';
import { sendInvite } from '../renderer/invites/invites';

interface Props {
  projectId: string;
  projectName: string;
  invitedByUid: string;
  inviterName?: string;
  inviterEmail?: string;
  onClose: () => void;
}

export function InviteTeammateModal({
  projectId,
  projectName,
  invitedByUid,
  inviterName,
  inviterEmail,
  onClose,
}: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { emailed: boolean; emailError?: string }>(
    null,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sendInvite(projectId, invitedByUid, email, {
        projectName,
        inviterName,
        inviterEmail,
      });
      setDone({ emailed: result.emailed, emailError: result.emailError });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
        className="w-[min(420px,92vw)] rounded-xl border border-flux-border/12 bg-flux-elevated p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">
          Invite to {projectName}
        </h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          They'll see the invite on their Flux homepage after signing in.
        </p>
        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Email
        </label>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="mt-1 w-full rounded-md border border-flux-border/12 bg-flux-surface px-3 py-2 text-[13px] text-flux-fg outline-none focus-visible:border-flux-border/20 focus-visible:ring-1 focus-visible:ring-flux-ring/15"
        />
        {error ? (
          <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
            {error}
          </p>
        ) : null}
        {done ? (
          done.emailed ? (
            <p className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2 text-[12px] text-emerald-200/95">
              Invite sent to {email}. They'll also receive an email.
            </p>
          ) : (
            <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[12px] text-amber-200/95">
              Invite saved for {email}. Email delivery{' '}
              {done.emailError ? `failed: ${done.emailError}` : 'is not configured'}
              . They'll still see the invite when they sign in.
            </p>
          )
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done ? (
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
            >
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
