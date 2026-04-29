import { useEffect, useState } from 'react';
import type { CloudProject } from '../types';
import { useMembers } from '../renderer/projects/useMembers';
import { removeMember } from '../renderer/projects/members';
import {
  backfillInviteProjectNames,
  cancelInvite,
  sendInvite,
  subscribeToProjectInvites,
  type ProjectInvite,
} from '../renderer/invites/invites';

interface Props {
  project: CloudProject;
  currentUid: string;
  currentUserDisplayName?: string;
  currentUserEmail?: string;
}

export function TeamView({
  project,
  currentUid,
  currentUserDisplayName,
  currentUserEmail,
}: Props) {
  const { members, status, error } = useMembers(project.id);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const isOwner = project.ownerId === currentUid;

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    | null
    | { kind: 'sent'; email: string }
    | { kind: 'saved'; email: string; reason?: string }
  >(null);

  useEffect(() => {
    const unsub = subscribeToProjectInvites(project.id, setInvites);
    return () => unsub();
  }, [project.id]);

  useEffect(() => {
    if (!isOwner) return;
    void backfillInviteProjectNames(project.id, project.name);
  }, [isOwner, project.id, project.name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const result = await sendInvite(project.id, currentUid, email, {
        projectName: project.name,
        inviterName: currentUserDisplayName,
        inviterEmail: currentUserEmail,
      });
      if (result.emailed) {
        setNotice({ kind: 'sent', email });
      } else {
        setNotice({ kind: 'saved', email, reason: result.emailError });
      }
      setEmail('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (uid: string) => {
    if (uid === project.ownerId) return;
    if (!window.confirm('Remove this teammate from the project?')) return;
    try {
      await removeMember(project.id, uid);
    } catch (err) {
      console.error('[removeMember] failed', err);
    }
  };

  const handleCancelInvite = async (e: string) => {
    try {
      await cancelInvite(project.id, e);
    } catch (err) {
      console.error('[cancelInvite] failed', err);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100">
          Team
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Invite teammates and manage who can collaborate on {project.name}.
        </p>

        {isOwner ? (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
          >
            <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
              Invite by email
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="flex-1 rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
              >
                {busy ? 'Sending…' : 'Send invite'}
              </button>
            </div>
            {formError ? (
              <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
                {formError}
              </p>
            ) : null}
            {notice?.kind === 'sent' ? (
              <p className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2 text-[12px] text-emerald-200/95">
                Invite sent to {notice.email}. They'll also receive an email.
              </p>
            ) : null}
            {notice?.kind === 'saved' ? (
              <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[12px] text-amber-200/95">
                Invite saved for {notice.email}. Email delivery{' '}
                {notice.reason ? `failed: ${notice.reason}` : 'is not configured'}
                . They'll still see the invite when they sign in.
              </p>
            ) : null}
          </form>
        ) : null}

        <div className="mt-8">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            Members
          </h2>
          {status === 'loading' ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center text-[12px] text-zinc-500">
              Loading…
            </div>
          ) : status === 'error' ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
              Couldn't load members: {error}
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center text-[12px] text-zinc-500">
              No members yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((m) => {
                const name = m.displayName || m.email || m.uid;
                const initial = (m.displayName || m.email || '?')
                  .slice(0, 1)
                  .toUpperCase();
                const canRemove = isOwner && m.uid !== project.ownerId;
                return (
                  <li
                    key={m.uid}
                    className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/[0.12] text-[13px] font-medium text-sky-200/90">
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-100">
                          {name}
                        </span>
                        {m.role === 'owner' ? (
                          <span className="rounded-sm bg-amber-500/[0.12] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-amber-300/90">
                            Owner
                          </span>
                        ) : null}
                        {m.uid === currentUid ? (
                          <span className="rounded-sm bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-400">
                            You
                          </span>
                        ) : null}
                      </div>
                      {m.email && m.email !== name ? (
                        <div className="truncate text-[11px] text-zinc-500">
                          {m.email}
                        </div>
                      ) : null}
                    </div>
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => void handleRemove(m.uid)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-red-300 group-hover:opacity-100"
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {invites.length > 0 ? (
          <div className="mt-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Pending invites
            </h2>
            <ul className="flex flex-col gap-1.5">
              {invites.map((inv) => (
                <li
                  key={inv.email}
                  className="group flex items-center gap-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/[0.12] text-[13px] font-medium text-amber-200/90">
                    {inv.email.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-zinc-100">
                      {inv.email}
                    </div>
                    <div className="text-[11px] text-zinc-500">Invite pending</div>
                  </div>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => void handleCancelInvite(inv.email)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-red-300 group-hover:opacity-100"
                    >
                      Cancel
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
