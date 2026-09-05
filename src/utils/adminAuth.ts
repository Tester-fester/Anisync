import { User } from 'firebase/auth';

/**
 * Admin authorization helper.
 *
 * OLD BEHAVIOR (removed):
 *   The client compared `user.email === 'mfrimi100@gmail.com'` or
 *   `user.email.endsWith('@anielo.com')` to decide admin privileges. This was
 *   client-side only and trivially spoofable (anyone with that email could
 *   sign up). UserProfileSection additionally treated any username containing
 *   the substring "admin" as an admin — so a user named "admin-fan-99" saw
 *   admin controls.
 *
 * NEW BEHAVIOR:
 *   Admin status is read from the Firebase ID token's custom claims
 *   (`token.admin === true`). Custom claims are set server-side via the
 *   Firebase Admin SDK and cannot be spoofed by the client.
 *
 *   The legacy email allow-list is kept as a fallback during migration. Once
 *   all admins have the `admin: true` claim set, the fallback can be removed.
 *
 * Server-side rules also enforce admin via `request.auth.token.admin == true`
 * (preferred) plus the same email allow-list as a fallback. The two layers
 * agree.
 */

const LEGACY_ADMIN_EMAILS = ['mfrimi100@gmail.com'];
const LEGACY_ADMIN_DOMAIN = '@anielo.com';

export function isLegacyAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return LEGACY_ADMIN_EMAILS.includes(lower) || lower.endsWith(LEGACY_ADMIN_DOMAIN);
}

/**
 * Returns true if the given Firebase user is an admin.
 *
 * Always re-fetches the ID token result (forceRefresh: true) so that
 * freshly-granted admin claims take effect without requiring the user to
 * sign out and back in. This is a network round-trip — callers should cache
 * the result per session.
 */
export async function fetchIsAdmin(user: User | null): Promise<boolean> {
  if (!user) return false;
  try {
    const tokenResult = await user.getIdTokenResult(true);
    const claims = tokenResult.claims as Record<string, unknown>;
    if (claims.admin === true) return true;
    // tokenResult.email is sometimes missing — fall back to user.email.
    const email = (claims.email as string | undefined) ?? user.email;
    if (isLegacyAdminEmail(email)) return true;
    return false;
  } catch (err) {
    console.warn('[adminAuth] Failed to fetch ID token result.', err);
    return false;
  }
}

/**
 * Synchronous check based on the cached (possibly stale) token result. Use this
 * only for UI affordances (showing/hiding admin controls); always pair with
 * the server-side check for actual privileged operations.
 *
 * NOTE: A stale `false` here is safe — server-side rules will still deny the
 * operation. A stale `true` (very unlikely if claims were just revoked) just
 * means the user sees admin UI they can't actually use.
 */
export function maybeAdminFromEmail(email: string | null | undefined): boolean {
  return isLegacyAdminEmail(email);
}
