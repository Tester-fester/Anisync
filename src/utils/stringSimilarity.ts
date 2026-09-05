// =============================================================================
// STRING SIMILARITY — moderation investigation helpers
// -----------------------------------------------------------------------------
// Pure client-side string algorithms for finding "these two names are probably
// the same artist/track/anime, just spelled differently" in the track DB.
//
// Used by the Similarity Investigator in ModerationDashboard.
// =============================================================================

/**
 * Normalizes a name for comparison:
 *  - lowercase
 *  - NFC unicode normalization
 *  - strips accents (é→e, あ stays あ — only Latin accents fold)
 *  - removes trailing punctuation / collapses whitespace
 *  - strips common noise tokens: "feat.", "ft.", parentheses content,
 *    "the ", "&" vs "and" equivalence
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw)
    .normalize('NFC')
    .toLowerCase()
    .trim();

  // Fold Latin accents to base letters (keeps kana/kanji untouched).
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Remove parentheses/brackets content: "Artist (CV: Someone)" → "artist"
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');

  // Remove noise tokens.
  s = s.replace(/\b(feat|ft|featuring|with|w\/|cv|performed by|by)\b\.?/g, ' ');

  // Unify "and" / "&" / "+".
  s = s.replace(/\s*(?:&|\+|and)\s*/g, ' ');

  // Drop punctuation that carries no identity (keep apostrophes removed too).
  s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~'"'?<>|「」『』・ー]/g, ' ');

  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();

  // Remove leading "the ".
  if (s.startsWith('the ')) s = s.slice(4);

  return s;
}

/**
 * Levenshtein edit distance (iterative, two-row DP).
 * Cost: O(lenA * lenB) time, O(min) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Similarity ratio 0..1 (1 = identical) from Levenshtein distance.
 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Token-set similarity — order-insensitive comparison.
 * "Kajiura Yuki" vs "Yuki Kajiura" → 1.
 * Compares the sorted token multisets via character-bag similarity,
 * plus the joined-token similarity, and takes the max.
 */
export function tokenSetSimilarity(a: string, b: string): number {
  const ta = normalizeName(a).split(' ').filter(Boolean).sort();
  const tb = normalizeName(b).split(' ').filter(Boolean).sort();
  if (!ta.length || !tb.length) return 0;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  const joined = similarity(ja, jb);

  // Token-level greedy matching (each token matched to its best counterpart).
  const used = new Set<number>();
  let matched = 0;
  for (const t1 of ta) {
    let best = 0, bestJ = -1;
    tb.forEach((t2, j) => {
      if (used.has(j)) return;
      const s = similarity(t1, t2);
      if (s > best) { best = s; bestJ = j; }
    });
    if (bestJ >= 0 && best >= 0.7) {
      used.add(bestJ);
      matched += best;
    }
  }
  const tokenAvg = matched / Math.max(ta.length, tb.length);
  return Math.max(joined, tokenAvg);
}

/**
 * Combined similarity for artist/anime detection:
 * max(direct similarity, token-set similarity) on normalized names.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(similarity(na, nb), tokenSetSimilarity(na, nb));
}

/**
 * Human explanation of the difference between two names —
 * "same name, 1 letter different", "token order swapped", "substring", etc.
 */
export function describeDifference(a: string, b: string): string {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 'identical after normalization (punctuation/case/order)';

  const dist = levenshtein(na, nb);
  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);

  if (ta.length === tb.length && ta.length > 1) {
    const sortedA = [...ta].sort().join(' ');
    const sortedB = [...tb].sort().join(' ');
    if (sortedA === sortedB) return 'token order swapped';
    if (similarity(sortedA, sortedB) >= 0.8) return `token order swapped + ${dist} char difference`;
  }

  if (dist === 1) return '1 letter different';
  if (dist === 2) return '2 letters different';
  if (na.includes(nb) || nb.includes(na)) return 'one is a substring of the other';
  if (dist <= 4) return `${dist} letters different`;

  return `${dist} char edits (${Math.round(nameSimilarity(a, b) * 100)}% similar)`;
}

export interface SimilarityMatch<T> {
  item: T;
  score: number;
  reason: string;
}

/**
 * Finds all items whose `key` is similar to `query` above `threshold`,
 * sorted by descending score. Pure function, client-side.
 */
export function findSimilar<T>(
  query: string,
  items: T[],
  keyOf: (item: T) => string | null | undefined,
  threshold = 0.75,
): SimilarityMatch<T>[] {
  const nq = normalizeName(query);
  if (!nq) return [];
  const out: SimilarityMatch<T>[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (normalizeName(key) === nq) continue; // skip exact (normalized) matches
    const score = nameSimilarity(nq, key);
    if (score >= threshold) {
      out.push({ item, score, reason: describeDifference(query, key) });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

export interface SimilarityGroup<T> {
  /** Normalized shared identity, e.g. "hiroyuki sawano" */
  normalizedKey: string;
  /** All distinct raw names in the cluster */
  members: { name: string; count: number; items: T[] }[];
}

/**
 * Groups items by similar `keyOf` names using single-linkage clustering:
 * any two names with similarity >= threshold land in the same cluster.
 * Returns only clusters with 2+ distinct raw names.
 */
export function clusterSimilar<T>(
  items: T[],
  keyOf: (item: T) => string | null | undefined,
  threshold = 0.85,
): SimilarityGroup<T>[] {
  // 1. Aggregate distinct names.
  const byName = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key || !key.trim()) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(item);
  }
  const names = [...byName.keys()];
  if (names.length < 2) return [];

  // 2. Map normalized name → canonical first-seen raw name (exact dupes).
  const normToName = new Map<string, string>();
  for (const n of names) {
    const nn = normalizeName(n);
    if (!normToName.has(nn)) normToName.set(nn, n);
  }
  const uniqueNames = [...normToName.values()];
  const uniqueNorms = uniqueNames.map(n => normalizeName(n));

  // 3. Union-Find over unique names.
  const parent = uniqueNames.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < uniqueNorms.length; i++) {
    for (let j = i + 1; j < uniqueNorms.length; j++) {
      if (nameSimilarity(uniqueNorms[i], uniqueNorms[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  // 4. Collect clusters with 2+ members.
  const clusters = new Map<number, number[]>();
  uniqueNames.forEach((_, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  });

  const groups: SimilarityGroup<T>[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length < 2) continue;
    const members = idxs
      .map(i => uniqueNames[i])
      .map(name => ({ name, count: byName.get(name)!.length, items: byName.get(name)! }))
      .sort((a, b) => b.count - a.count);
    groups.push({ normalizedKey: normalizeName(members[0].name), members });
  }
  groups.sort((a, b) => b.members.reduce((s, m) => s + m.count, 0) - a.members.reduce((s, m) => s + m.count, 0));
  return groups;
}
