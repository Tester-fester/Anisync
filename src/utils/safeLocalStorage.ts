/**
 * Safe localStorage helpers — never throw on parse failure or quota errors.
 *
 * Previously, several places in the app did `JSON.parse(localStorage.getItem(...))`
 * directly inside a useState initializer. If localStorage held a corrupted or
 * partially-written string (e.g. from a tab crash mid-write, or a quota
 * exhaustion), the parse would throw and the root component would fail to
 * mount — white-screening the whole app. These helpers swallow those errors.
 */

export function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[safeLocalStorage] Failed to parse "${key}", clearing.`, err);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

export function safeSetJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // QuotaExceededError or SecurityError (private browsing in some browsers).
    console.warn(`[safeLocalStorage] Failed to write "${key}".`, err);
  }
}

export function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Tracks how many distinct sessions the user has had. A "session" is counted
 * once per page load. Used to suppress AdBanner for the first 3 sessions —
 * new users get a clean first impression without ads above the fold.
 */
export function incrementSessionCount(): number {
  const current = safeGetJSON<number>('anisync_session_count', 0);
  const next = current + 1;
  safeSetJSON('anisync_session_count', next);
  return next;
}

export function getSessionCount(): number {
  return safeGetJSON<number>('anisync_session_count', 0);
}

/**
 * Returns true if the user is "new" (first 3 sessions). AdBanner is suppressed
 * for new users to avoid the "AdSense Space / Requires Publisher ID" first
 * impression.
 */
export function isNewUser(): boolean {
  return getSessionCount() <= 3;
}
