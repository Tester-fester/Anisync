import React, { useState, useMemo, useEffect } from "react";
import { UserAccount, AnimeTrack, HistoryItem } from "../types";
import {
  Calendar, ShieldCheck, Check, Edit3, Music, Play, Plus, X,
  ChevronDown, ChevronUp, Download, Crown, Trash2, Pencil,
  Swords, Trophy, ListMusic, Users, Copy, Heart, BookmarkPlus,
  Globe, Lock, Search, Loader2, Eye, Sparkles, Fingerprint, Award, Flame,
} from '@/utils/icons';
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { UnifiedShare } from './UnifiedShare';
import { SubscriptionModal } from './SubscriptionModal';
import { generateId } from '../utils/autoId';
import { AdBanner } from './AdBanner';
import { apiFetch } from "../utils/apiFetch";
import {
  CustomPlaylist, CommunityPlaylist,
  isPlaylistPublic, playlistRef, toggleLikedRefs,
  getCommunityPlaylists, getLikeCountsForOwner,
} from "../utils/playlists";

// ─────────────────────────────────────────────────────────────────────────────
// UserProfileSection — sidebar layout (about-rail + content column).
//
//   • No tabs. Two-column desktop: sticky left rail (identity, about, MAL,
//     stats, joined) + right column (Favorites, Vibe, Playlists, Collectibles).
//   • Auto-suggested playlists REMOVED (getRecommendedPlaylistsForUser gone).
//   • Playlists section:
//      - Own profile: [My Playlists | Community] toggle.
//      - Other profiles: their public playlists.
//      - Every playlist has public/private visibility.
//      - Community cards: Like ♥ (stored on liker's profile as likedPlaylistRefs),
//        Save (deep-copies to your playlists), Play, Battle, Tournament.
//   • "Share Top" is now a self-contained modal (ShareCard's props never
//     matched — that's why it only showed a blur).
// ─────────────────────────────────────────────────────────────────────────────

function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 35%), hsl(${(h + 60) % 360} 70% 25%))`;
}

const MalIcon = () => (
  <svg className="w-3.5 h-3.5 text-[#6cbbe6] shrink-0" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" className="opacity-30" strokeDasharray="3 3" />
    <circle cx="12" cy="12" r="5" className="opacity-60" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

function Section({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="pt-6 mt-6 border-t border-zinc-900/80 first:border-t-0 first:mt-0 first:pt-0">
      <div className="flex items-center justify-between gap-2 mb-3.5">
        <h3 className="text-[11px] font-mono font-black uppercase tracking-widest text-zinc-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

interface UserProfileSectionProps {
  profile: UserAccount;
  currentUser?: UserAccount | null;
  userProfiles?: UserAccount[];
  isOwnProfile: boolean;
  onSaveProfile?: (updatedProfile: Partial<UserAccount>) => void;
  allTracks?: AnimeTrack[];
  onPlayTrack?: (track: AnimeTrack) => void;
  onPlayPlaylist?: (tracks: AnimeTrack[], startIndex: number) => void;
  onStartCustomArena?: (trackIds: string[], playlistName: string) => void;
  onStartCustomTournament?: (trackIds: string[], title: string, listId?: string) => void;
  onViewUserProfile?: (userId: string) => void;
  activeTrack?: AnimeTrack | null;
  recentHistory?: HistoryItem[]; // accepted for compat; unused
  pokedexCollectibles?: import('../types').PokedexCollectible[];
}

export default function UserProfileSection({
  profile, currentUser, userProfiles = [], isOwnProfile, onSaveProfile,
  allTracks = [], onPlayTrack, onPlayPlaylist,
  onStartCustomArena, onStartCustomTournament, onViewUserProfile,
  activeTrack, pokedexCollectibles = [],
}: UserProfileSectionProps) {
  const [isEditing, setIsEditing] = useState(false);

  // ── Edit fields ──
  const [editedUsername, setEditedUsername] = useState(profile.username || "");
  const [editedBio, setEditedBio] = useState(profile.bio || "");
  const [editedMalUser, setEditedMalUser] = useState(profile.malUser || "");
  const [editedPicture, setEditedPicture] = useState(profile.picture || "");
  const [editedBanner, setEditedBanner] = useState(profile.banner || "");
  const [useFavoriteAsBanner, setUseFavoriteAsBanner] = useState(false);
  const [backdropIndex, setBackdropIndex] = useState(0);
  const [editedLists, setEditedLists] = useState<CustomPlaylist[]>([]);
  const [editedFavoriteTrackIds, setEditedFavoriteTrackIds] = useState<string[]>([]);
  const [activeSlotEdit, setActiveSlotEdit] = useState<number | null>(null);
  const [slotSearchQuery, setSlotSearchQuery] = useState("");

  // ── Modals ──
  const [showFollowModal, setShowFollowModal] = useState<'followers' | 'following' | null>(null);
  const [showProModal, setShowProModal] = useState(false);
  const [showShareTop, setShowShareTop] = useState(false);
  const [showImportRow, setShowImportRow] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState("");

  // ── Playlists ──
  const [playlistView, setPlaylistView] = useState<'mine' | 'community'>('mine');
  const [communitySearch, setCommunitySearch] = useState('');
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  const [listSearchQuery, setListSearchQuery] = useState("");
  const [isStudioActive, setIsStudioActive] = useState(false);
  const [studioEditingId, setStudioEditingId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListTrackIds, setNewListTrackIds] = useState<string[]>([]);
  const [newListVisibility, setNewListVisibility] = useState<'public' | 'private'>('public');

  const defaultVibe = { nostalgia: 55, hype: 65, atmospheric: 50, symphonic: 45, vocalIntensity: 60 };

  // ── Vibe heuristic (preserved) ────────────────────────────────────────────
  const autoCalculateVibeSpectrum = useMemo(() => {
    return (favIds: string[], lists: any[], votesCount: number) => {
      if (!allTracks || allTracks.length === 0) return defaultVibe;
      const sig = (t: AnimeTrack) => {
        const title = (t.title || "").toLowerCase();
        const anime = (t.animeName || "").toLowerCase();
        const retro = ["evangelion","haruhi","death note","naruto","bleach","one piece","sailor moon","dragon ball","fairy tail","geass"].some(k => anime.includes(k)) || ["moon","wind","again","blue bird"].some(k => title.includes(k));
        const hype = t.type === 'OP' || ["kick back","hero","unravel","guren"].some(k => title.includes(k));
        const atmo = t.type === 'ED' || ["anytime","sadness","moon","wind"].some(k => title.includes(k));
        const symph = t.type === 'OST' || title.includes("theme") || title.includes("swordland");
        const vocal = ["again","unravel","idol","my dearest","crossing field"].some(k => title.includes(k));
        return {
          nostalgia: retro ? 90 : 40,
          hype: hype ? 90 : (t.type === 'OST' ? 30 : 50),
          atmospheric: atmo ? 90 : (hype ? 30 : 50),
          symphonic: symph ? 95 : (t.type === 'OST' ? 85 : 35),
          vocalIntensity: vocal ? 95 : (t.type === 'OST' ? 40 : 65),
        };
      };
      const pool: AnimeTrack[] = [];
      const seen = new Set<string>();
      favIds.forEach(id => { const t = allTracks.find(x => x.id === id); if (t && !seen.has(id)) { pool.push(t); seen.add(id); } });
      lists.forEach(l => (l.trackIds || []).forEach((id: string) => {
        const t = allTracks.find(x => x.id === id); if (t && !seen.has(id)) { pool.push(t); seen.add(id); }
      }));
      if (pool.length === 0) {
        const b = Math.min((votesCount || 0) * 3, 30);
        return { nostalgia: 55 + Math.round(b/3), hype: 65 + Math.round(b/2), atmospheric: 50 + Math.round(b/4), symphonic: 45 + Math.round(b/5), vocalIntensity: 60 + Math.round(b/3) };
      }
      const sums: Record<string, number> = { nostalgia: 0, hype: 0, atmospheric: 0, symphonic: 0, vocalIntensity: 0 };
      pool.forEach(t => { const s = sig(t); Object.keys(sums).forEach(k => (sums[k] += (s as any)[k])); });
      const out: Record<string, number> = {};
      Object.keys(sums).forEach(k => (out[k] = Math.min(100, Math.max(10, Math.round(sums[k] / pool.length)))));
      return out;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTracks]);

  const favoriteTrackIds = useMemo(() => (profile.favoriteTrackIds || []).filter(Boolean), [profile.favoriteTrackIds]);

  const localVibe = useMemo(
    () => autoCalculateVibeSpectrum(favoriteTrackIds, profile.customLists || [], profile.votesCount || 0),
    [favoriteTrackIds, profile.customLists, profile.votesCount, autoCalculateVibeSpectrum]
  );

  // ── Taste Signature ─────────────────────────────────────────────────
  // Derived stats from the user's favorite + custom-list tracks. Every
  // profile gets a unique "fingerprint" — dominant type, dominant artist,
  // obscurity tier, divergence from community consensus. Uses only
  // already-loaded track data (no extra API calls), so it's free.
  const tasteSignature = useMemo(() => {
    const seen = new Set<string>();
    const pool: AnimeTrack[] = [];
    const push = (t?: AnimeTrack) => {
      if (!t || seen.has(t.id)) return;
      seen.add(t.id);
      pool.push(t);
    };
    favoriteTrackIds.forEach(id => push(allTracks.find(t => t.id === id)));
    (profile.customLists || []).forEach(l => (l.trackIds || []).forEach((id: string) => push(allTracks.find(t => t.id === id))));

    if (pool.length === 0) return null;

    // ── Type spread ──
    const typeCounts: Record<string, number> = {};
    pool.forEach(t => {
      const ty = t.type || 'OP';
      typeCounts[ty] = (typeCounts[ty] || 0) + 1;
    });
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const topType = sortedTypes[0]?.[0] || 'OP';
    const topTypePct = pool.length > 0 ? Math.round(((sortedTypes[0]?.[1] || 0) / pool.length) * 100) : 0;

    // ── Artist loyalty ──
    const artistCounts: Record<string, number> = {};
    pool.forEach(t => {
      const a = (t.artist || 'Unknown').trim();
      if (!a || a.toLowerCase() === 'unknown') return;
      artistCounts[a] = (artistCounts[a] || 0) + 1;
    });
    const sortedArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]);
    const topArtist = sortedArtists[0]?.[0] || null;
    const topArtistCount = sortedArtists[0]?.[1] || 0;

    // ── Obscurity score (avg ELO vs community median) ──
    const elos = pool.map(t => t.elo || 1000).filter(e => e > 0);
    const avgElo = elos.length > 0 ? elos.reduce((a, b) => a + b, 0) / elos.length : 1000;
    // Community median = median of all track ELOs. Below = niche taste,
    // above = mainstream. Use a cheap approximation: 1000 is baseline.
    const communityMedian = 1000;
    const eloDelta = Math.round(avgElo - communityMedian);

    let obscurityTier: { label: string; color: string; desc: string };
    if (eloDelta <= -150) obscurityTier = { label: 'Cult Classic Hunter', color: 'text-gold-bright', desc: `Avg ELO ${Math.round(avgElo)} — your taste leans obscure.` };
    else if (eloDelta <= -30) obscurityTier = { label: 'Hidden Gem Finder', color: 'text-moss', desc: `Avg ELO ${Math.round(avgElo)} — you dig beneath the surface.` };
    else if (eloDelta < 80) obscurityTier = { label: 'Balanced Listener', color: 'text-vermillion-tint', desc: `Avg ELO ${Math.round(avgElo)} — mix of hits and deep cuts.` };
    else if (eloDelta < 200) obscurityTier = { label: 'Mainstream Ear', color: 'text-vermillion', desc: `Avg ELO ${Math.round(avgElo)} — you favor the bangers.` };
    else obscurityTier = { label: 'Chart Topper', color: 'text-burnt', desc: `Avg ELO ${Math.round(avgElo)} — all hits, all the time.` };

    // ── Taste divergence from community top tracks ──
    // Community top = the 10 tracks with highest ELO across all loaded.
    const communityTop10 = new Set(
      [...allTracks].sort((a, b) => (b.elo || 0) - (a.elo || 0)).slice(0, 10).map(t => t.id)
    );
    const userInCommunityTop = pool.filter(t => communityTop10.has(t.id)).length;
    const divergencePct = pool.length > 0 ? Math.round(((pool.length - userInCommunityTop) / pool.length) * 100) : 0;

    let divergenceTier: { label: string; color: string };
    if (divergencePct >= 90) divergenceTier = { label: 'Maverick', color: 'text-gold-bright' };
    else if (divergencePct >= 70) divergenceTier = { label: 'Independent', color: 'text-moss' };
    else if (divergencePct >= 40) divergenceTier = { label: 'Balanced', color: 'text-vermillion-tint' };
    else divergenceTier = { label: 'Consensus', color: 'text-vermillion' };

    // ── Anime spread (how many distinct anime) ──
    const distinctAnime = new Set(pool.map(t => t.animeName?.toLowerCase()).filter(Boolean)).size;
    const animeSpread = pool.length > 0 ? Math.round((distinctAnime / pool.length) * 100) : 0;

    return {
      poolSize: pool.length,
      topType,
      topTypePct,
      topArtist,
      topArtistCount,
      obscurityTier,
      divergencePct,
      divergenceTier,
      distinctAnime,
      animeSpread,
    };
  }, [favoriteTrackIds, profile.customLists, allTracks]);

  const [serverVibe, setServerVibe] = useState<typeof localVibe | null>(null);

  const vibeInputTracks = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    const push = (t?: AnimeTrack) => {
      if (!t || seen.has(t.id)) return;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title, artist: t.artist || '', animeName: t.animeName || '', type: t.type || 'OP' });
    };
    favoriteTrackIds.forEach(id => push(allTracks.find(t => t.id === id)));
    (profile.customLists || []).forEach(l => (l.trackIds || []).forEach((id: string) => push(allTracks.find(t => t.id === id))));
    return out.slice(0, 100);
  }, [favoriteTrackIds, profile.customLists, allTracks]);

  const vibeCacheKey = useMemo(() => vibeInputTracks.map(t => t.id).sort().join('|'), [vibeInputTracks]);

  useEffect(() => {
    if (!currentUser || vibeInputTracks.length === 0) { setServerVibe(null); return; }
    let cancelled = false;
    apiFetch('/api/vibe-spectrum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: vibeInputTracks }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then(data => {
        if (!cancelled && data?.vibe) {
          setServerVibe({
            nostalgia: data.vibe.nostalgia ?? 50, hype: data.vibe.hype ?? 50,
            atmospheric: data.vibe.atmospheric ?? 50, symphonic: data.vibe.symphonic ?? 50,
            vocalIntensity: data.vibe.vocalIntensity ?? 50,
          });
        }
      })
      .catch(err => {
        console.warn('[UserProfileSection] vibe fetch failed, using heuristic:', err.message);
        if (!cancelled) setServerVibe(null);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibeCacheKey, !!currentUser]);

  const vibe = serverVibe ?? localVibe;

  const customLists = useMemo(() => {
    return (profile.customLists || []).map((list: any) => {
      if (list.name && String(list.name).toUpperCase().includes("ANHEM")) {
        return { ...list, name: String(list.name).replace(/ANHEM/i, "ANTHEM").replace(/Anhem/i, "Anthem") };
      }
      return list;
    }) as CustomPlaylist[];
  }, [profile.customLists]);

  // Public lists only when viewing someone else.
  const visibleLists = useMemo(
    () => (isOwnProfile ? customLists : customLists.filter(isPlaylistPublic)),
    [customLists, isOwnProfile]
  );

  useEffect(() => {
    setEditedUsername(profile.username || "");
    setEditedBio(profile.bio || "");
    setEditedMalUser(profile.malUser || "");
    setEditedPicture(profile.picture || "");
    setEditedBanner(profile.banner || "");
    setEditedLists(profile.customLists || []);
    setEditedFavoriteTrackIds(profile.favoriteTrackIds || []);
  }, [profile]);

  // ── Playlist aggregation ──────────────────────────────────────────────────
  const myLikeCounts = useMemo(
    () => getLikeCountsForOwner(userProfiles, profile.id),
    [userProfiles, profile.id]
  );

  const communityPlaylists = useMemo(
    () => getCommunityPlaylists(userProfiles, profile.id),
    [userProfiles, profile.id]
  );

  const communityFiltered = useMemo(() => {
    const q = communitySearch.toLowerCase().trim();
    if (!q) return communityPlaylists;
    return communityPlaylists.filter(p =>
      p.name?.toLowerCase().includes(q) || p.ownerName?.toLowerCase().includes(q)
    );
  }, [communityPlaylists, communitySearch]);

  const likedRefs: string[] = currentUser?.likedPlaylistRefs || [];
  const iLike = (ownerId: string, playlistId: string) =>
    likedRefs.includes(playlistRef(ownerId, playlistId));

  const toggleLike = async (ownerId: string, playlistId: string, name: string) => {
    if (!currentUser) { toast.error('Log in to like playlists.'); return; }
    if (!onSaveProfile) { toast.error('Unavailable right now.'); return; }
    const ref = playlistRef(ownerId, playlistId);
    const nowLiked = !likedRefs.includes(ref);
    try {
      await onSaveProfile({ likedPlaylistRefs: toggleLikedRefs(likedRefs, ref) } as any);
      toast.success(nowLiked ? `Liked "${name}".` : `Unliked "${name}".`);
    } catch {
      toast.error('Failed to save like.');
    }
  };

  const alreadyCopied = (cp: CommunityPlaylist) =>
    customLists.some(l => l.copiedFrom === playlistRef(cp.ownerId, cp.id));

  const saveCommunityPlaylist = async (cp: CommunityPlaylist) => {
    if (!currentUser) { toast.error('Log in to save playlists.'); return; }
    if (!onSaveProfile) { toast.error('Unavailable right now.'); return; }
    if (alreadyCopied(cp)) { toast.info(`"${cp.name}" is already in your playlists.`); return; }
    const copy: CustomPlaylist = {
      id: generateId('list'),
      name: cp.name,
      description: cp.description || '',
      trackIds: [...(cp.trackIds || [])],
      visibility: 'private',
      createdAt: new Date().toISOString(),
      copiedFrom: playlistRef(cp.ownerId, cp.id),
      originalCreatorName: cp.ownerName,
    };
    try {
      await onSaveProfile({ customLists: [...customLists, copy] } as any);
      toast.success(`Saved "${cp.name}" to your playlists (private).`);
    } catch {
      toast.error('Failed to save playlist.');
    }
  };

  // ── Save profile ──────────────────────────────────────────────────────────
  const handleSave = () => {
    const isPro = profile.subscriptionTier === 'pro';
    const isGif = (url: string) => url.trim().toLowerCase().includes('.gif') || url.includes('image/gif');
    if (!isPro && isGif(editedPicture)) { toast.error("Animated Profile Pictures are a Pro Feature!"); return; }
    if (!isPro && !useFavoriteAsBanner && isGif(editedBanner)) { toast.error("Animated Banners are a Pro Feature!"); return; }
    if (onSaveProfile) {
      onSaveProfile({
        username: editedUsername.trim() || profile.username || "",
        bio: editedBio.trim() || "",
        malUser: editedMalUser.trim() || "",
        picture: editedPicture.trim() || profile.picture || "",
        banner:
          (useFavoriteAsBanner && editedFavoriteTrackIds[backdropIndex]
            ? `https://img.youtube.com/vi/${allTracks.find(t => t.id === editedFavoriteTrackIds[backdropIndex])?.youtubeId || "default"}/maxresdefault.jpg`
            : editedBanner.trim() || profile.banner) || "",
        vibeSpectrum: autoCalculateVibeSpectrum(editedFavoriteTrackIds, editedLists, profile.votesCount || 0),
        customLists: editedLists || [],
        favoriteTrackIds: editedFavoriteTrackIds.filter(Boolean),
      });
      setIsEditing(false);
      setActiveSlotEdit(null);
      setSlotSearchQuery("");
    }
  };

  // ── Share codes ───────────────────────────────────────────────────────────
  const handleExportPlaylist = (name: string, description: string, trackIds: string[]) => {
    try {
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ n: name, d: description || "", t: trackIds || [] }))));
      navigator.clipboard.writeText(`ANISYNC-PL-${b64}`);
      toast.success(`Share code for "${name}" copied!`);
    } catch (err: any) {
      toast.error("Failed to compile share code: " + err.message);
    }
  };

  const handleImportPlaylistCode = () => {
    if (!importCodeInput.trim()) { toast.error("Paste a share code starting with ANISYNC-PL-"); return; }
    try {
      const val = importCodeInput.trim();
      if (!val.startsWith("ANISYNC-PL-")) { toast.error("Invalid share code."); return; }
      const payload = JSON.parse(decodeURIComponent(escape(atob(val.replace("ANISYNC-PL-", "")))));
      if (!payload.n || !Array.isArray(payload.t)) { toast.error("Malformed share code."); return; }
      const imported: CustomPlaylist = {
        id: generateId('list'),
        name: payload.n.endsWith("[Imported]") ? payload.n : `${payload.n} [Imported]`,
        description: payload.d || "",
        trackIds: payload.t,
        visibility: 'private',
        createdAt: new Date().toISOString(),
      };
      if (onSaveProfile) {
        onSaveProfile({ customLists: [...customLists, imported] } as any);
        toast.success(`Imported "${payload.n}"!`);
      }
      setImportCodeInput("");
      setShowImportRow(false);
    } catch (err: any) {
      console.error(err);
      toast.error("Share code may be corrupted.");
    }
  };

  // ── Studio (create/edit) ──────────────────────────────────────────────────
  const openCreate = () => {
    setStudioEditingId(null);
    setNewListName(""); setNewListDesc(""); setNewListTrackIds([]);
    setNewListVisibility('public'); setListSearchQuery("");
    setIsStudioActive(true);
  };

  const openEdit = (list: CustomPlaylist) => {
    setStudioEditingId(list.id);
    setNewListName(list.name || "");
    setNewListDesc(list.description || "");
    setNewListTrackIds(list.trackIds || []);
    setNewListVisibility(isPlaylistPublic(list) ? 'public' : 'private');
    setListSearchQuery("");
    setIsStudioActive(true);
  };

  const commitStudio = () => {
    if (!newListName.trim()) { toast.error("Give the playlist a name."); return; }
    const node: CustomPlaylist = {
      id: studioEditingId || generateId('list'),
      name: newListName.trim(),
      description: newListDesc.trim(),
      trackIds: newListTrackIds,
      visibility: newListVisibility,
      createdAt: new Date().toISOString(),
    };
    const updated = studioEditingId
      ? customLists.map(l => (l.id === studioEditingId ? { ...l, ...node } : l))
      : [...customLists, node];
    if (onSaveProfile) {
      onSaveProfile({
        customLists: updated,
        vibeSpectrum: autoCalculateVibeSpectrum(favoriteTrackIds, updated, profile.votesCount || 0),
      } as any);
      toast.success(`Playlist "${node.name}" saved!`);
    }
    setIsStudioActive(false);
    setStudioEditingId(null);
  };

  const deleteList = (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"?`)) return;
    const updated = customLists.filter(l => l.id !== id);
    if (onSaveProfile) {
      onSaveProfile({
        customLists: updated,
        vibeSpectrum: autoCalculateVibeSpectrum(favoriteTrackIds, updated, profile.votesCount || 0),
      } as any);
      toast.success(`Playlist "${name}" deleted.`);
    }
  };

  // ── MAL stats (preserved) ─────────────────────────────────────────────────
  const [malStats, setMalStats] = useState<{ completed: number | null; score: number | null; loading: boolean; error: boolean }>(
    { completed: null, score: null, loading: false, error: false }
  );

  useEffect(() => {
    if (!profile?.malUser?.trim()) { setMalStats({ completed: null, score: null, loading: false, error: false }); return; }
    let mounted = true;
    setMalStats(s => ({ ...s, loading: true, error: false }));
    fetch(`https://api.jikan.moe/v4/users/${encodeURIComponent(profile.malUser.trim())}/statistics`)
      .then(res => { if (!res.ok) throw new Error("not found"); return res.json(); })
      .then(json => {
        if (!mounted || !json?.data?.anime) return;
        setMalStats({
          completed: typeof json.data.anime.completed === "number" ? json.data.anime.completed : null,
          score: typeof json.data.anime.mean_score === "number" ? Number(json.data.anime.mean_score.toFixed(2)) : null,
          loading: false, error: false,
        });
      })
      .catch(() => { if (mounted) setMalStats({ completed: null, score: null, loading: false, error: true }); });
    return () => { mounted = false; };
  }, [profile?.malUser]);

  // ── Banner cascade ────────────────────────────────────────────────────────
  const [bannerTier, setBannerTier] = useState(0);
  const activeBannerUrl = useMemo(() => {
    if (profile.banner) return profile.banner;
    if (favoriteTrackIds[0]) {
      const match = allTracks.find(t => t.id === favoriteTrackIds[0]);
      if (match) {
        const tiers = ['maxresdefault', 'mqdefault', 'hqdefault'];
        return `https://img.youtube.com/vi/${match.youtubeId}/${tiers[bannerTier] || 'mqdefault'}.jpg`;
      }
    }
    return null;
  }, [profile.banner, favoriteTrackIds, allTracks, bannerTier]);

  useEffect(() => { setBannerTier(0); }, [favoriteTrackIds[0]]);

  // ── Radar geometry ────────────────────────────────────────────────────────
  const radarCenter = 140, radarRadius = 70;
  const vibeCategories = [
    { key: "nostalgia", short: "Retro", name: "Retro & Nostalgic", desc: "Classic 90s and early 2000s sound styles." },
    { key: "hype", short: "Hype", name: "Hype & High Energy", desc: "High-tempo beats, rock guitars, and drums." },
    { key: "atmospheric", short: "Chill", name: "Chill & Melancholy", desc: "Slower, relaxing tracks and mood-setting lofi." },
    { key: "symphonic", short: "Orchestral", name: "Instrumentals & Orchestrated", desc: "Classical backing, violins, orchestral scores." },
    { key: "vocalIntensity", short: "Vocals", name: "Powerful Vocals", desc: "Passionate melodies, emotional singers, choirs." },
  ];
  const [hoveredVibeCategory, setHoveredVibeCategory] = useState<string | null>(null);
  const pointAt = (i: number, val: number, r: number) => {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    const rad = (val / 100) * r;
    return { x: radarCenter + rad * Math.cos(a), y: radarCenter + rad * Math.sin(a) };
  };
  const radarPolygon = (v: any) =>
    vibeCategories.map((c, i) => { const p = pointAt(i, v[c.key] || 50, radarRadius); return `${p.x},${p.y}`; }).join(" ");
  const gridPolygon = (pct: number) =>
    vibeCategories.map((_, i) => { const p = pointAt(i, pct, radarRadius); return `${p.x},${p.y}`; }).join(" ");

  // ── Misc ──────────────────────────────────────────────────────────────────
  const filteredListTracksInCreator = allTracks.filter(track => {
    if (!listSearchQuery.trim()) return true;
    const q = listSearchQuery.toLowerCase();
    return track.title.toLowerCase().includes(q) || track.animeName.toLowerCase().includes(q) || (track.artist || "").toLowerCase().includes(q);
  });

  const filteredSlotTracks = allTracks.filter(track => {
    if (!slotSearchQuery.trim()) return true;
    const q = slotSearchQuery.toLowerCase();
    return track.title.toLowerCase().includes(q) || track.animeName.toLowerCase().includes(q) || (track.artist || "").toLowerCase().includes(q);
  });

  const topFavoriteTrack = useMemo(
    () => allTracks.find(t => t.id === favoriteTrackIds[0]) || null,
    [favoriteTrackIds, allTracks]
  );

  const setSlotTrack = (slot: number, trackId: string | null) => {
    setEditedFavoriteTrackIds(prev => {
      const next = [...(prev || [])];
      while (next.length < 4) next.push('');
      next[slot] = trackId || '';
      return next;
    });
    setActiveSlotEdit(null);
    setSlotSearchQuery("");
  };

  const tracksById = useMemo(() => {
    const m = new Map<string, AnimeTrack>();
    allTracks.forEach(t => m.set(t.id, t));
    return m;
  }, [allTracks]);

  const playableIds = (ids: string[]) => (ids || []).filter(id => tracksById.has(id));

  const inputCls = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-xs text-white outline-none focus:border-brand-primary/60 transition-colors";

  // Playlist card mosaic cover
  const PlaylistCover = ({ trackIds }: { trackIds: string[] }) => {
    const covers = (trackIds || []).slice(0, 4).map(id => tracksById.get(id)).filter(Boolean) as AnimeTrack[];
    return (
      <div className="h-20 grid grid-cols-2 grid-rows-2 gap-px bg-zinc-950 rounded-lg overflow-hidden border border-zinc-900">
        {covers.length > 0 ? covers.map(t => (
          <img key={t.id}
            src={t.customImageUrl || `https://img.youtube.com/vi/${t.youtubeId}/default.jpg`} alt=""
            className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
        )) : (
          <div className="col-span-2 row-span-2 flex items-center justify-center"><ListMusic className="w-5 h-5 text-zinc-700" /></div>
        )}
      </div>
    );
  };

  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="bg-[#0e0e11] border border-zinc-900 rounded-2xl overflow-hidden shadow-2xl shadow-zinc-950/60">

      {/* ── Banner ── */}
      <div className="relative h-28 md:h-32 bg-[#07090e] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c1224] via-[#0a0f1c] to-[#070a14]" />
        {activeBannerUrl && bannerTier < 3 && (
          <img src={activeBannerUrl} alt="" aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            onError={() => setBannerTier(t => t + 1)} referrerPolicy="no-referrer" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e11] via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="px-5 md:px-7 pb-8">

        {/* ── Identity row (avatar overlapping banner) ── */}
        <div className="flex flex-col sm:flex-row gap-4 sm:items-end -mt-12 md:-mt-14 relative z-10">
          <div className="relative shrink-0 select-none self-start sm:self-auto">
            {profile.picture ? (
              <img src={profile.picture} alt={profile.username}
                className="w-24 h-24 md:w-28 md:h-28 rounded-full border-4 border-[#0e0e11] object-cover ring-1 ring-zinc-800"
                referrerPolicy="no-referrer" />
            ) : (
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full border-4 border-[#0e0e11] ring-1 ring-zinc-800 flex items-center justify-center text-4xl font-display font-black text-white"
                style={{ background: avatarGradient(profile.id || profile.username || 'anon') }}>
                {(profile.username || 'A').charAt(0).toUpperCase()}
              </div>
            )}
            {activeTrack && favoriteTrackIds.includes(activeTrack.id) && (
              <span className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full bg-moss border-4 border-[#0e0e11] z-20"
                title="Now playing one of their favorites">
                <span className="absolute inset-0 rounded-full bg-moss opacity-60" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 sm:pb-1">
            <h2 className="text-xl md:text-2xl font-display font-black text-white tracking-tight leading-tight truncate">
              {profile.username}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {profile.role === "admin" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-deep/10 border border-rose-deep/30 text-[10px] font-mono uppercase tracking-widest font-black text-vermillion-tint">
                  <Crown className="w-3 h-3 text-vermillion" /> Admin
                </span>
              ) : profile.subscriptionTier === 'pro' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gold/10 border border-gold-bright/30 text-[10px] font-mono uppercase tracking-widest font-black text-gold-bright">
                  <Crown className="w-3 h-3 text-gold-bright" /> Pro
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-primary/10 border border-brand-primary/30 text-[10px] font-mono uppercase tracking-widest font-black text-brand-primary">
                  <Trophy className="w-3 h-3" /> Ranked
                </span>
              )}
              {profile.role === "admin" && (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-zinc-800/60 border border-zinc-700/50" title="Verified Admin">
                  <ShieldCheck className="w-3.5 h-3.5 text-brand-primary" />
                </span>
              )}
              {profile.malUser && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/50 text-[10px] font-mono uppercase tracking-widest font-black text-[#6cbbe6]"
                  title={`MyAnimeList synced as ${profile.malUser}`}>
                  <MalIcon /> MAL
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-wrap sm:pb-1 shrink-0">
            <UnifiedShare
              title={`${profile.username}'s ANISYNC Profile`}
              text={`Check out ${profile.username}'s Anime themes profile on ANISYNC! 🎵`}
            />
            {isOwnProfile ? (
              !isEditing && (
                <>
                  {profile.subscriptionTier !== 'pro' && (
                    <button onClick={() => setShowProModal(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gold/20 border border-gold-bright/40 text-gold-bright font-black text-[10px] uppercase tracking-widest hover:bg-gold/30 transition-all cursor-pointer">
                      <Crown className="w-3.5 h-3.5 text-gold-bright" /> Go Pro
                    </button>
                  )}
                  <button onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0A0805] border border-zinc-800 text-zinc-300 font-black text-[10px] uppercase tracking-widest hover:text-white hover:border-zinc-600 transition-all cursor-pointer">
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                </>
              )
            ) : (
              currentUser && (
                <button
                  onClick={async () => {
                    if (!currentUser) return;
                    const isFollowing = currentUser.following?.includes(profile.id);
                    try {
                      const { toggleFollowUser } = await import('../utils/firestoreService');
                      await toggleFollowUser(currentUser.id, profile.id, !!isFollowing);
                    } catch (e) { console.error('Follow failed', e); }
                  }}
                  className={`px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest border transition-all cursor-pointer ${
                    currentUser.following?.includes(profile.id)
                      ? "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white"
                      : "bg-brand-primary border-brand-primary text-black hover:brightness-110"
                  }`}>
                  {currentUser.following?.includes(profile.id) ? "Following" : "+ Follow"}
                </button>
              )
            )}
          </div>
        </div>

        {isEditing ? (
          /* ══════════ EDIT MODE (full width) ══════════ */
          <div className="mt-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-brand-primary" />
                <h3 className="font-mono text-xs font-black text-white uppercase tracking-widest">Edit Profile</h3>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave}
                  className="flex items-center gap-2 py-2 px-4 bg-brand-primary hover:brightness-110 text-black font-mono font-black text-[10px] uppercase tracking-widest rounded-lg cursor-pointer transition-all">
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button onClick={() => { setIsEditing(false); setActiveSlotEdit(null); }}
                  className="py-2 px-4 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 font-mono font-black text-[10px] uppercase tracking-widest rounded-lg cursor-pointer transition-all">
                  Cancel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase font-black tracking-wider block">Username</label>
                <input type="text" value={editedUsername} onChange={e => setEditedUsername(e.target.value)} className={inputCls} placeholder="Enter your username..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase font-black tracking-wider block">MyAnimeList Username</label>
                <input type="text" value={editedMalUser} onChange={e => setEditedMalUser(e.target.value)} className={inputCls} placeholder="Your MAL username..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase font-black tracking-wider block">Profile Picture</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="text" value={editedPicture} onChange={e => setEditedPicture(e.target.value)} className={`${inputCls} flex-1`} placeholder="Paste an image URL..." />
                  <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-950 border border-zinc-800 hover:border-brand-primary/50 text-zinc-300 hover:text-white rounded-lg cursor-pointer text-[10px] font-mono font-black uppercase tracking-wider transition-all select-none shrink-0">
                    Upload
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const isPro = profile.subscriptionTier === 'pro';
                        const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
                        if (!isPro && isGif) { toast.error("Animated GIFs are a Pro Feature!"); return; }
                        if (file.size > 900 * 1024) { toast.error("File is too large! Max size is 900KB."); return; }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          if (typeof reader.result === 'string') { setEditedPicture(reader.result); toast.success("Profile picture uploaded!"); }
                        };
                        reader.readAsDataURL(file);
                      }} />
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase font-black tracking-wider block">Banner URL</label>
                <input type="text" value={editedBanner} onChange={e => setEditedBanner(e.target.value)} className={inputCls} placeholder="Paste a banner image URL..." />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[10px] text-zinc-500 font-mono uppercase font-black tracking-wider block">About Me</label>
                <textarea value={editedBio} onChange={e => setEditedBio(e.target.value)} className={`${inputCls} h-20 resize-none`} placeholder="Write a few lines about your favorite anime tracks..." />
              </div>
            </div>

            {/* Banner sync */}
            <div className="flex flex-col gap-3 p-4 bg-zinc-950 border border-zinc-900 rounded-xl">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={useFavoriteAsBanner} onChange={e => setUseFavoriteAsBanner(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-800 text-brand-primary bg-zinc-950 focus:ring-0 cursor-pointer" />
                <span className="font-mono text-[10px] font-black uppercase tracking-wider text-zinc-300">
                  Sync banner with favorite slot (Pro Feature)
                </span>
              </label>
              {useFavoriteAsBanner && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {[0, 1, 2, 3].map(idx => {
                    const song = allTracks.find(t => t.id === editedFavoriteTrackIds[idx]);
                    return (
                      <button key={idx} type="button" onClick={() => setBackdropIndex(idx)}
                        className={`p-2.5 rounded-lg border text-center font-mono text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer ${
                          backdropIndex === idx
                            ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                            : "bg-zinc-950 border-zinc-900 text-zinc-500 hover:border-zinc-800"
                        }`}>
                        Slot {idx + 1}
                        <p className="truncate text-zinc-600 normal-case font-normal mt-0.5">{song ? song.title : "Empty"}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Favorite slots */}
            <Section title="Favorite Tracks — pick your showcase">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map(slot => {
                  const track = allTracks.find(t => t.id === editedFavoriteTrackIds[slot]);
                  const editingThis = activeSlotEdit === slot;
                  return (
                    <div key={slot} className={`rounded-xl border p-2.5 transition-colors ${editingThis ? "border-brand-primary/50 bg-brand-primary/5" : "border-zinc-900 bg-zinc-950"}`}>
                      {track ? (
                        <div className="flex items-center gap-2">
                          <img src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/default.jpg`} alt=""
                            className="w-10 h-10 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" loading="lazy" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-white truncate">{track.title}</p>
                            <p className="text-[10px] text-zinc-500 truncate">{track.animeName}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-zinc-600">
                          <div className="w-10 h-10 rounded-lg border border-dashed border-zinc-800 flex items-center justify-center">
                            <Plus className="w-4 h-4" />
                          </div>
                          <p className="text-[11px] font-black uppercase tracking-widest">Empty Slot</p>
                        </div>
                      )}
                      <div className="flex gap-1.5 mt-2">
                        <button onClick={() => { setActiveSlotEdit(editingThis ? null : slot); setSlotSearchQuery(""); }}
                          className="flex-1 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors cursor-pointer">
                          {track ? "Change" : "Pick"}
                        </button>
                        {track && (
                          <button onClick={() => setSlotTrack(slot, null)} title="Clear slot"
                            className="px-2 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-600 hover:text-vermillion transition-colors cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {editingThis && (
                        <div className="mt-2 space-y-1.5">
                          <input value={slotSearchQuery} onChange={e => setSlotSearchQuery(e.target.value)}
                            placeholder="Search tracks…" autoFocus
                            className="w-full px-2.5 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] text-white placeholder:text-zinc-600 outline-none focus:border-brand-primary/50" />
                          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                            {filteredSlotTracks.slice(0, 6).map(t => (
                              <button key={t.id} onClick={() => setSlotTrack(slot, t.id)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-900 text-left transition-colors cursor-pointer">
                                <img src={t.customImageUrl || `https://img.youtube.com/vi/${t.youtubeId}/default.jpg`} alt=""
                                  className="w-7 h-7 rounded object-cover shrink-0" loading="lazy" />
                                <span className="text-[11px] text-zinc-300 truncate">{t.title}</span>
                                <span className="text-[9px] text-zinc-600 ml-auto shrink-0">{t.type}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
        ) : (
          /* ══════════ DISPLAY MODE — sidebar + content ══════════ */
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-8">

            {/* ── SIDEBAR ── */}
            <aside className="space-y-3 lg:sticky lg:top-4 self-start">
              {/* About */}
              <div className="bg-zinc-950/60 border border-zinc-900 rounded-xl p-3.5">
                <p className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-600 mb-1.5">About Me</p>
                {profile.bio?.trim() ? (
                  <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap line-clamp-6">{profile.bio}</p>
                ) : (
                  <p className="text-[11px] text-zinc-600 italic">{isOwnProfile ? "Add a bio in Edit." : "No bio yet."}</p>
                )}
              </div>

              {/* MAL */}
              {profile.malUser && (
                <div className="flex items-center gap-3 bg-zinc-950/60 border border-zinc-900 rounded-xl px-3.5 py-3">
                  <div className="w-9 h-9 rounded-lg bg-[#0a1929] border border-[#6cbbe6]/20 flex items-center justify-center shrink-0">
                    <MalIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500">MyAnimeList</p>
                    <p className="text-xs font-black text-white truncate">@{profile.malUser}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {malStats.loading ? (
                      <p className="text-[11px] font-mono text-zinc-600">…</p>
                    ) : malStats.error ? (
                      <p className="text-[11px] font-mono text-zinc-600">N/A</p>
                    ) : (
                      <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        <span className="text-white font-black">{malStats.completed ?? '—'}</span> done
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Stats rows */}
              <div className="bg-zinc-950/60 border border-zinc-900 rounded-xl overflow-hidden divide-y divide-zinc-900">
                {[
                  { label: 'Votes', value: (profile.votesCount || 0).toLocaleString() },
                  { label: 'ELO', value: (profile.elo || 1000).toLocaleString() },
                  { label: 'Playlists', value: String(customLists.length) },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{s.label}</span>
                    <span className="text-sm font-display font-black text-white tabular-nums">{s.value}</span>
                  </div>
                ))}
                <button onClick={() => setShowFollowModal('followers')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-zinc-900/60 transition-colors cursor-pointer">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Followers</span>
                  <span className="text-sm font-display font-black text-brand-primary tabular-nums">{profile.followersCount || 0}</span>
                </button>
                <button onClick={() => setShowFollowModal('following')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-zinc-900/60 transition-colors cursor-pointer">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Following</span>
                  <span className="text-sm font-display font-black text-brand-primary tabular-nums">{profile.following?.length || 0}</span>
                </button>
              </div>

              {/* Member since */}
              <p className="flex items-center gap-1.5 px-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                <Calendar className="w-3 h-3" />
                Member since {new Date(profile.createdAt || Date.now()).toLocaleDateString("en-US", { year: "numeric", month: "short" })}
              </p>
            </aside>

            {/* ── CONTENT COLUMN ── */}
            <div className="min-w-0">

              {/* Favorites */}
              <Section
                title="Favorite Tracks"
                action={topFavoriteTrack ? (
                  <button onClick={() => setShowShareTop(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors cursor-pointer">
                    <Copy className="w-3.5 h-3.5" /> Share Top
                  </button>
                ) : undefined}
              >
                {favoriteTrackIds.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {favoriteTrackIds.slice(0, 4).map(id => {
                      const t = tracksById.get(id);
                      if (!t) return null;
                      return (
                        <button key={id} onClick={() => onPlayTrack?.(t)}
                          className="group text-left rounded-xl overflow-hidden border border-zinc-900 hover:border-zinc-700 bg-zinc-950 transition-colors cursor-pointer">
                          <div className="relative h-24 overflow-hidden bg-black">
                            <img src={t.customImageUrl || `https://img.youtube.com/vi/${t.youtubeId}/mqdefault.jpg`} alt=""
                              className="w-full h-full object-cover group-hover:opacity-90 transition-all duration-300"
                              referrerPolicy="no-referrer" loading="lazy" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="w-6 h-6 text-brand-primary fill-brand-primary" />
                            </div>
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] font-black text-zinc-300 uppercase tracking-widest">{t.type}</span>
                          </div>
                          <div className="p-2.5">
                            <p className="text-[11px] font-black text-white truncate group-hover:text-brand-primary transition-colors">{t.title}</p>
                            <p className="text-[10px] text-zinc-500 truncate mt-0.5">{t.artist}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 border border-dashed border-zinc-900 rounded-xl text-center">
                    <Music className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">No favorites set</p>
                    {isOwnProfile && <p className="text-[10px] text-zinc-600 mt-1">Hit Edit to pick your showcase.</p>}
                  </div>
                )}
              </Section>

              {/* Vibe */}
              <Section title="Vibe Spectrum">
                <div className="flex flex-col items-center">
                  <svg viewBox="0 0 280 280" className="w-full max-w-[280px]">
                    {[25, 50, 75, 100].map(pct => (
                      <polygon key={pct} points={gridPolygon(pct)} fill="none" stroke="#221B13" strokeWidth="1" />
                    ))}
                    {vibeCategories.map((_, i) => {
                      const p = pointAt(i, 100, radarRadius);
                      return <line key={i} x1={radarCenter} y1={radarCenter} x2={p.x} y2={p.y} stroke="#221B13" strokeWidth="1" />;
                    })}
                    <polygon points={radarPolygon(vibe)} fill="rgba(255, 61, 46,0.15)" stroke="#FF3D2E" strokeWidth="2" />
                    {vibeCategories.map((cat, i) => {
                      const p = pointAt(i, vibe[cat.key] || 50, radarRadius);
                      const lp = pointAt(i, 100, radarRadius + 22);
                      return (
                        <g key={cat.key} onMouseEnter={() => setHoveredVibeCategory(cat.key)}
                          onMouseLeave={() => setHoveredVibeCategory(null)} className="cursor-help">
                          <circle cx={p.x} cy={p.y} r="12" fill="transparent" />
                          <circle cx={p.x} cy={p.y} r="4" fill="#FF3D2E" />
                          <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                            className={`text-[9px] font-black uppercase tracking-widest ${hoveredVibeCategory === cat.key ? 'fill-white' : 'fill-zinc-500'}`}
                            style={{ pointerEvents: 'none' }}>
                            {cat.short}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="mt-1 text-center min-h-[36px] px-4">
                    {hoveredVibeCategory ? (
                      (() => {
                        const cat = vibeCategories.find(c => c.key === hoveredVibeCategory)!;
                        return (
                          <>
                            <p className="text-[11px] font-black text-white uppercase tracking-widest">{cat.name} — {vibe[cat.key] || 50}/100</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">{cat.desc}</p>
                          </>
                        );
                      })()
                    ) : (
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Hover a point for details</p>
                    )}
                  </div>
                </div>
              </Section>

              {/* Taste Signature — derived fingerprint of the user's taste */}
              {tasteSignature && (
                <Section title="Taste Signature" action={
                  isOwnProfile ? (
                    <button onClick={() => setShowShareTop(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors cursor-pointer">
                      <Fingerprint className="w-3.5 h-3.5" /> Share
                    </button>
                  ) : undefined
                }>
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Obscurity Tier — the headline stat */}
                    <div className="col-span-2 p-3 rounded-xl bg-gradient-to-br from-zinc-950 to-zinc-900 border border-zinc-800">
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-gold-bright" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Listener Archetype</span>
                      </div>
                      <p className={`text-sm font-black ${tasteSignature.obscurityTier.color}`}>
                        {tasteSignature.obscurityTier.label}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{tasteSignature.obscurityTier.desc}</p>
                    </div>

                    {/* Top type */}
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-900">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Music className="w-3 h-3 text-gold-bright" />
                        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Top Type</span>
                      </div>
                      <p className="text-sm font-black text-white">
                        {tasteSignature.topType}
                        <span className="ml-1 text-[10px] text-zinc-500">· {tasteSignature.topTypePct}%</span>
                      </p>
                    </div>

                    {/* Divergence */}
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-900">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Swords className="w-3 h-3 text-vermillion" />
                        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Vs Consensus</span>
                      </div>
                      <p className={`text-sm font-black ${tasteSignature.divergenceTier.color}`}>
                        {tasteSignature.divergenceTier.label}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{tasteSignature.divergencePct}% diverges from community top 10</p>
                    </div>

                    {/* Top artist */}
                    {tasteSignature.topArtist && (
                      <div className="col-span-2 p-2.5 rounded-xl bg-zinc-950 border border-zinc-900">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Award className="w-3 h-3 text-gold-bright" />
                          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                            {tasteSignature.topArtistCount >= 3 ? 'Devoted To' : 'Top Artist'}
                          </span>
                        </div>
                        <p className="text-xs font-black text-white truncate">{tasteSignature.topArtist}</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          {tasteSignature.topArtistCount} track{tasteSignature.topArtistCount === 1 ? '' : 's'} in your collection
                        </p>
                      </div>
                    )}

                    {/* Anime spread */}
                    <div className="col-span-2 p-2.5 rounded-xl bg-zinc-950 border border-zinc-900">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Flame className="w-3 h-3 text-vermillion" />
                        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Anime Spread</span>
                      </div>
                      <p className="text-xs font-black text-white">
                        {tasteSignature.distinctAnime} distinct anime
                        <span className="ml-1 text-[10px] text-zinc-500">· {tasteSignature.animeSpread}% of pool</span>
                      </p>
                      <div className="mt-1.5 h-1 bg-zinc-900 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-vermillion to-gold-bright"
                          style={{ width: `${Math.min(100, tasteSignature.animeSpread)}%` }} />
                      </div>
                    </div>
                  </div>
                </Section>
              )}

              {/* Playlists */}
              <Section title="Playlists">
                {isOwnProfile && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div className="flex gap-1 p-1 bg-zinc-950 border border-zinc-900 rounded-xl">
                      {(['mine', 'community'] as const).map(v => (
                        <button key={v} onClick={() => setPlaylistView(v)}
                          className={`px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer ${
                            playlistView === v ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                          {v === 'mine' ? 'My Playlists' : 'Community'}
                        </button>
                      ))}
                    </div>
                    {playlistView === 'mine' && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setShowImportRow(p => !p)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors cursor-pointer">
                          <Download className="w-3.5 h-3.5" /> Import
                        </button>
                        <button onClick={openCreate}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-primary/15 border border-brand-primary/40 text-[10px] font-black uppercase tracking-widest text-brand-primary hover:bg-brand-primary hover:text-black transition-all cursor-pointer">
                          <Plus className="w-3.5 h-3.5" /> New
                        </button>
                      </div>
                    )}
                    {playlistView === 'community' && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                        <input value={communitySearch} onChange={e => setCommunitySearch(e.target.value)}
                          placeholder="Search playlists or creators…"
                          className="w-56 pl-8 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-white placeholder:text-zinc-600 outline-none focus:border-brand-primary/50" />
                      </div>
                    )}
                  </div>
                )}

                {/* Import row */}
                {isOwnProfile && playlistView === 'mine' && showImportRow && (
                  <div className="flex gap-2 mb-3">
                    <input value={importCodeInput} onChange={e => setImportCodeInput(e.target.value)}
                      placeholder="Paste ANISYNC-PL- share code…" className={`${inputCls} flex-1`} />
                    <button onClick={handleImportPlaylistCode}
                      className="px-4 rounded-lg bg-brand-primary text-black font-black text-[10px] uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer">
                      Import
                    </button>
                  </div>
                )}

                {/* MINE / THEIRS */}
                {(playlistView === 'mine' || !isOwnProfile) && (
                  visibleLists.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {visibleLists.map(list => {
                        const tracks = (list.trackIds || []).map(id => tracksById.get(id)).filter(Boolean) as AnimeTrack[];
                        const ids = playableIds(list.trackIds);
                        const expanded = !!expandedLists[list.id];
                        const likes = myLikeCounts[list.id] || 0;
                        const pub = isPlaylistPublic(list);
                        return (
                          <div key={list.id} className="bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-xl p-3 transition-colors">
                            <button onClick={() => setExpandedLists(p => ({ ...p, [list.id]: !p[list.id] }))}
                              className="w-full flex items-center gap-3 text-left cursor-pointer">
                              <PlaylistCover trackIds={list.trackIds || []} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-black text-white truncate flex items-center gap-1.5">
                                  {list.name}
                                  {pub ? <Globe className="w-3 h-3 text-zinc-600 shrink-0" /> : <Lock className="w-3 h-3 text-zinc-600 shrink-0" />}
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                  {tracks.length} tracks
                                  {likes > 0 && (
                                    <span className="flex items-center gap-0.5 text-vermillion/80">
                                      <Heart className="w-2.5 h-2.5 fill-vermillion/80" /> {likes}
                                    </span>
                                  )}
                                </p>
                                {list.originalCreatorName && (
                                  <p className="text-[9px] text-zinc-600 truncate mt-0.5">saved from {list.originalCreatorName}</p>
                                )}
                              </div>
                              {expanded ? <ChevronUp className="w-4 h-4 text-zinc-600 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0" />}
                            </button>

                            <div className="flex items-center gap-1.5 mt-2.5">
                              <button disabled={!tracks.length} onClick={() => onPlayPlaylist?.(tracks, 0)}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Play className="w-3 h-3" /> Play
                              </button>
                              <button disabled={ids.length < 2} onClick={() => onStartCustomArena?.(ids, list.name)}
                                title="Battle in the Arena"
                                className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-brand-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Swords className="w-3.5 h-3.5" />
                              </button>
                              <button disabled={ids.length < 2} onClick={() => onStartCustomTournament?.(ids, list.name, list.id)}
                                title="Run a tournament"
                                className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-gold-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Trophy className="w-3.5 h-3.5" />
                              </button>
                              {isOwnProfile && (
                                <>
                                  <button onClick={() => handleExportPlaylist(list.name, list.description || '', list.trackIds || [])}
                                    title="Copy share code"
                                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer">
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => openEdit(list)} title="Edit"
                                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => deleteList(list.id, list.name)} title="Delete"
                                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-vermillion transition-colors cursor-pointer">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>

                            <AnimatePresence>
                              {expanded && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden">
                                  <div className="mt-2.5 pt-2.5 border-t border-zinc-900 max-h-40 overflow-y-auto space-y-0.5">
                                    {tracks.length > 0 ? tracks.map(t => (
                                      <button key={t.id} onClick={() => onPlayTrack?.(t)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-900 text-left transition-colors cursor-pointer">
                                        <Play className="w-3 h-3 text-zinc-600 shrink-0" />
                                        <span className="text-[11px] text-zinc-300 truncate">{t.title}</span>
                                        <span className="text-[9px] text-zinc-600 ml-auto shrink-0">{t.type}</span>
                                      </button>
                                    )) : (
                                      <p className="text-[10px] text-zinc-600 text-center py-3 uppercase tracking-widest">Empty list</p>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 border border-dashed border-zinc-900 rounded-xl text-center">
                      <ListMusic className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                      <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
                        {isOwnProfile ? 'No playlists yet' : 'No public playlists'}
                      </p>
                      {isOwnProfile && (
                        <p className="text-[10px] text-zinc-600 mt-1">
                          Bookmark any track on the leaderboard to save it to a playlist, or create one here.
                        </p>
                      )}
                    </div>
                  )
                )}

                {/* COMMUNITY */}
                {isOwnProfile && playlistView === 'community' && (
                  communityFiltered.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {communityFiltered.map(cp => {
                        const tracks = (cp.trackIds || []).map(id => tracksById.get(id)).filter(Boolean) as AnimeTrack[];
                        const ids = playableIds(cp.trackIds);
                        const liked = iLike(cp.ownerId, cp.id);
                        const saved = alreadyCopied(cp);
                        return (
                          <div key={`${cp.ownerId}-${cp.id}`} className="bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-xl p-3 transition-colors">
                            <div className="flex items-center gap-3">
                              <PlaylistCover trackIds={cp.trackIds || []} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-black text-white truncate">{cp.name}</p>
                                <button onClick={() => onViewUserProfile?.(cp.ownerId)}
                                  className="text-[10px] text-zinc-500 hover:text-brand-primary transition-colors truncate flex items-center gap-1 mt-0.5 cursor-pointer"
                                  title={onViewUserProfile ? 'View creator profile' : undefined}>
                                  {cp.ownerPicture
                                    ? <img src={cp.ownerPicture} alt="" className="w-3.5 h-3.5 rounded-full object-cover" referrerPolicy="no-referrer" />
                                    : <Users className="w-3 h-3" />}
                                  by {cp.ownerName}
                                </button>
                                <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest mt-0.5">{tracks.length} tracks</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 mt-2.5">
                              <button disabled={!tracks.length} onClick={() => onPlayPlaylist?.(tracks, 0)}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Play className="w-3 h-3" /> Play
                              </button>
                              <button disabled={ids.length < 2} onClick={() => onStartCustomArena?.(ids, cp.name)}
                                title="Battle in the Arena"
                                className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-brand-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Swords className="w-3.5 h-3.5" />
                              </button>
                              <button disabled={ids.length < 2} onClick={() => onStartCustomTournament?.(ids, cp.name)}
                                title="Run a tournament"
                                className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-gold-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                                <Trophy className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => saveCommunityPlaylist(cp)} disabled={saved}
                                title={saved ? 'Already in your playlists' : 'Save a copy to your playlists'}
                                className={`p-2 rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                                  saved
                                    ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary'
                                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-gold-bright'}`}>
                                <BookmarkPlus className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => toggleLike(cp.ownerId, cp.id, cp.name)}
                                title={liked ? 'Unlike' : 'Like this playlist'}
                                className={`flex items-center gap-1 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                                  liked
                                    ? 'bg-vermillion/10 border-vermillion/30 text-vermillion'
                                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-vermillion'}`}>
                                <Heart className={`w-3.5 h-3.5 ${liked ? 'fill-vermillion' : ''}`} />
                                <span className="text-[10px] font-black tabular-nums">{cp.likeCount}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 border border-dashed border-zinc-900 rounded-xl text-center">
                      <Users className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                      <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
                        {communitySearch ? 'No playlists match your search' : 'No community playlists yet'}
                      </p>
                      {!communitySearch && (
                        <p className="text-[10px] text-zinc-600 mt-1">Set one of your playlists to public and be the first.</p>
                      )}
                    </div>
                  )
                )}
              </Section>

              {/* Collectibles */}
              {pokedexCollectibles.length > 0 && (
                <Section title="Collectibles">
                  {/* ⚠️ field names guessed — adjust to your PokedexCollectible type */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                    {pokedexCollectibles.map((c: any, i: number) => (
                      <div key={c.id || i} className="flex items-center gap-2.5 bg-zinc-950 border border-zinc-900 rounded-xl p-2.5">
                        <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                          {c.imageUrl || c.image || c.icon ? (
                            <img src={c.imageUrl || c.image || c.icon} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Trophy className="w-5 h-5 text-zinc-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-white truncate">{c.name || c.title || 'Collectible'}</p>
                          {c.rarity && <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">{c.rarity}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══════════ MODALS ══════════ */}

      {/* Playlist studio */}
      <AnimatePresence>
        {isStudioActive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setIsStudioActive(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md bg-[#0e0e11] border border-zinc-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-zinc-900">
                <h3 className="font-display font-black text-white uppercase tracking-tight text-sm">
                  {studioEditingId ? "Edit Playlist" : "New Playlist"}
                </h3>
                <button onClick={() => setIsStudioActive(false)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto">
                <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Playlist name *" className={inputCls} />
                <textarea value={newListDesc} onChange={e => setNewListDesc(e.target.value)} placeholder="Description (optional)" rows={2}
                  className={`${inputCls} resize-none`} />

                {/* Visibility */}
                <div>
                  <p className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500 mb-2">Visibility</p>
                  <div className="flex gap-2">
                    {(['public', 'private'] as const).map(v => (
                      <button key={v} onClick={() => setNewListVisibility(v)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors cursor-pointer ${
                          newListVisibility === v
                            ? 'bg-brand-primary/15 border-brand-primary/40 text-white'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {v === 'public' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} {v}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1.5">
                    Public playlists appear in the community feed and can be liked & saved by others.
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500 mb-2">
                    {newListTrackIds.length} tracks selected
                  </p>
                  <input value={listSearchQuery} onChange={e => setListSearchQuery(e.target.value)} placeholder="Search tracks…" className={`${inputCls} mb-2`} />
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                    {filteredListTracksInCreator.slice(0, 30).map(t => {
                      const picked = newListTrackIds.includes(t.id);
                      return (
                        <button key={t.id} onClick={() => setNewListTrackIds(prev => picked ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                          className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer ${picked ? 'bg-brand-primary/10' : 'hover:bg-zinc-900'}`}>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${picked ? 'bg-brand-primary border-brand-primary' : 'border-zinc-700'}`}>
                            {picked && <Check className="w-3 h-3 text-black" />}
                          </div>
                          <img src={t.customImageUrl || `https://img.youtube.com/vi/${t.youtubeId}/default.jpg`} alt=""
                            className="w-8 h-8 rounded object-cover shrink-0" loading="lazy" />
                          <div className="min-w-0">
                            <p className="text-[11px] text-white truncate">{t.title}</p>
                            <p className="text-[9px] text-zinc-500 truncate">{t.animeName} · {t.type}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button onClick={commitStudio}
                  className="w-full py-3 rounded-xl bg-brand-primary text-black text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer">
                  {studioEditingId ? "Save Changes" : "Create Playlist"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Followers / Following — ⚠️ assumes profile.followers is an ID array */}
      <AnimatePresence>
        {showFollowModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowFollowModal(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm bg-[#0e0e11] border border-zinc-800 rounded-2xl shadow-2xl max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-zinc-900">
                <h3 className="font-display font-black text-white uppercase tracking-tight text-sm">
                  {showFollowModal === 'followers' ? 'Followers' : 'Following'}
                </h3>
                <button onClick={() => setShowFollowModal(null)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 overflow-y-auto">
                {(() => {
                  const ids: string[] = showFollowModal === 'followers'
                    ? ((profile as any).followers || [])
                    : (profile.following || []);
                  if (ids.length === 0) {
                    return (
                      <div className="py-10 text-center">
                        <Users className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                        <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Nobody here yet</p>
                      </div>
                    );
                  }
                  return ids.map(id => {
                    const u = userProfiles.find(p => p.id === id);
                    return (
                      <button key={id} onClick={() => { if (onViewUserProfile && u) { onViewUserProfile(id); setShowFollowModal(null); } }}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-zinc-900/50 transition-colors text-left cursor-pointer">
                        {u?.picture ? (
                          <img src={u.picture} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white"
                            style={{ background: avatarGradient(id) }}>
                            {(u?.username || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs font-black text-zinc-200 truncate">{u?.username || 'Unknown user'}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Top — self-contained (replaces broken ShareCard mount) */}
      <AnimatePresence>
        {showShareTop && topFavoriteTrack && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowShareTop(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-sm">
              <div className="bg-[#0e0e11] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="relative h-40 bg-black">
                  <img src={topFavoriteTrack.customImageUrl || `https://img.youtube.com/vi/${topFavoriteTrack.youtubeId}/mqdefault.jpg`}
                    alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e11] via-transparent to-transparent" />
                  <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm border border-gold/30 text-[10px] font-black text-gold-bright uppercase tracking-widest">
                    ★ Top Pick
                  </span>
                </div>
                <div className="p-4 text-center">
                  <p className="font-display font-black text-white uppercase truncate">{topFavoriteTrack.title}</p>
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                    {topFavoriteTrack.artist} · {topFavoriteTrack.animeName}
                  </p>
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `My top anime track: "${topFavoriteTrack.title}" by ${topFavoriteTrack.artist} (${topFavoriteTrack.animeName} ${topFavoriteTrack.type}) — ${window.location.origin}`
                        );
                        toast.success('Copied to clipboard!');
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer">
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    <UnifiedShare
                      title={`My favorite anime track: ${topFavoriteTrack.title}`}
                      text={`"${topFavoriteTrack.title}" by ${topFavoriteTrack.artist} — ${topFavoriteTrack.animeName} ${topFavoriteTrack.type}`}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⚠️ verify SubscriptionModal props */}
      <SubscriptionModal isOpen={showProModal} onClose={() => setShowProModal(false)} />
    </div>
  );
}