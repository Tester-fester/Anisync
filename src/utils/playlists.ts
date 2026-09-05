// ─────────────────────────────────────────────────────────────────────────────
// Playlist system helpers — shared by SaveToPlaylistModal, UserProfileSection
// and TrackLeaderboard.
//
// Likes are stored as refs on the LIKER's profile (`likedPlaylistRefs`),
// so users only ever write their own document. Counts / community feeds are
// aggregated client-side from the full userProfiles array (the same pattern
// the app already used for playlist discovery).
// ─────────────────────────────────────────────────────────────────────────────

export type PlaylistVisibility = 'public' | 'private';

export interface CustomPlaylist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  visibility?: PlaylistVisibility; // legacy lists without it are public
  isPrivate?: boolean;             // legacy flag, respected
  createdAt?: string;
  copiedFrom?: string;             // "ownerId::playlistId" when saved from community
  originalCreatorName?: string;    // attribution shown on copied lists
}

export interface CommunityPlaylist extends CustomPlaylist {
  ownerId: string;
  ownerName: string;
  ownerPicture?: string;
  likeCount: number;
}

export const playlistRef = (ownerId: string, playlistId: string) => `${ownerId}::${playlistId}`;

export const isPlaylistPublic = (p: any): boolean =>
  !!p && !p.isPrivate && p.visibility !== 'private';

export const userLikesPlaylist = (user: any, ownerId: string, playlistId: string): boolean =>
  !!user?.likedPlaylistRefs?.includes(playlistRef(ownerId, playlistId));

/** All public playlists from every user (optionally excluding one user), sorted by likes. */
export function getCommunityPlaylists(userProfiles: any[], excludeUserId?: string): CommunityPlaylist[] {
  const out: CommunityPlaylist[] = [];
  userProfiles.forEach((u) => {
    if (!u || u.id === excludeUserId) return;
    (u.customLists || []).forEach((list: any) => {
      if (!list?.id || !isPlaylistPublic(list)) return;
      const ref = playlistRef(u.id, list.id);
      const likeCount = userProfiles.reduce(
        (n, voter) => n + (voter?.likedPlaylistRefs?.includes(ref) ? 1 : 0), 0
      );
      out.push({
        ...list,
        visibility: 'public' as const,
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

/** Like counts for every playlist owned by `ownerId`, keyed by playlist id. */
export function getLikeCountsForOwner(userProfiles: any[], ownerId: string): Record<string, number> {
  const map: Record<string, number> = {};
  userProfiles.forEach((u) => {
    (u?.likedPlaylistRefs || []).forEach((ref: string) => {
      const sep = ref.indexOf('::');
      if (sep === -1) return;
      const refOwner = ref.slice(0, sep);
      const plid = ref.slice(sep + 2);
      if (refOwner === ownerId) map[plid] = (map[plid] || 0) + 1;
    });
  });
  return map;
}

/** Returns the likedRefs array with the ref toggled. */
export function toggleLikedRefs(refs: string[] | undefined, ref: string): string[] {
  const cur = refs || [];
  return cur.includes(ref) ? cur.filter(r => r !== ref) : [...cur, ref];
}

/** Returns the list with the track added/removed. */
export function toggleTrackInPlaylist(list: CustomPlaylist, trackId: string): CustomPlaylist {
  const has = (list.trackIds || []).includes(trackId);
  return {
    ...list,
    trackIds: has
      ? (list.trackIds || []).filter(t => t !== trackId)
      : [...(list.trackIds || []), trackId],
  };
}