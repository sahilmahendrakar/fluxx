import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [done, setDone] = useState<null | { emailed: boolean; emailError?: string }>(null);

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(420px,92vw)]">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Invite to {projectName}</DialogTitle>
            <DialogDescription>
              They&apos;ll see the invite on their Fluxx homepage after signing in.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {done ? (
              done.emailed ? (
                <Alert className="border-status-success/30 bg-status-success/10 text-status-success-foreground">
                  <AlertDescription>
                    Invite sent to {email}. They&apos;ll also receive an email.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
                  <AlertDescription>
                    Invite saved for {email}. Email delivery{' '}
                    {done.emailError ? `failed: ${done.emailError}` : 'is not configured'}. They&apos;ll
                    still see the invite when they sign in.
                  </AlertDescription>
                </Alert>
              )
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {done ? 'Close' : 'Cancel'}
            </Button>
            {!done ? (
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send invite'}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
