import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { CloudProject } from '../types';
import { useMembers } from '../renderer/projects/useMembers';
import { removeMember } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
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
        <h1 className="text-lg font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite teammates and manage who can collaborate on {project.name}.
        </p>

        {isOwner ? (
          <Card className="mt-6">
            <CardContent className="flex flex-col gap-3 p-4">
              <form className="flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
              <Label htmlFor="team-invite-email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Invite by email
              </Label>
              <div className="flex gap-2">
                <Input
                  id="team-invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className="flex-1"
                />
                <Button type="submit" disabled={busy || !email.trim()}>
                  {busy ? 'Sending…' : 'Send invite'}
                </Button>
              </div>
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              {notice?.kind === 'sent' ? (
                <Alert className="border-status-success/30 bg-status-success/10 text-status-success-foreground">
                  <AlertDescription>
                    Invite sent to {notice.email}. They&apos;ll also receive an email.
                  </AlertDescription>
                </Alert>
              ) : null}
              {notice?.kind === 'saved' ? (
                <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
                  <AlertDescription>
                    Invite saved for {notice.email}. Email delivery{' '}
                    {notice.reason ? `failed: ${notice.reason}` : 'is not configured'}. They&apos;ll
                    still see the invite when they sign in.
                  </AlertDescription>
                </Alert>
              ) : null}
              </form>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-8">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Members</h2>
          {status === 'loading' ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : status === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription>Couldn&apos;t load members: {error}</AlertDescription>
            </Alert>
          ) : members.length === 0 ? (
            <Card>
              <CardContent className="py-4 text-center text-xs text-muted-foreground">No members yet.</CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((m) => {
                const name = m.displayName || m.email || m.uid;
                const canRemove = isOwner && m.uid !== project.ownerId;
                return (
                  <li key={m.uid}>
                    <Card className="py-0">
                      <CardContent className="group flex items-center gap-3 px-3 py-2.5">
                        <ProjectMemberAvatar member={m} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{name}</span>
                            {m.role === 'owner' ? (
                              <Badge
                                variant="outline"
                                className="border-status-needs-input/30 bg-status-needs-input/15 text-status-needs-input-foreground"
                              >
                                Owner
                              </Badge>
                            ) : null}
                            {m.uid === currentUid ? (
                              <Badge variant="secondary">You</Badge>
                            ) : null}
                          </div>
                          {m.email && m.email !== name ? (
                            <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                          ) : null}
                        </div>
                        {canRemove ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleRemove(m.uid)}
                            className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                          >
                            Remove
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {invites.length > 0 ? (
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pending invites
            </h2>
            <ul className="flex flex-col gap-1.5">
              {invites.map((inv) => (
                <li key={inv.email}>
                  <Card className="border-status-needs-input/20 bg-status-needs-input/5 py-0">
                    <CardContent className="group flex items-center gap-3 px-3 py-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-status-needs-input/15 text-sm font-medium text-status-needs-input-foreground">
                        {inv.email.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{inv.email}</div>
                        <div className="text-xs text-muted-foreground">Invite pending</div>
                      </div>
                      {isOwner ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCancelInvite(inv.email)}
                          className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
