import { auth } from './firebase';

/**
 * Base URL for API calls.
 *
 * In Architecture A (Cloudflare Pages frontend + Oracle Cloud VM backend),
 * the frontend and API live on different origins. Set `VITE_API_URL` in your
 * Cloudflare Pages env vars to point at your API (e.g. https://api.yourdomain.com).
 *
 * In Architecture C (single-box, both on same origin), leave this empty —
 * relative `/api/...` calls work as before.
 */
const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

/**
 * Authenticated fetch helper — automatically attaches the Firebase ID token
 * to every /api/* request so the server can identify the user.
 *
 * Also handles Netlify Function timeouts (502/504) by retrying once with a
 * smaller payload if the request is a POST with an array body.
 *
 * Usage (drop-in replacement for fetch on /api/* calls):
 *   import { apiFetch } from '../utils/apiFetch';
 *   const res = await apiFetch('/api/verify-franchise', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ ... }),
 *   });
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Only attach auth + base URL to /api/* requests (not static assets, not external URLs).
  const isApiCall = typeof input === 'string' && input.startsWith('/api/');
  if (!isApiCall) {
    return fetch(input, init);
  }

  // Prepend the API base URL if configured (Architecture A — split origins).
  const url = API_BASE ? `${API_BASE}${input}` : input;

  const user = auth.currentUser;
  const headers = new Headers(init.headers || {});

  if (user) {
    try {
      const token = await user.getIdToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch (err) {
      console.warn('[apiFetch] Failed to get ID token:', err);
    }
  }

  const response = await fetch(url, { ...init, headers });

  // Netlify Functions return 502 or 504 when the function times out (10s limit)
  // or crashes. For POST requests with array bodies, retry once with a smaller
  // payload — this often works because the timeout is usually due to processing
  // a large input.
  if ((response.status === 502 || response.status === 504) && init.method === 'POST' && init.body) {
    console.warn(`[apiFetch] ${response.status} on ${input} — retrying with smaller payload.`);
    const smallerBody = shrinkBody(init.body);
    if (smallerBody && smallerBody !== init.body) {
      return fetch(url, { ...init, headers, body: smallerBody });
    }
  }

  return response;
}

/**
 * Try to shrink a POST body for a retry. If the body is a JSON object with an
 * array field, halve the array. If we can't shrink it, return null (don't retry).
 */
function shrinkBody(body: BodyInit | null | undefined): string | null {
  if (!body || typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Find the first array field and halve it.
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 4) {
        parsed[key] = parsed[key].slice(0, Math.ceil(parsed[key].length / 2));
        return JSON.stringify(parsed);
      }
    }
    return null;
  } catch {
    return null;
  }
}
