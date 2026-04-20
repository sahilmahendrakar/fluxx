import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // storageBucket/messagingSenderId not needed for auth + firestore only.
};

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;
let persistencePromise: Promise<void> | null = null;

function getApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_* in .env and restart.',
    );
  }
  if (!app) app = initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth {
  const a = getApp();
  if (!auth) {
    auth = getAuth(a);
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch(
      (err) => {
        console.error('[firebase] setPersistence failed', err);
      },
    );
  }
  return auth;
}

export function getFirebaseFirestore(): Firestore {
  const a = getApp();
  if (!firestore) {
    try {
      firestore = initializeFirestore(a, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch (err) {
      // initializeFirestore throws if called after getFirestore, so fall back.
      console.warn('[firebase] initializeFirestore failed, falling back', err);
      firestore = getFirestore(a);
    }
  }
  return firestore;
}

export function whenAuthReady(): Promise<void> {
  if (!auth) getFirebaseAuth();
  return persistencePromise ?? Promise.resolve();
}
