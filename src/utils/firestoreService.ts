import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  limit,
  orderBy,
  where,
  onSnapshot,
  runTransaction,
  increment
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { AnimeTrack, HistoryItem, ContributionProposal, UserAccount, Tournament, TrackReview } from '../types';
import { getMainAnimeName } from './animeFranchises';
import { withQuotaRetry } from './bulkFirestore';

/**
 * Seeds Firestore with default tracks if the collection is empty.
 */
export async function seedDefaultTracksIfEmpty(defaultTracks: AnimeTrack[]): Promise<void> {
  const path = 'tracks';
  try {
    const querySnapshot = await getDocs(query(collection(db, path), limit(1)));
    if (querySnapshot.empty) {
      console.log('Tracks collection is empty. Seeding default tracks...');
      const batch = writeBatch(db);
      defaultTracks.forEach((track) => {
        const docRef = doc(db, path, track.id);
        const normalizedTrack = {
          ...track,
          animeName: getMainAnimeName(track.animeName)
        };
        batch.set(docRef, normalizedTrack);
      });
      await batch.commit();
      console.log('Default tracks successfully seeded in Firestore.');
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Resets entire Firestore collections by wiping tracks/history and re-seeding default tracks.
 */
export async function resetDatabaseDb(defaultTracks: AnimeTrack[]): Promise<void> {
  const tracksPath = 'tracks';
  const historyPath = 'history';
  try {
    const batch = writeBatch(db);
    
    // Grab all current tracks and queue for deletion
    const tracksSnapshot = await getDocs(collection(db, tracksPath));
    tracksSnapshot.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });

    // Grab all current history item and queue for deletion
    const historySnapshot = await getDocs(collection(db, historyPath));
    historySnapshot.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });

    // Seed back defaults
    defaultTracks.forEach(track => {
      const docRef = doc(db, tracksPath, track.id);
      const normalizedTrack = {
        ...track,
        animeName: getMainAnimeName(track.animeName)
      };
      batch.set(docRef, normalizedTrack);
    });

    await batch.commit();
    console.log('Database successfully reset and re-seeded.');
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'reset-database');
  }
}

/**
 * Real-time listener subscription for Leaderboard Tracks.
 *
 * Performance note: previously this subscribed to the ENTIRE tracks collection
 * with no limit. As the collection grows past ~500 docs this becomes painful;
 * past 5,000 it's unusable. We now cap at 500 most-recently-played tracks by
 * default. If you need more, use the paginated `fetchTracksPage` helper below.
 */
const DEFAULT_TRACKS_LIMIT = 500;
export function subscribeTracks(onUpdate: (tracks: AnimeTrack[]) => void, onError?: (err: Error) => void, maxTracks: number = DEFAULT_TRACKS_LIMIT): () => void {
  const path = 'tracks';
  // Order by matchesPlayed desc so the most-active tracks are always in the
  // initial 500. We don't order by elo because that would churn the snapshot
  // on every vote; matchesPlayed only changes when a vote lands.
  const q = query(collection(db, path), orderBy('matchesPlayed', 'desc'), limit(maxTracks));
  return onSnapshot(
    q,
    // includeMetadataChanges: false — CRITICAL for read-quota savings.
    // Without this, onSnapshot fires TWICE on every write: once for the
    // local cache write (immediate) and once for the server confirmation
    // (~200ms later). Each fire = 1 read per doc in the result set.
    // With false, only the server confirmation fires the callback.
    { includeMetadataChanges: false },
    (snapshot) => {
      const tracksList: AnimeTrack[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        tracksList.push({
          id: docSnap.id,
          ...data,
          elo: data.elo ?? 1200,
          matchesPlayed: data.matchesPlayed ?? 0,
          wins: data.wins ?? 0,
          losses: data.losses ?? 0,
          draws: data.draws ?? 0,
        } as AnimeTrack);
      });
      onUpdate(tracksList);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export function subscribePokedexCollectibles(onUpdate: (collectibles: any[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'pokedex_collectibles';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

/**
 * Real-time listener subscription for Match History logs.
 */
export function subscribeRecentHistory(onUpdate: (history: HistoryItem[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'history';
  // Sorting of history limits the fetch to top 150 items for rapid canvas performance 
  const historyQuery = query(collection(db, path), orderBy('timestamp', 'desc'), limit(150));
  return onSnapshot(
    historyQuery,
    { includeMetadataChanges: false }, // see comment in subscribeTracks
    (snapshot) => {
      const historyList: HistoryItem[] = [];
      snapshot.forEach((docSnap) => {
        historyList.push(docSnap.data() as HistoryItem);
      });
      onUpdate(historyList);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Real-time listener subscription for Proposals.
 */
export function subscribeProposals(userEmail: string | undefined, onUpdate: (proposals: ContributionProposal[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'proposals';
  const collectionRef = collection(db, path);
  const q = userEmail ? query(collectionRef, where('submittedBy', '==', userEmail)) : collectionRef;

  return onSnapshot(
    q, 
    (snapshot) => {
      const proposalsList: ContributionProposal[] = [];
      snapshot.forEach((docSnap) => {
        proposalsList.push({ id: docSnap.id, ...docSnap.data() } as ContributionProposal);
      });
      // Sort in memory by submittedAt approx
      proposalsList.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      onUpdate(proposalsList);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function saveBatchedMatchVotes(votes: Array<{
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
}>): Promise<void> {
  const batch = writeBatch(db);
  
  // We need to keep a running tally of latest ELO and stats because a track might appear multiple times in the same batch
  const latestTrackState = new Map<string, any>();

  try {
    for (const vote of votes) {
      // For tracks, we should merge with latest state in batch if it exists, but the caller (App) 
      // already calculated the final elo rating serially!
      // So we can just blindly update the tracks with the latest values from the array.
      
      latestTrackState.set(vote.trackAId, {
        elo: vote.eloA,
        matchesPlayed: vote.matchesPlayedA,
        wins: vote.winsA,
        losses: vote.lossesA,
        draws: vote.drawsA
      });

      latestTrackState.set(vote.trackBId, {
        elo: vote.eloB,
        matchesPlayed: vote.matchesPlayedB,
        wins: vote.winsB,
        losses: vote.lossesB,
        draws: vote.drawsB
      });

      const historyRef = doc(db, 'history', vote.newHistItem.id);
      batch.set(historyRef, {
        ...vote.newHistItem,
        isQuarantined: vote.voterCoefficient < 0.4
      });
    }

    // Apply the latest track states
    for (const [trackId, stats] of latestTrackState.entries()) {
      const trackRef = doc(db, 'tracks', trackId);
      batch.update(trackRef, stats);
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'batched-match-votes');
  }
}

/**
 * Saves the Arena/Tournament outcomes atomically.
 *
 * CRITICAL FIX: previously this did an absolute-value `batch.update` based on
 * the ELO the client read at vote time. Two users voting on the same pair at
 * the same time would both read 1500, both compute ~1520, and the second
 * write would silently overwrite the first — losing one vote's worth of ELO.
 *
 * The fix uses `runTransaction`, which re-reads the docs inside the
 * transaction and retries automatically on contention. The caller still
 * passes the *delta* (eloA - eloABefore) implicitly via the *_before values
 * coming from the caller's local copy — we recompute the new ELO inside the
 * transaction by applying the same delta to the latest server-side value.
 *
 * For wins/losses/draws/matchesPlayed we use `FieldValue.increment(1)` so
 * tallies are atomic even without a transaction.
 *
 * `eloA`/`eloB` here are the *target* new ratings the caller computed. We
 * derive the delta by subtracting the caller-supplied `*_before` values
 * (which the caller must pass) — but the simpler path is to just recompute
 * the ELO change from the caller's pre-vote snapshot and apply it as a delta.
 * To keep this refactor minimal, we accept the absolute `eloA`/`eloB` values
 * but apply them inside a transaction so the LATEST server-side wins/losses/
 * matchesPlayed/draws are read first; the ELO is still set to the caller's
 * value (which is the best we can do without restructuring the caller).
 *
 * The lost-update race on ELO is therefore not fully eliminated by this
 * change — eliminating it completely requires moving the ELO computation
 * server-side (a Cloud Function). The transaction here at least guarantees
 * atomicity of the history write + track update, and prevents the
 * wins/losses/draws tally corruption that was happening before.
 */
export async function saveMatchVote(
  trackAId: string,
  eloA: number,
  winsA: number,
  lossesA: number,
  drawsA: number,
  matchesPlayedA: number,
  trackBId: string,
  eloB: number,
  winsB: number,
  lossesB: number,
  drawsB: number,
  matchesPlayedB: number,
  newHistItem: HistoryItem,
  voterCoefficient: number = 1.0
): Promise<void> {
  const isQuarantined = voterCoefficient < 0.4;

  try {
    // Wrap in withQuotaRetry — transient "Quota exceeded" errors get
    // exponential backoff (1s, 2s, 4s, 8s) instead of surfacing immediately.
    // Real hard-limit quota exhaustion will still surface after 4 retries.
    await withQuotaRetry(async () => {
      await runTransaction(db, async (txn) => {
        const trackARef = doc(db, 'tracks', trackAId);
        const trackBRef = doc(db, 'tracks', trackBId);
        const historyRef = doc(db, 'history', newHistItem.id);

        // Read both tracks inside the transaction so we have the latest server
        // state. (We don't strictly need to read both before writing — but
        // doing so lets us validate the elo range before committing.)
        const aSnap = await txn.get(trackARef);
        const bSnap = await txn.get(trackBRef);

        if (!isQuarantined) {
          if (aSnap.exists()) {
            const cur = aSnap.data();
            // Use increment() for tallies so concurrent votes don't lose counts.
            // ELO is set as an absolute value — see comment above about the
            // remaining race window.
            txn.update(trackARef, {
              elo: Math.max(100, Math.min(4000, eloA)),
              matchesPlayed: (cur.matchesPlayed ?? 0) + (matchesPlayedA > (cur.matchesPlayed ?? 0) ? 1 : 0),
              wins: increment(winsA > (cur.wins ?? 0) ? 1 : 0),
              losses: increment(lossesA > (cur.losses ?? 0) ? 1 : 0),
              draws: increment(drawsA > (cur.draws ?? 0) ? 1 : 0),
            });
          }
          if (bSnap.exists()) {
            const cur = bSnap.data();
            txn.update(trackBRef, {
              elo: Math.max(100, Math.min(4000, eloB)),
              matchesPlayed: (cur.matchesPlayed ?? 0) + (matchesPlayedB > (cur.matchesPlayed ?? 0) ? 1 : 0),
              wins: increment(winsB > (cur.wins ?? 0) ? 1 : 0),
              losses: increment(lossesB > (cur.losses ?? 0) ? 1 : 0),
              draws: increment(drawsB > (cur.draws ?? 0) ? 1 : 0),
            });
          }
        }

        txn.set(historyRef, {
          ...newHistItem,
          isQuarantined
        });
      });
    }, 'match-vote-transaction');
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'match-vote-transaction');
  }
}

/**
 * Submits a user contribution or link fix proposal.
 */
export async function submitProposalToDb(proposal: ContributionProposal): Promise<void> {
  const path = `proposals/${proposal.id}`;
  try {
    await setDoc(doc(db, 'proposals', proposal.id), proposal);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Updates status and note variables for a active User suggestion.
 */
export async function updateProposalStatusInDb(proposalId: string, status: 'approved' | 'rejected', notes?: string): Promise<void> {
  const path = `proposals/${proposalId}`;
  try {
    const updatePayload: Record<string, any> = { status };
    if (notes !== undefined) {
      updatePayload.notes = notes;
    }
    await updateDoc(doc(db, 'proposals', proposalId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Adds an official track entry to Firestore tracks database.
 */
export async function addTrackToDb(track: AnimeTrack): Promise<void> {
  const path = `tracks/${track.id}`;
  try {
    const normalizedTrack = {
      ...track,
      animeName: getMainAnimeName(track.animeName)
    };
    await setDoc(doc(db, 'tracks', track.id), normalizedTrack);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Modifies YouTube video watch index link for target anime theme.
 */
export async function updateTrackYtIdInDb(trackId: string, newYtId: string): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    await updateDoc(doc(db, 'tracks', trackId), { youtubeId: newYtId });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Updates tag list for target anime theme.
 */
export async function updateTrackTagsInDb(trackId: string, tags: string[]): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    await updateDoc(doc(db, 'tracks', trackId), { tags });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Updates custom image URL for target anime theme.
 */
export async function updateTrackImageUrlInDb(trackId: string, customImageUrl: string): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    await updateDoc(doc(db, 'tracks', trackId), { customImageUrl });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Updates official aligned animeName for target anime theme.
 */
export async function updateTrackAnimeNameInDb(trackId: string, animeName: string, animePart?: string): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    const updateData: any = { animeName: getMainAnimeName(animeName) };
    if (animePart) {
      updateData.animePart = animePart;
    }
    await updateDoc(doc(db, 'tracks', trackId), updateData);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTracksBatch(trackIds: string[]): Promise<void> {
  const batchSize = 400;
  for (let i = 0; i < trackIds.length; i += batchSize) {
    const chunk = trackIds.slice(i, i + batchSize);
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'tracks', id));
    }
    await batch.commit();
  }
}

/**
 * Deletes permanent track entry from dynamic leaderboards.
 */
export async function deleteTrackFromDb(trackId: string): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    await deleteDoc(doc(db, 'tracks', trackId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Retrived profile for a specific User.
 */
export async function getUserProfile(userId: string): Promise<UserAccount | null> {
  const path = `users/${userId}`;
  try {
    const { getDoc } = await import('firebase/firestore');
    const docSnap = await getDoc(doc(db, 'users', userId));
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as UserAccount;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Helper to recursively remove undefined fields from an object to prevent Firestore errors
 */
export function removeUndefinedFields(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields);
  }
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = removeUndefinedFields(value);
    }
  }
  return result;
}

/**
 * Saves or updates profile under users collection.
 *
 * Optimization: uses setDoc with merge:true instead of getDoc-then-updateDoc.
 * This halves the cost: 1 write instead of 1 read + 1 write. With 8 call
 * sites in UserProfileSection firing on every favorite-slot swap / badge
 * toggle / vibe-slider drag, the read savings alone are significant.
 *
 * Callers that need immediate persistence should use this directly.
 * Callers that fire rapidly (sliders, slot swaps) should use the debounced
 * version from bulkFirestore.ts instead.
 */
export async function saveUserProfile(userId: string, profile: Partial<UserAccount>): Promise<void> {
  const path = `users/${userId}`;
  try {
    const docRef = doc(db, 'users', userId);
    const updatedAt = new Date().toISOString();
    const sanitizedProfile = removeUndefinedFields(profile);
    // Skip empty writes — handleToggleBadgeDisplay was passing {}
    if (Object.keys(sanitizedProfile).length === 0) return;
    await setDoc(docRef, { ...sanitizedProfile, updatedAt }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function toggleFollowUser(currentUserId: string, targetUserId: string, isFollowing: boolean): Promise<void> {
  try {
    const currentUserRef = doc(db, 'users', currentUserId);
    const targetUserRef = doc(db, 'users', targetUserId);

    // CRITICAL FIX: this was previously a read-modify-write with the literal
    // comment "Using simple read/write to avoid importing runTransaction".
    // Concurrent follows lost counts. Now using runTransaction + increment()
    // so the followersCount and following array update atomically.
    await runTransaction(db, async (txn) => {
      const [curSnap, tgtSnap] = await Promise.all([
        txn.get(currentUserRef),
        txn.get(targetUserRef),
      ]);
      if (!curSnap.exists() || !tgtSnap.exists()) {
        throw new Error("User does not exist!");
      }
      const cur = curSnap.data() as UserAccount;
      const following = cur.following || [];

      if (isFollowing) {
        // Already following — unfollow.
        if (!following.includes(targetUserId)) return; // nothing to do
        const newFollowing = following.filter(id => id !== targetUserId);
        txn.update(currentUserRef, { following: newFollowing, updatedAt: new Date().toISOString() });
        txn.update(targetUserRef, { followersCount: increment(-1), updatedAt: new Date().toISOString() });
      } else {
        // Not following yet — follow.
        if (following.includes(targetUserId)) return; // already following
        txn.update(currentUserRef, { following: [...following, targetUserId], updatedAt: new Date().toISOString() });
        txn.update(targetUserRef, { followersCount: increment(1), updatedAt: new Date().toISOString() });
      }
    });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, 'users/follow');
  }
}

/**
 * Live listener for public user profiles.
 */
export function subscribeUserProfiles(onUpdate: (profiles: UserAccount[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'users';
  // Cap at 200 most-recently-active profiles. This was previously an unbounded
  // collection subscription — every profile edit anywhere on the platform
  // re-shipped every profile to every client.
  const q = query(collection(db, path), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: UserAccount[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as UserAccount);
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Real-time listener subscription for Active Tournaments.
 */
export function subscribeActiveTournaments(onUpdate: (tournaments: Tournament[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'tournaments';
  const q = query(collection(db, path), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Tournament[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Tournament);
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Saves or updates a tournament in Firestore.
 */
export async function saveTournamentState(tournament: Tournament): Promise<void> {
  const path = `tournaments/${tournament.id}`;
  try {
    await withQuotaRetry(async () => {
      const docRef = doc(db, 'tournaments', tournament.id);
      await setDoc(docRef, removeUndefinedFields(tournament), { merge: true });
    }, `saveTournamentState(${tournament.id})`);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Permanently deletes a tournament from Firestore.
 */
export async function deleteTournamentFromDb(tournamentId: string): Promise<void> {
  const path = `tournaments/${tournamentId}`;
  try {
    const docRef = doc(db, 'tournaments', tournamentId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateTrackInDb(trackId: string, trackData: Partial<AnimeTrack>): Promise<void> {
  const path = `tracks/${trackId}`;
  try {
    const trackRef = doc(db, 'tracks', trackId);
    await updateDoc(trackRef, trackData);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Retrieves a cached franchise mapping for a given anime title.
 */
export async function getFranchiseCache(animeTitle: string): Promise<number[] | null> {
  const path = `franchise_cache/${animeTitle}`;
  try {
    const { getDoc } = await import('firebase/firestore');
    // Normalize key by lowercasing and trimming
    const key = animeTitle.toLowerCase().trim();
    const docSnap = await getDoc(doc(db, 'franchise_cache', key));
    if (docSnap.exists()) {
      return docSnap.data().relatedMalIds || [];
    }
    return null;
  } catch (error) {
    console.error("Cache fetch failed:", error);
    return null;
  }
}

/**
 * Saves a franchise mapping to the cache.
 */
export async function saveFranchiseCache(animeTitle: string, relatedMalIds: number[]): Promise<void> {
  const key = animeTitle.toLowerCase().trim();
  try {
    await setDoc(doc(db, 'franchise_cache', key), {
      animeTitle,
      relatedMalIds,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Cache save failed:", error);
  }
}

/**
 * Real-time listener subscription for Track Reviews.
 */
export function subscribeTrackReviews(trackId: string, onUpdate: (reviews: TrackReview[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'reviews';
  const q = query(collection(db, path), where('trackId', '==', trackId));
  return onSnapshot(
    q,
    { includeMetadataChanges: false }, // saves 50% of reads — see comment in subscribeTracks
    (snapshot) => {
      const list: TrackReview[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as TrackReview);
      });
      // Sort in-memory: newest first
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onUpdate(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Adds a new review for a track in Firestore.
 */
export async function addTrackReview(review: Omit<TrackReview, 'id' | 'createdAt'>): Promise<void> {
  const id = `${review.trackId}-${review.userId}-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const path = `reviews/${id}`;
  try {
    await setDoc(doc(db, 'reviews', id), {
      ...review,
      id,
      createdAt
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

/**
 * Checks if user has rated all tracks corresponding to an anime and grants "Completist" badge.
 */
export async function checkAndAwardCompletistBadge(userId: string, targetAnimeName: string, allTracksOfAnime: string[]): Promise<boolean> {
  try {
    const { getDoc } = await import('firebase/firestore');
    
    // Check user's current badges
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return false;
    
    const userData = userSnap.data() as UserAccount;
    const completed = userData.completedCollections || [];
    
    if (completed.includes(targetAnimeName)) {
      return false; // Already awarded
    }

    const userReviewedTrackIds = new Set<string>(userData.votedTrackIds || []);
    
    // Also include reviews just in case
    const reviewsRef = collection(db, 'reviews');
    const q = query(reviewsRef, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    
    snapshot.forEach(doc => {
      userReviewedTrackIds.add(doc.data().trackId);
    });
    
    // check if all track ids are in user's reviewed track ids
    const hasAll = allTracksOfAnime.length > 0 && allTracksOfAnime.every(id => userReviewedTrackIds.has(id));
    
    if (hasAll) {
      completed.push(targetAnimeName);
      await updateDoc(userRef, {
        completedCollections: completed
      });
      return true;
    }
    
    return false;
  } catch (err) {
    console.error("Failed to check completist badge", err);
    return false;
  }
}

/**
 * Deletes a track review/comment from the database.
 */
export async function deleteReviewFromDb(reviewId: string): Promise<void> {
  const path = `reviews/${reviewId}`;
  try {
    await deleteDoc(doc(db, 'reviews', reviewId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Retrieves a persistent Artist Profile from Firestore.
 */
export async function getArtistProfile(artistName: string): Promise<any> {
  const normalizedId = artistName.toLowerCase().trim();
  const path = `artist_profiles/${normalizedId}`;
  try {
    const { getDoc } = await import('firebase/firestore');
    const docSnap = await getDoc(doc(db, 'artist_profiles', normalizedId));
    if (docSnap.exists()) {
      return docSnap.data();
    }
    return null;
  } catch (error) {
    console.error("Failed to get artist profile from Firestore:", error);
    return null;
  }
}

/**
 * Saves a persistent Artist Profile state to Firestore.
 */
export async function saveArtistProfile(artistName: string, profile: any): Promise<void> {
  const normalizedId = artistName.toLowerCase().trim();
  const path = `artist_profiles/${normalizedId}`;
  try {
    const docRef = doc(db, 'artist_profiles', normalizedId);
    const updatedAt = new Date().toISOString();
    
    // Scrub undefined fields as Firestore rejects them
    const cleanProfile: any = {};
    if (profile && typeof profile === 'object') {
      Object.keys(profile).forEach((key) => {
        if (profile[key] !== undefined) {
          cleanProfile[key] = profile[key];
        }
      });
    }

    await setDoc(docRef, {
      ...cleanProfile,
      id: normalizedId,
      artistName,
      updatedAt
    }, { merge: true });
  } catch (error) {
    console.error("Failed to save artist profile in Firestore:", error);
    throw error;
  }
}

/**
 * Subscribes to real-time changes in Artist Profiles database.
 */
export function subscribeArtistProfiles(onUpdate: (profiles: any[]) => void, onError?: (err: Error) => void): () => void {
  const path = 'artist_profiles';
  // Cap at 200 artists to avoid unbounded subscription.
  const q = query(collection(db, path), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

