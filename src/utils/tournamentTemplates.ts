// ─────────────────────────────────────────────────────────────────────────────
// Tournament template system — mirrors the playlist system in utils/playlists.
//
// A "template" is a saved bracket blueprint (name + size + trackIds +
// visibility). Likes are stored on the LIKER's profile (`likedTournamentRefs`)
// as "ownerId::templateId" refs, so users only ever write their own document.
// The community feed + like counts are aggregated client-side from userProfiles.
// ─────────────────────────────────────────────────────────────────────────────

import { AnimeTrack } from '../types';

export type TournamentVisibility = 'public' | 'private';

export interface TournamentTemplate {
  id: string;
  name: string;
  size: 4 | 8 | 16 | 32;
  trackIds: string[];
  visibility?: TournamentVisibility; // legacy templates without it are public
  isPrivate?: boolean;               // legacy flag, respected
  createdAt?: string;
  copiedFrom?: string;               // "ownerId::templateId" when saved from community
  originalCreatorName?: string;      // attribution shown on copied templates
}

export interface CommunityTournamentTemplate extends TournamentTemplate {
  ownerId: string;
  ownerName: string;
  ownerPicture?: string;
  likeCount: number;
}

export const tournamentRef = (ownerId: string, templateId: string) => `${ownerId}::${templateId}`;

export const isTournamentPublic = (t: any): boolean =>
  !!t && !t.isPrivate && t.visibility !== 'private';

/** All public tournament templates from every user (excluding one), sorted by likes. */
export function getCommunityTournaments(userProfiles: any[], excludeUserId?: string): CommunityTournamentTemplate[] {
  const out: CommunityTournamentTemplate[] = [];
  userProfiles.forEach((u) => {
    if (!u || u.id === excludeUserId) return;
    (u.customTournaments || []).forEach((t: any) => {
      if (!t?.id || !isTournamentPublic(t)) return;
      const ref = tournamentRef(u.id, t.id);
      const likeCount = userProfiles.reduce(
        (n, voter) => n + (voter?.likedTournamentRefs?.includes(ref) ? 1 : 0), 0
      );
      out.push({
        ...t,
        ownerId: u.id,
        ownerName: u.username || 'Anonymous',
        ownerPicture: u.picture,
        likeCount,
      });
    });
  });
  return out.sort((a, b) =>
    b.likeCount - a.likeCount || (b.trackIds?.length || 0) - (a.trackIds?.length || 0)
  );
}

/** Like counts for every template owned by `ownerId`, keyed by template id. */
export function getTournamentLikeCountsForOwner(userProfiles: any[], ownerId: string): Record<string, number> {
  const map: Record<string, number> = {};
  userProfiles.forEach((u) => {
    (u?.likedTournamentRefs || []).forEach((ref: string) => {
      const sep = ref.indexOf('::');
      if (sep === -1) return;
      if (ref.slice(0, sep) === ownerId) {
        const tid = ref.slice(sep + 2);
        map[tid] = (map[tid] || 0) + 1;
      }
    });
  });
  return map;
}

/** Returns the likedRefs array with the ref toggled. */
export function toggleTournamentRefs(refs: string[] | undefined, ref: string): string[] {
  const cur = refs || [];
  return cur.includes(ref) ? cur.filter(r => r !== ref) : [...cur, ref];
}

/** Pick n distinct track ids from a pool (used by "Fill random"). */
export function pickRandomTrackIds(pool: AnimeTrack[], n: number, excludeIds: Set<string>): string[] {
  const available = pool.filter(t => !excludeIds.has(t.id));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map(t => t.id);
}