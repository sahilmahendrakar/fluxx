import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured, whenAuthReady } from '../firebase';

export type AuthStatus = 'unconfigured' | 'loading' | 'signedIn' | 'signedOut';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const configured = isFirebaseConfigured();
  const [status, setStatus] = useState<AuthStatus>(
    configured ? 'loading' : 'unconfigured',
  );
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!configured) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    const loadingFallback = window.setTimeout(() => {
      if (cancelled) return;
      setStatus((prev) => (prev === 'loading' ? 'signedOut' : prev));
    }, 8_000);
    whenAuthReady().then(() => {
      if (cancelled) return;
      const auth = getFirebaseAuth();
      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setStatus(u ? 'signedIn' : 'signedOut');
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(loadingFallback);
      unsub?.();
    };
  }, [configured]);

  const signIn = async () => {
    if (!configured) {
      throw new Error('Firebase not configured.');
    }
    const { idToken } = await window.electronAPI.auth.startGoogleLogin();
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(getFirebaseAuth(), credential);
  };

  const signOut = async () => {
    if (!configured) return;
    await firebaseSignOut(getFirebaseAuth());
  };

  return { status, user, signIn, signOut };
}
