import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../renderer/auth/useAuth';

export function SignInCard() {
  const { status, user, signIn, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    setPhotoFailed(false);
  }, [user?.photoURL]);

  if (status === 'unconfigured') {
    return (
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          Sign-in disabled — set <code className="font-mono text-foreground">VITE_FIREBASE_*</code> and{' '}
          <code className="font-mono text-foreground">VITE_GOOGLE_DESKTOP_CLIENT_ID</code> in{' '}
          <code className="font-mono text-foreground">.env.local</code> to enable teams.
        </CardContent>
      </Card>
    );
  }

  if (status === 'loading') {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner />
          Checking sign-in…
        </CardContent>
      </Card>
    );
  }

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  if (status === 'signedIn' && user) {
    const initial = (user.displayName ?? user.email ?? '?').slice(0, 1).toUpperCase();
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-3">
          <Avatar className="size-9">
            {user.photoURL && !photoFailed ? (
              <AvatarImage
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setPhotoFailed(true)}
              />
            ) : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.displayName ?? 'Signed in'}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleSignOut()} disabled={busy}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center gap-2"
        onClick={() => void handleSignIn()}
        disabled={busy}
      >
        <GoogleGlyph />
        {busy ? 'Opening browser…' : 'Sign in with Google'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Sign in to create team projects and sync tasks. Local projects work without signing in.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.961l3.007 2.332C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
