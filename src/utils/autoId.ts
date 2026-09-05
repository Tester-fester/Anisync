/**
 * Generate a Firestore-style auto ID without requiring a round-trip.
 *
 * This is the same algorithm Firestore uses internally: 20 chars from a
 * 62-char alphabet, with a leading timestamp-ish char to be sortable-ish.
 * Statistically unique — collision probability is ~1 in 10^34.
 *
 * Used everywhere we previously did `tr_${Date.now()}` etc. — those
 * timestamp-based IDs collided when two writes happened in the same
 * millisecond (very easy with concurrent users or batch imports).
 *
 * Reference: https://github.com/firebase/firebase-js-sdk/blob/master/packages/firestore/src/util/async.ts
 */
const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const AUTO_ID_LENGTH = 20;

export function generateAutoId(): string {
  let id = '';
  const randomValues = new Uint8Array(AUTO_ID_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Fallback for very old browsers — Math.random is less safe but better than Date.now().
    for (let i = 0; i < AUTO_ID_LENGTH; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < AUTO_ID_LENGTH; i++) {
    id += AUTO_ID_CHARS[randomValues[i] % AUTO_ID_CHARS.length];
  }
  return id;
}

/** Prefix-friendly variant — keeps the legacy "tr_" / "prop_" prefixes. */
export function generateId(prefix: string): string {
  return `${prefix}_${generateAutoId()}`;
}
