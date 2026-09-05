import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, initializeFirestore, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Determine which Firestore database to use.
// - If FIRESTORE_DATABASE_ID env var is set, use it (for named databases).
// - Otherwise, use the project's DEFAULT database (the standard for real
//   Firebase projects, not the AI Studio sandbox).
//
// IMPORTANT: This code runs in the BROWSER, where `process` is not defined.
// We use `import.meta.env` (Vite's built-in env var system) for client-side
// env vars. Server-side env vars (from .env) are NOT accessible in the browser
// unless prefixed with VITE_ and accessed via import.meta.env.
//
// The old hardcoded 'ai-studio-d0af699a-...' ID was a sandbox artifact that
// doesn't exist in real Firebase projects — it caused "Database not found"
// errors. Passing undefined to initializeFirestore uses the default database.
const firestoreDbId =
  (import.meta.env as any).VITE_FIRESTORE_DATABASE_ID   // browser-safe env var
  || (firebaseConfig as any).firestoreDatabaseId
  || undefined;  // ← undefined = use the project's default database

// initializeFirestore with offline persistence + unlimited cache.
// - experimentalForceLongPolling: kept from the sandbox workaround; works in production.
// - cacheSizeBytes: CACHE_SIZE_UNLIMITED — lets the SDK cache as much as the
//   browser will allow. This is CRITICAL for the polling strategy in
//   pollingSubscriptions.ts — when getDocs() is called and the local cache
//   has fresh data, 0 reads are billed. With the default 40MB cache, a user
//   visiting 500 tracks + 200 profiles would evict cache constantly. With
//   unlimited cache, all of it stays local and subsequent polls are free.
export const db = firestoreDbId
  ? initializeFirestore(app, {
      experimentalForceLongPolling: true,
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    }, firestoreDbId)
  : initializeFirestore(app, {
      experimentalForceLongPolling: true,
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    });
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// NOTE: The YouTube scope was previously added here, but it causes
// `auth/internal-error` on apps that haven't been verified by Google for
// sensitive scopes. The app doesn't actually need YouTube API access — it
// uses youtubei.js (no OAuth) for search/resolve. Removed to fix sign-in.
// provider.addScope('https://www.googleapis.com/auth/youtube');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    // Try popup first — better UX (doesn't navigate away from the page).
    // If the popup is blocked/closed (common in Firefox, Safari, mobile),
    // fall back to redirect which navigates the whole page to Google and back.
    let result;
    try {
      result = await signInWithPopup(auth, provider);
    } catch (popupError: any) {
      // auth/popup-closed-by-user: user closed it OR browser blocked it
      // auth/cancelled-popup-request: another popup is already open
      // auth/popup-blocked: browser blocked the popup
      if (
        popupError.code === 'auth/popup-closed-by-user' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-blocked'
      ) {
        console.warn('[Auth] Popup failed (' + popupError.code + '), falling back to redirect...');
        // Redirect approach — the page will navigate to Google, then back.
        // The result is picked up by getRedirectResult() on page load (see below).
        await signInWithRedirect(auth, provider);
        return null; // The page navigates away — this return never completes
      }
      throw popupError; // Re-throw other errors (auth/internal-error, etc.)
    }

    // The access token is optional now that we removed the YouTube scope.
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;

    return { user: result.user, accessToken: cachedAccessToken ?? '' };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Handle the redirect result when the page loads after a redirect sign-in.
// This fires once on app startup if the user was redirected back from Google.
export const handleRedirectResult = async (
  onSuccess?: (user: User) => void,
  onFailure?: (error: any) => void
): Promise<void> => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      cachedAccessToken = credential?.accessToken ?? null;
      if (onSuccess) onSuccess(result.user);
    }
  } catch (error: any) {
    console.error('Redirect result error:', error);
    if (onFailure) onFailure(error);
  }
};

// Always re-fetch the access token via the SDK if we don't have one cached —
// tokens expire after 1h. The cached value is only a short-circuit for the
// same session.
export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  if (errorMessage.includes('the client is offline') || errorMessage.includes('network-request-failed')) {
    console.warn('Firestore Offline/Network Warning: connection blocked (often due to iframe constraints or ad-blockers).');
    throw new Error('Firestore is offline or network request failed. Check connection or ad-blockers.');
  }

  console.warn('Firestore Error/Warning: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// testConnection() removed — it issued a Firestore read on every page load
// just to log a warning. The first real subscription serves the same purpose.
