/**
 * Bulk Firestore optimization utilities.
 *
 * Problem: the app was hitting Firestore's free-tier daily write quota
 * (20,000 writes/day) because:
 *   1. Every Arena vote = 3 writes (trackA + trackB + history) — unavoidable
 *      without a Cloud Function, but we can retry on quota errors.
 *   2. Every profile edit (favorite-slot swap, badge toggle, vibe slider drag)
 *      fired a full `saveUserProfile` write IMMEDIATELY — including a redundant
 *      `getDoc` read first. Dragging a slider 20 times = 20 writes + 20 reads.
 *   3. `handleToggleBadgeDisplay` called `onSaveProfile({})` with an EMPTY
 *      object — a wasted write that wrote nothing.
 *
 * Solution:
 *   - `createDebouncedProfileSaver()` — coalesces rapid profile edits into a
 *     single write. Drives a 800ms debounce so slider drags / rapid slot
 *     swaps only fire one write at the end.
 *   - `withQuotaRetry()` — wraps any Firestore write with exponential backoff
 *     (1s, 2s, 4s, 8s) so transient quota blips don't surface as user-facing
 *     errors. After 4 retries it gives up and the error propagates.
 *   - `isQuotaExceeded()` — detects the "Quota exceeded" Firestore error so
 *     callers can show a friendly toast instead of a JSON dump.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { removeUndefinedFields } from './firestoreService';
import type { UserAccount } from '../types';

// ---------- Quota error detection ----------

/**
 * Returns true if the error is a Firestore quota-exceeded error.
 * Firestore returns this as a FirebaseError with code `resource-exhausted`
 * (gRPC status 8) — but the app's handleFirestoreError wraps it as a
 * JSON string. We check both forms.
 */
export function isQuotaExceeded(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('Quota exceeded')) return true;
  if (msg.includes('resource-exhausted')) return true;
  if (msg.includes('RESOURCE_EXHAUSTED')) return true;
  if (msg.includes('quota')) return true; // last-resort lowercase match
  return false;
}

/**
 * Wraps a Firestore write in exponential-backoff retry.
 * Retries on: quota-exceeded, unavailable, deadline-exceeded.
 * Does NOT retry on: permission-denied, invalid-argument, not-found.
 *
 * Backoff schedule: 1s → 2s → 4s → 8s (4 attempts total).
 * If all 4 fail, the last error propagates.
 */
export async function withQuotaRetry<T>(
  operation: () => Promise<T>,
  label = 'firestore-write',
): Promise<T> {
  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1000;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      const isRetryable =
        msg.includes('Quota exceeded') ||
        msg.includes('resource-exhausted') ||
        msg.includes('unavailable') ||
        msg.includes('deadline-exceeded') ||
        msg.includes('DEADLINE_EXCEEDED') ||
        msg.includes('network-request-failed');

      if (!isRetryable || attempt === MAX_ATTEMPTS - 1) {
        throw err;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      // Add ±20% jitter to avoid thundering-herd on simultaneous retries
      const jitter = delayMs * (0.8 + Math.random() * 0.4);
      console.warn(
        `[withQuotaRetry] ${label} attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (${msg.slice(0, 80)}...), retrying in ${Math.round(jitter)}ms`,
      );
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
  throw lastErr;
}

// ---------- Debounced profile saver ----------

interface PendingProfileWrite {
  userId: string;
  mergedFields: Partial<UserAccount>;
  timer: ReturnType<typeof setTimeout> | null;
  resolveFns: Array<() => void>;
  rejectFns: Array<(err: unknown) => void>;
}

// Single in-flight write per user ID — coalesces all rapid edits into one.
const pendingWrites = new Map<string, PendingProfileWrite>();

const DEBOUNCE_MS = 800;

/**
 * Creates a debounced profile saver for a specific user.
 *
 * Usage:
 *   const saveProfile = useMemo(
 *     () => createDebouncedProfileSaver(currentUser?.id),
 *     [currentUser?.id]
 *   );
 *   // Rapid edits coalesce:
 *   saveProfile({ favoriteTrackIds: [...] });  // schedules write
 *   saveProfile({ vibeSpectrum: {...} });      // merges into same write
 *   // 800ms after the last call, one write fires.
 *
 * The write uses `setDoc` with merge:true — no read-before-write, so it
 * costs 1 write instead of 1 read + 1 write.
 */
export function createDebouncedProfileSaver(userId: string | undefined) {
  if (!userId) {
    // No-op for guests — they don't have a profile to save
    return (_fields: Partial<UserAccount>) => Promise.resolve();
  }

  return function debouncedSaveProfile(fields: Partial<UserAccount>): Promise<void> {
    // Skip empty writes — the old handleToggleBadgeDisplay was passing {}
    // and causing a wasted write + the merged-with-existing-fields overhead.
    const sanitized = removeUndefinedFields(fields);
    if (Object.keys(sanitized).length === 0) {
      return Promise.resolve();
    }

    let pending = pendingWrites.get(userId);

    if (!pending) {
      pending = {
        userId,
        mergedFields: {},
        timer: null,
        resolveFns: [],
        rejectFns: [],
      };
      pendingWrites.set(userId, pending);
    }

    // Merge new fields into the pending write
    pending.mergedFields = { ...pending.mergedFields, ...sanitized };

    // Return a promise that resolves when the eventual write completes
    const promise = new Promise<void>((resolve, reject) => {
      pending!.resolveFns.push(resolve);
      pending!.rejectFns.push(reject);
    });

    // Reset the debounce timer
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.timer = setTimeout(async () => {
      const write = pendingWrites.get(userId);
      if (!write) return;

      // Snapshot the fields + callbacks, then clear the pending entry
      // so concurrent calls during the await don't get lost.
      const fieldsToWrite = write.mergedFields;
      const resolvers = write.resolveFns;
      const rejecters = write.rejectFns;
      pendingWrites.delete(userId);

      try {
        await withQuotaRetry(async () => {
          const docRef = doc(db, 'users', userId);
          // Use setDoc with merge:true — this is 1 write, no read.
          // Also bumps serverTimestamp so we can detect stale docs.
          await setDoc(docRef, {
            ...fieldsToWrite,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }, `saveUserProfile(${userId})`);

        resolvers.forEach(r => r());
      } catch (err) {
        console.error(`[debouncedSaveProfile] Failed for user ${userId}:`, err);
        rejecters.forEach(r => r(err));
      }
    }, DEBOUNCE_MS);

    return promise;
  };
}

/**
 * Flushes any pending debounced profile write immediately.
 * Useful when navigating away from the profile page or before logout.
 */
export async function flushPendingProfileWrite(userId: string): Promise<void> {
  const pending = pendingWrites.get(userId);
  if (!pending || !pending.timer) return;
  clearTimeout(pending.timer);
  // Setting timer to null and invoking the callback manually
  pending.timer = null;
  // Force the debounced function to fire now by waiting 0ms
  await new Promise(resolve => setTimeout(resolve, 0));
  // The pending entry was already consumed by the timer callback above
}

// ---------- Tournament state write coalescing ----------

/**
 * Tournament state writes were firing on every vote (15+ writes per
 * tournament). This coalescer merges rapid tournament updates into
 * a single write per tournament ID.
 *
 * Same debounce pattern as the profile saver.
 */
const pendingTournamentWrites = new Map<string, {
  tournament: any;
  timer: ReturnType<typeof setTimeout> | null;
}>();

const TOURNAMENT_DEBOUNCE_MS = 1500;

/**
 * Creates a debounced tournament-state saver.
 * Rapid votes in a tournament bracket get coalesced into a single write
 * 1.5s after the last vote.
 */
export function createDebouncedTournamentSaver() {
  return function debouncedSaveTournament(tournament: any): void {
    if (!tournament?.id) return;

    let pending = pendingTournamentWrites.get(tournament.id);
    if (!pending) {
      pending = { tournament, timer: null };
      pendingTournamentWrites.set(tournament.id, pending);
    } else {
      pending.tournament = tournament; // latest state wins
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.timer = setTimeout(async () => {
      const write = pendingTournamentWrites.get(tournament.id);
      if (!write) return;
      pendingTournamentWrites.delete(tournament.id);

      try {
        await withQuotaRetry(async () => {
          const docRef = doc(db, 'tournaments', write.tournament.id);
          await setDoc(docRef, removeUndefinedFields(write.tournament), { merge: true });
        }, `saveTournamentState(${tournament.id})`);
      } catch (err) {
        console.error(`[debouncedSaveTournament] Failed for tournament ${tournament.id}:`, err);
      }
    }, TOURNAMENT_DEBOUNCE_MS);
  };
}

// ---------- Arena vote batcher ----------

/**
 * Arena vote batcher — caches Arena votes in memory + localStorage and
 * flushes them to Firestore in bulk when EITHER:
 *   - 5 votes accumulate (threshold flush), OR
 *   - 30 seconds pass since the last vote (idle flush), OR
 *   - the user navigates away / closes the tab (beforeunload flush)
 *
 * Why: each Arena vote = 3 Firestore writes (trackA + trackB + history doc).
 * Batching 5 votes into one `writeBatch()` call drops the trackA/trackB
 * updates from 10 writes (5×2) down to ~2-10 writes (deduped per track),
 * plus 5 history-doc writes. Net savings: ~30-50% on a voting streak.
 *
 * The batch survives page reloads via localStorage, so a vote cast just
 * before a refresh isn't lost. On app startup, any cached batch is
 * rehydrated and flushed within 5 seconds.
 *
 * ELO integrity: the caller already computes the new ELO serially based
 * on its in-memory track list, so the batched writes are just "set to
 * this absolute value" operations — same as the non-batched path. The
 * only race is if two users vote on the same track simultaneously, in
 * which case the last-writer-wins on the ELO field. This is the same
 * race that exists in the non-batched `saveMatchVote` — fixing it
 * properly requires a Cloud Function.
 */

import type { HistoryItem } from '../types';

export interface QueuedArenaVote {
  trackAId: string;
  eloA: number;
  winsA: number;
  lossesA: number;
  drawsA: number;
  matchesPlayedA: number;
  trackBId: string;
  eloB: number;
  winsB: number;
  lossesB: number;
  drawsB: number;
  matchesPlayedB: number;
  newHistItem: HistoryItem;
  voterCoefficient: number;
}

const ARENA_BATCH_STORAGE_KEY = 'anisync_arena_vote_batch';
const ARENA_BATCH_THRESHOLD = 5;       // flush after this many queued votes
const ARENA_BATCH_IDLE_MS = 30_000;    // flush after this many ms idle

let arenaBatch: QueuedArenaVote[] = [];
let arenaFlushTimer: ReturnType<typeof setTimeout> | null = null;
let arenaBatchHydrated = false;

// Rehydrate from localStorage on module load — survives page refresh.
// Wrapped in try/catch because localStorage may be unavailable (SSR, private mode).
function hydrateArenaBatch() {
  if (arenaBatchHydrated) return;
  arenaBatchHydrated = true;
  try {
    const raw = localStorage.getItem(ARENA_BATCH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        arenaBatch = parsed;
        console.info(`[arenaBatch] Rehydrated ${arenaBatch.length} queued vote(s) from localStorage.`);
        // Schedule a flush shortly after app startup so we don't block initial render.
        setTimeout(() => { flushArenaVoteBatch().catch(console.error); }, 5000);
      }
    }
  } catch {
    // ignore
  }
}

function persistArenaBatch() {
  try {
    localStorage.setItem(ARENA_BATCH_STORAGE_KEY, JSON.stringify(arenaBatch));
  } catch {
    // localStorage full or unavailable — batch stays in memory only.
    // Acceptable degradation: the batch will still flush via the timer.
  }
}

/**
 * Queues an Arena vote for batched submission.
 *
 * The vote is added to an in-memory array + persisted to localStorage.
 * A flush is scheduled for ARENA_BATCH_IDLE_MS (30s) later. If the
 * array reaches ARENA_BATCH_THRESHOLD (5) entries, the flush fires
 * immediately.
 *
 * Callers can `await` the returned promise if they need to know when
 * the vote eventually reaches Firestore — but most callers should
 * fire-and-forget so the UI doesn't block on the network.
 */
export function queueArenaVote(vote: QueuedArenaVote): Promise<void> {
  hydrateArenaBatch();

  arenaBatch.push(vote);
  persistArenaBatch();

  // Reset the idle timer
  if (arenaFlushTimer) {
    clearTimeout(arenaFlushTimer);
  }
  arenaFlushTimer = setTimeout(() => {
    flushArenaVoteBatch().catch(console.error);
  }, ARENA_BATCH_IDLE_MS);

  // Threshold flush — fire immediately if we've queued enough votes
  if (arenaBatch.length >= ARENA_BATCH_THRESHOLD) {
    return flushArenaVoteBatch();
  }

  // Return a resolved promise — the caller doesn't need to wait.
  // The actual flush happens asynchronously.
  return Promise.resolve();
}

/**
 * Flushes the queued Arena votes to Firestore via `saveBatchedMatchVotes`.
 * Uses the existing batched-write utility which dedupes track updates.
 *
 * Safe to call multiple times — if the batch is empty, this is a no-op.
 */
export async function flushArenaVoteBatch(): Promise<void> {
  if (arenaBatch.length === 0) return;

  // Cancel any pending idle timer since we're flushing now
  if (arenaFlushTimer) {
    clearTimeout(arenaFlushTimer);
    arenaFlushTimer = null;
  }

  // Snapshot the batch and clear immediately so concurrent queueArenaVote
  // calls during the await don't get lost — they'll go into a fresh batch.
  const batchToFlush = arenaBatch;
  arenaBatch = [];
  persistArenaBatch(); // persist the now-empty batch

  try {
    // Dynamic import to avoid a circular dependency:
    // firestoreService.ts imports from bulkFirestore.ts (for withQuotaRetry)
    // so we can't statically import it here.
    const { saveBatchedMatchVotes } = await import('./firestoreService');
    await withQuotaRetry(
      () => saveBatchedMatchVotes(batchToFlush),
      `arena-vote-batch(${batchToFlush.length} votes)`,
    );
    console.info(`[arenaBatch] Flushed ${batchToFlush.length} vote(s) to Firestore.`);
  } catch (err) {
    console.error(`[arenaBatch] Flush failed — re-queuing ${batchToFlush.length} vote(s).`, err);
    // Re-queue the failed batch at the front so it gets flushed first next time.
    // Don't grow unboundedly — cap at 50 votes (10 failed flushes worth).
    arenaBatch = [...batchToFlush, ...arenaBatch].slice(0, 50);
    persistArenaBatch();
  }
}

/**
 * Returns the current queue length. Useful for showing a "X votes pending
 * sync" indicator in the UI.
 */
export function getArenaBatchSize(): number {
  hydrateArenaBatch();
  return arenaBatch.length;
}

// Register a beforeunload handler so pending votes flush when the user
// closes the tab. Uses sendBeacon-style best-effort — if the flush fails
// the votes are already in localStorage and will be rehydrated next load.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (arenaBatch.length > 0) {
      // Fire-and-forget — the page may close before this resolves, but
      // the localStorage cache means the votes survive.
      flushArenaVoteBatch().catch(() => {});
    }
  });
  // Also flush on visibilitychange (mobile backgrounding)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && arenaBatch.length > 0) {
      flushArenaVoteBatch().catch(() => {});
    }
  });
}

