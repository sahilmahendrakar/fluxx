import { useEffect, useState } from 'react';
import { useAuth } from '../renderer/auth/useAuth';

export function SignInCard() {
  const { status, user, signIn, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  // Reset failure state when the photo URL changes (e.g. sign-in/out cycle).
  useEffect(() => {
    setPhotoFailed(false);
  }, [user?.photoURL]);

  if (status === 'unconfigured') {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] text-zinc-500">
        Sign-in disabled — set <code className="font-mono text-zinc-400">VITE_FIREBASE_*</code> and{' '}
        <code className="font-mono text-zinc-400">VITE_GOOGLE_DESKTOP_CLIENT_ID</code> in{' '}
        <code className="font-mono text-zinc-400">.env.local</code> to enable teams.
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-zinc-500">
        Checking sign-in…
      </div>
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
    return (
      <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        {user.photoURL && !photoFailed ? (
          // referrerPolicy="no-referrer" stops Google's CDN
          // (lh3.googleusercontent.com) from rejecting the request based on the
          // app's origin — without it, profile photos sporadically 403/fail to
          // load. onError falls back to the initial-letter avatar so a broken
          // image never leaves a blank circle.
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
            className="h-9 w-9 rounded-full border border-white/[0.08]"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-[13px] font-medium text-zinc-200">
            {(user.displayName ?? user.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-zinc-100">
            {user.displayName ?? 'Signed in'}
          </div>
          <div className="truncate text-[11px] text-zinc-500">{user.email}</div>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={busy}
          className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[12px] font-medium text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-45"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleSignIn()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-zinc-100 transition hover:bg-white/[0.06] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45"
      >
        <GoogleGlyph />
        {busy ? 'Opening browser…' : 'Sign in with Google'}
      </button>
      <p className="text-[11px] text-zinc-500">
        Sign in to create team projects and sync tasks. Local projects work
        without signing in.
      </p>
      {error ? (
        <p
          className="rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95"
          role="alert"
        >
          {error}
        </p>
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
