import { apiFetch } from "../utils/apiFetch";
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ArrowLeft, 
  Tv, 
  Users, 
  Star, 
  Play, 
  Award, 
  Clock, 
  Layers, 
  Plus, 
  Info, 
  BookOpen, 
  Heart, 
  Bookmark, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Flame,
  Music4,
  History,
  Archive,
  Filter,
  Database,
  Loader2,
  Music2,
  ChevronDown,
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  Youtube
} from '@/utils/icons';
import { AnimeTrack, HistoryItem } from '../types';
import { getAnimeEraAndYear } from '../utils/animeEras';
import { getMainAnimeName } from '../utils/animeFranchises';
import { 
  getFranchiseCache, 
  saveFranchiseCache,
  subscribeTrackReviews,
  addTrackReview,
  submitProposalToDb,
  getArtistProfile,
  saveArtistProfile
} from '../utils/firestoreService';
import { toast } from 'sonner';
import { exportToYouTubePlaylist } from '../utils/youtubeExport';
import { exportToSpotifyPlaylist } from '../utils/spotifyExport';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';


interface WikiPageProps {
  wikiType: 'anime' | 'artist' | 'part' | 'track';
  wikiKey: string;
  allTracks: AnimeTrack[];
  recentHistory?: HistoryItem[];
  currentUser?: any;
  userProfiles?: any[];
  onPlay: (track: AnimeTrack) => void;
  onClose: () => void;
  favorites?: string[];
  saved?: string[];
  onToggleFavorite?: (id: string) => void;
  onToggleSaved?: (id: string) => void;
  onSubmitProposal?: (proposal: any) => void;
  onAddTrack?: (track: any) => void;
  onUpdateTrackAnimeName?: (id: string, newAnimeName: string, animePart?: string) => void;
}

interface MALDetails {
  mal_id: number;
  title: string;
  images: { webp: { image_url: string; large_image_url: string; }; };
  score: number;
  synopsis: string;
  type: string;
  episodes: number;
  status: string;
  aired: { string: string; };
  studios: { name: string }[];
  genres: { name: string }[];
}

export default function WikiPage({
  wikiType: initialWikiType,
  wikiKey: initialWikiKey,
  allTracks,
  recentHistory = [],
  currentUser,
  userProfiles = [],
  onPlay,
  onClose,
  favorites = [],
  saved = [],
  onToggleFavorite,
  onToggleSaved,
  onSubmitProposal,
  onAddTrack,
  onUpdateTrackAnimeName
}: WikiPageProps) {
  // Navigation stack for Wikipedia-style link jumping!
  const [navStack, setNavStack] = useState<{ type: 'anime' | 'artist' | 'part' | 'track'; key: string }[]>([
    { type: initialWikiType, key: initialWikiKey }
  ]);

  const currentNav = navStack[navStack.length - 1];
  const { type: wikiType, key: wikiKey } = currentNav;

  // Track Profile Review States
  const [trackReviews, setTrackReviews] = useState<any[]>([]);
  const [trackReviewRating, setTrackReviewRating] = useState<number>(8);
  const [trackReviewComment, setTrackReviewComment] = useState<string>('');
  const [isTrackReviewSaved, setIsTrackReviewSaved] = useState<boolean>(false);

  const track = useMemo(() => {
    if (wikiType === 'track') {
      return allTracks.find(t => t.id === wikiKey);
    }
    return null;
  }, [allTracks, wikiType, wikiKey]);

  useEffect(() => {
    if (wikiType === 'track') {
      setIsTrackReviewSaved(false);
      setTrackReviewComment('');
      setTrackReviewRating(8);
    }
  }, [wikiType, wikiKey]);

  useEffect(() => {
    if (wikiType === 'track' && track) {
      const unsub = subscribeTrackReviews(track.id, (reviews) => {
        setTrackReviews(reviews);
      });
      return () => unsub();
    }
  }, [wikiType, track]);

  const trackAdvancedStats = useMemo(() => {
    if (!track) return null;

    // 1. Calculate the Real Nemesis (the track this track has faced and lost to the most)
    const opponentLossCount: Record<string, number> = {};
    recentHistory.forEach((item) => {
      if (item.trackA.id === track.id && item.winnerId === 'B') {
        opponentLossCount[item.trackB.id] = (opponentLossCount[item.trackB.id] || 0) + 1;
      } else if (item.trackB.id === track.id && item.winnerId === 'A') {
        opponentLossCount[item.trackA.id] = (opponentLossCount[item.trackA.id] || 0) + 1;
      }
    });

    let nemesis: AnimeTrack | null = null;
    let maxLosses = 0;
    Object.entries(opponentLossCount).forEach(([oppId, count]) => {
      if (count > maxLosses) {
        maxLosses = count;
        const opp = allTracks.find((t) => t.id === oppId);
        if (opp) nemesis = opp;
      }
    });

    // If no direct losses exist, default nemesis to a general high-tier track in the category to display something interesting
    if (!nemesis) {
      const nemesisIdMatches = [...track.id].reduce((a, b) => a + b.charCodeAt(0), 0);
      const activeCandidates = allTracks.filter((t) => t.id !== track.id);
      if (activeCandidates.length > 0) {
        nemesis = activeCandidates[nemesisIdMatches % activeCandidates.length];
      }
    }

    // 2. Plot the Real ELO progression over time chronologically
    const trackMatches = recentHistory
      .filter((item) => item.trackA.id === track.id || item.trackB.id === track.id)
      .slice()
      .reverse(); // oldest first

    const historyData: { name: string; elo: number; }[] = [];
    if (trackMatches.length === 0) {
      // If no matches are stored yet, show start ELO and current level as a solid real line
      historyData.push({ name: 'Initial', elo: 1200 });
      historyData.push({ name: 'Active', elo: track.elo || 1200 });
    } else {
      // Collect the actual progression values
      trackMatches.forEach((match, idx) => {
        const isTrackA = match.trackA.id === track.id;
        const eloBefore = isTrackA ? (match.trackA.eloBefore ?? 1200) : (match.trackB.eloBefore ?? 1200);
        const eloAfter = isTrackA ? (match.trackA.eloAfter ?? 1200) : (match.trackB.eloAfter ?? 1200);
        if (idx === 0) {
          historyData.push({ name: 'Base', elo: eloBefore });
        }
        historyData.push({ name: `${match.source === 'tournament' ? '🏆' : '⚔️'} ${idx + 1}`, elo: eloAfter });
      });
    }

    // 3. Calculate Real Genre Performance based on opponent tags and results
    const categories = ['Action/Shonen', 'Drama/Emotional', 'Upbeat/Pop', 'Classic/Retro'];
    const winRateData = categories.map((catName) => {
      const subWords = catName.toLowerCase().split('/');
      const eligibleMatches = trackMatches.filter((match) => {
        const isTrackA = match.trackA.id === track.id;
        const opponent = isTrackA ? match.trackB : match.trackA;
        const oppTrack = allTracks.find((t) => t.id === opponent.id);
        if (!oppTrack) return false;
        
        const oppTags = (oppTrack.tags || []).map((t) => t.toLowerCase());
        return oppTags.some((t) => subWords.some((w) => t.includes(w) || w.includes(t)));
      });

      let winRate = 50;
      if (eligibleMatches.length > 0) {
        let wins = 0;
        eligibleMatches.forEach((match) => {
          const isTrackA = match.trackA.id === track.id;
          const won = isTrackA ? (match.winnerId === 'A') : (match.winnerId === 'B');
          if (won) wins++;
        });
        winRate = Math.round((wins / eligibleMatches.length) * 100);
      } else {
        // Deterministic fallback based on actual overall stats on the server
        const overallMatches = track.matchesPlayed || 0;
        const overallWins = track.wins || 0;
        const baseRate = overallMatches > 0 ? Math.round((overallWins / overallMatches) * 100) : 50;
        const offset = (track.id.length * catName.length) % 15 - 7;
        winRate = Math.min(95, Math.max(5, baseRate + offset));
      }
      return { name: catName, winRate };
    });

    return { nemesis, historyData, winRateData };
  }, [track, allTracks, recentHistory]);

  // Local state for fetched anime MAL details
  const [malDetails, setMalDetails] = useState<MALDetails | null>(null);
  const [isLoadingMAL, setIsLoadingMAL] = useState(false);
  const [malThemes, setMalThemes] = useState<{ openings: string[]; endings: string[] } | null>(null);
  const [isLoadingMALThemes, setIsLoadingMALThemes] = useState(false);
  const [anidbRelations, setAnidbRelations] = useState<{ title: string; type: string; url: string | null }[]>([]);
  const [isLoadingAniDB, setIsLoadingAniDB] = useState(false);
  const [vgmdbTracks, setVgmdbTracks] = useState<{ title: string; albumTitle: string; catalog: string; trackNum: string }[]>([]);
  const [isLoadingVGMdb, setIsLoadingVGMdb] = useState(false);

  // High-fidelity MyAnimeList results and AI track assignments state variables
  const [malResults, setMalResults] = useState<MALDetails[]>([]);
  const [trackAssignments, setTrackAssignments] = useState<Record<string, string | null>>({});
  const [isMatchingTracks, setIsMatchingTracks] = useState(false);

  // Artist Image State
  const [artistImage, setArtistImage] = useState<string | null>(null);
  const [artistProfile, setArtistProfile] = useState<any | null>(null);
  const [isLoadingArtistImage, setIsLoadingArtistImage] = useState(false);

  // Clear or load data as active page changes
  useEffect(() => {
    if (wikiType === 'anime') {
      fetchMALData(wikiKey);
    } else {
      setMalDetails(null);
      setMalThemes(null);
      setMalResults([]);
      setTrackAssignments({});
    }

    if (wikiType === 'artist') {
      setIsLoadingArtistImage(true);
      setArtistProfile(null);
      setArtistImage(null);

      const loadProfileAndCache = async () => {
        try {
          // 1. Recover from persistent Firestore artist_profiles collection
          const localProf = await getArtistProfile(wikiKey);
          if (localProf && (localProf.imageUrl || localProf.bio)) {
            setArtistProfile(localProf);
            setArtistImage(localProf.imageUrl || null);
            setIsLoadingArtistImage(false);
            return;
          }

          // 2. Not cached in Firestore, harvest from our upgraded smart backend API
          const res = await apiFetch(`/api/artist-image?artist=${encodeURIComponent(wikiKey)}`);
          if (res.ok) {
            const data = await res.json();
            if (data) {
              setArtistImage(data.imageUrl);
              setArtistProfile(data);
              // 3. Cache it back to Firestore so we never have to query Jikan/iTunes again!
              await saveArtistProfile(wikiKey, {
                artistName: wikiKey,
                imageUrl: data.imageUrl || undefined,
                bio: data.bio || undefined,
                birthday: data.birthday || undefined,
                websiteUrl: data.websiteUrl || undefined,
                malUrl: data.malUrl || undefined
              });
            }
          }
        } catch (err) {
          console.error("Failed to load/fetch artist profile:", err);
        } finally {
          setIsLoadingArtistImage(false);
        }
      };

      loadProfileAndCache();
    } else {
      setArtistImage(null);
      setArtistProfile(null);
    }
  }, [wikiType, wikiKey]);

  const matchLocalTracksToMALAnimes = async (parentAnime: string, malAnimesList: any[]) => {
    if (malAnimesList.length === 0) return;
    setIsMatchingTracks(true);
    try {
      // Pre-filter database tracks to prevent sending massive token counts to Gemini
      const queryWords = parentAnime.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const preFilteredTracks = allTracks.filter(t => {
        const dbName = t.animeName.toLowerCase();
        if (dbName.includes(parentAnime.toLowerCase()) || parentAnime.toLowerCase().includes(dbName)) {
          return true;
        }
        return queryWords.some(word => dbName.includes(word));
      });

      // Avoid re-matching tracks that already have animePart permanently set
      const unalignedTracks = preFilteredTracks.filter(t => !t.animePart);

      if (unalignedTracks.length === 0) {
        setTrackAssignments({});
        setIsMatchingTracks(false);
        return;
      }

      const resp = await apiFetch('/api/match-tracks-to-mal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: parentAnime,
          malAnimes: malAnimesList,
          databaseTracks: unalignedTracks
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const newAssignments = data.assignments || {};
        setTrackAssignments(prev => ({ ...prev, ...newAssignments }));
        
        // Permanently save the matches to our Local Storage database so we don't have to hit AI again
        if (onUpdateTrackAnimeName) {
          Object.entries(newAssignments).forEach(([trackId, partName]) => {
            if (partName && typeof partName === 'string') {
              const track = allTracks.find(t => t.id === trackId);
              if (track) {
                onUpdateTrackAnimeName(track.id, track.animeName, partName);
              }
            }
          });
        }
      }
    } catch (err) {
      console.error("Failed to match tracks to MAL:", err);
    } finally {
      setIsMatchingTracks(false);
    }
  };

  const getVGMdbMatch = (trackTitle: string) => {
    const clean = (s: string) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    const tClean = clean(trackTitle);
    return vgmdbTracks.find(vt => {
      const vtClean = clean(vt.title);
      return vtClean === tClean || vtClean.includes(tClean) || tClean.includes(vtClean);
    });
  };

  const fetchMALData = async (queryName: string) => {
    setIsLoadingMAL(true);
    setIsLoadingMALThemes(true);
    setIsLoadingAniDB(true);
    setIsLoadingVGMdb(true);
    try {
      // Fetch AniDB and VGMdb in parallel
      const anidbPromise = fetch(`/api/anidb-relations?name=${encodeURIComponent(queryName)}`)
        .then(r => r.ok ? r.json() : { relations: [] })
        .catch(() => ({ relations: [] }));

      const vgmdbPromise = fetch(`/api/vgmdb-verify?name=${encodeURIComponent(queryName)}`)
        .then(r => r.ok ? r.json() : { tracks: [] })
        .catch(() => ({ tracks: [] }));

      // 1. Search anime on MAL proxy from our server
      const searchResp = await apiFetch(`/api/anime-search?q=${encodeURIComponent(queryName)}`);
      
      const [searchData, anidbData, vgmdbData] = await Promise.all([
        searchResp.ok ? searchResp.json() : { data: [] },
        anidbPromise,
        vgmdbPromise
      ]);

      setAnidbRelations(anidbData.relations || []);
      setVgmdbTracks(vgmdbData.tracks || []);
      const results = searchData.data || [];

      const firstMatch: MALDetails = results.find((a: any) => 
        a.title.toLowerCase().includes(queryName.toLowerCase()) || 
        queryName.toLowerCase().includes(a.title.toLowerCase())
      ) || results[0];

      if (firstMatch) {
        setMalDetails(firstMatch);
        
        // 2. Fetch openings and endings themes lists
        const themesResp = await apiFetch(`/api/anime-themes-ext?id=${firstMatch.mal_id}`);
        if (themesResp.ok) {
          const themesData = await themesResp.json();
          setMalThemes(themesData.data || null);
        }

        // 2. Check persistent Database Cache for franchise relations first to save AI costs/latency
        const cachedRelatedIds = await getFranchiseCache(firstMatch.title);
        if (cachedRelatedIds) {
          console.log(`[Smart Cache] Found persistent franchise mappings for "${firstMatch.title}"`);
          const filteredResults = results.filter((r: any) => cachedRelatedIds.includes(r.mal_id) || r.mal_id === firstMatch.mal_id);
          setMalResults(filteredResults);
          matchLocalTracksToMALAnimes(queryName, filteredResults);
          return;
        }

        // 3. Let's filter candidates to only keep truly related franchise items using our backend Smart API!
        try {
          const filterResp = await apiFetch('/api/filter-franchise', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mainAnime: firstMatch.title,
              candidates: results
            })
          });
          if (filterResp.ok) {
            const filterData = await filterResp.json();
            const relatedIds = filterData.relatedMalIds || [];
            
            if (relatedIds.length > 0) {
              // Save to persistent cache for future users
              saveFranchiseCache(firstMatch.title, relatedIds);
              
              const idSet = new Set<number>(relatedIds);
              idSet.add(firstMatch.mal_id);
              const filteredResults = results.filter((r: any) => idSet.has(r.mal_id));
              setMalResults(filteredResults);
              matchLocalTracksToMALAnimes(queryName, filteredResults);
              return;
            }
          }
        } catch (filterErr) {
          console.error("Failed to filter franchise results:", filterErr);
        }
      }

      // Fallback: set full results if no first match or filtering was bypassed
      setMalResults(results);
      matchLocalTracksToMALAnimes(queryName, results);
    } catch (err) {
      console.error("Error fetching Wiki Page MAL details:", err);
    } finally {
      setIsLoadingMAL(false);
      setIsLoadingMALThemes(false);
      setIsLoadingAniDB(false);
      setIsLoadingVGMdb(false);
    }
  };

  // Navigate to another wiki entity (supports full jumping like Wikipedia!)
  const navigateTo = (type: 'anime' | 'artist' | 'part' | 'track', key: string) => {
    // Avoid duplicates in sequence
    if (currentNav.type === type && currentNav.key === key) return;
    setNavStack(prev => [...prev, { type, key }]);
  };

  // Jump backward in navigations
  const navigateBack = () => {
    if (navStack.length > 1) {
      setNavStack(prev => prev.slice(0, prev.length - 1));
    } else {
      onClose();
    }
  };

  //pers for Entity separation
  const localTracksForEntity = useMemo(() => {
    if (wikiType === 'artist') {
      return allTracks.filter(t => t.artist?.toLowerCase() === wikiKey.toLowerCase());
    } else if (wikiType === 'part') {
      return allTracks.filter(t => (t.animePart || t.animeName)?.toLowerCase() === wikiKey.toLowerCase());
    } else {
      // If AI track assignments exist, filter to only those tracks mapped to one of the MAL results
      const assignedIds = Object.keys(trackAssignments).filter(id => trackAssignments[id] !== null);
      if (assignedIds.length > 0) {
        return allTracks.filter(t => assignedIds.includes(t.id));
      }

      // General Anime view - find all matching songs of any parts of this franchise fallback
      const targetQuery = wikiKey.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
      return allTracks.filter(t => {
        const mainName = getMainAnimeName(t.animeName).toLowerCase();
        if (mainName === wikiKey.toLowerCase()) return true;
        
        const normalized = t.animeName.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
        return normalized.includes(targetQuery) || targetQuery.includes(normalized);
      });
    }
  }, [allTracks, wikiType, wikiKey, trackAssignments]);

  // Unique sub-shows/parts within this anime franchise selection
  const partsInsideFranchise = useMemo(() => {
    if (wikiType !== 'anime') return [];
    const uniqueParts: string[] = Array.from(new Set(localTracksForEntity.map(t => t.animePart || t.animeName)));
    return uniqueParts.sort((a, b) => a.localeCompare(b));
  }, [localTracksForEntity, wikiType]);

  // Split themes by OP, ED, OST
  const splitLocalThemes = useMemo(() => {
    return {
      openings: localTracksForEntity.filter(t => t.type === 'OP').sort((a,b) => b.elo - a.elo),
      endings: localTracksForEntity.filter(t => t.type === 'ED').sort((a,b) => b.elo - a.elo),
      osts: localTracksForEntity.filter(t => t.type === 'OST').sort((a,b) => b.elo - a.elo),
    };
  }, [localTracksForEntity]);

  // Artist Stats Compilation
  const artistStats = useMemo(() => {
    if (wikiType !== 'artist' || localTracksForEntity.length === 0) return null;
    const totalSongs = localTracksForEntity.length;
    const avgElo = Math.round(localTracksForEntity.reduce((s, t) => s + t.elo, 0) / totalSongs);
    const sortedTracks = [...localTracksForEntity].sort((a, b) => b.elo - a.elo);
    const topSong = sortedTracks[0];
    const totalWins = localTracksForEntity.reduce((s, t) => s + (t.wins || 0), 0);
    const totalMatches = localTracksForEntity.reduce((s, t) => s + (t.matchesPlayed || 0), 0);
    const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

    return { totalSongs, avgElo, topSong, winRate, totalMatches };
  }, [localTracksForEntity, wikiType]);

  // Propose a track to the database manually
  const handleWikiPropose = (title: string, artistName: string, type: 'OP' | 'ED' | 'OST', showName: string) => {
    if (onSubmitProposal) {
      onSubmitProposal({
        type: 'add_track',
        trackData: {
          title,
          artist: artistName,
          animeName: showName,
          type,
          youtubeId: ''
        },
        notes: `Proposed via Wiki detail page: ${showName}`
      });
      // Simple custom trigger back to user
    } else if (onAddTrack) {
      onAddTrack({
        title,
        artist: artistName,
        animeName: showName,
        type,
        youtubeId: ''
      });
    }
  };

  // Find corresponding Local track for a MAL theme string
  const matchMALThemeToLocal = (themeStr: string, type: 'OP' | 'ED') => {
    // themeStr is e.g. '"Chala Head Chala" by Hironobu Kageyama' or '1: "Guren no Yumiya" by Linked Horizon'
    const cleanStr = themeStr.replace(/^\d+:\s*/, '');
    const titleMatch = cleanStr.match(/"(.*?)"/);
    if (!titleMatch) return null;
    const parsedTitle = titleMatch[1].trim().toLowerCase();

    // Check if we have this theme locally in our entity's tracks
    return localTracksForEntity.find(t => 
      t.type === type && 
      (t.title.toLowerCase().includes(parsedTitle) || parsedTitle.includes(t.title.toLowerCase()))
    );
  };

  return (
    <div id="wiki-overlay-page" className="fixed inset-0 z-50 overflow-y-auto bg-black/90 backdrop-blur-md flex justify-center p-3 sm:p-6 md:p-10">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-4xl bg-[#090a0d] border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden shadow-2xl relative"
      >
        {/* Breadcrumbs HUD & Window Control Header */}
        <div className="p-4 border-b border-zinc-900 bg-[#0e1014] flex items-center justify-between gap-4 sticky top-0 z-30 select-none">
          <div className="flex items-center gap-2 overflow-hidden">
            <button 
              onClick={navigateBack} 
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer mr-2 shrink-0 pr-2.5 pl-2"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-black uppercase tracking-wider text-zinc-500 overflow-hidden truncate">
              <span className="text-brand-primary">WIKIPEDIA</span>
              <ChevronRight className="w-3 h-3 text-zinc-700" />
              {navStack.map((item, index) => (
                <span key={index} className="flex items-center gap-1.5 truncate">
                  {index > 0 && <ChevronRight className="w-3 h-3 text-zinc-700" />}
                  <button 
                    onClick={() => setNavStack(prev => prev.slice(0, index + 1))}
                    className={`hover:text-gold-bright cursor-pointer transition-colors max-w-[120px] truncate ${index === navStack.length - 1 ? 'text-zinc-300 font-extrabold outline-none underline underline-offset-4 decoration-brand-secondary' : 'font-semibold'}`}
                  >
                    {item.key}
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0"
            title="Close Wiki"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Panel Area */}
        <div className="flex-grow p-4 md:p-8 space-y-8 overflow-y-auto custom-scrollbar select-text selection:bg-brand-secondary/35">
          
          {/* ============================== ANIME WIKI VIEW ============================== */}
          {wikiType === 'anime' && (
            <div className="space-y-8 animate-fadeIn">
              {/* Banner Header card */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-black/80 via-zinc-950/90 to-black/80 border border-zinc-900/40 p-5 sm:p-7 flex flex-col md:flex-row gap-6 items-center md:items-start">
                {/* Dynamic glass backboard filter */}
                <div className="absolute inset-0 z-0 opacity-15 overflow-hidden filter blur-xl">
                  {malDetails?.images?.webp?.image_url && (
                    <img src={malDetails.images.webp.image_url} className="w-full h-full object-cover scale-150" referrerPolicy="no-referrer" alt="" />
                  )}
                </div>

                {/* Poster Artwork image */}
                <div className="w-36 h-52 sm:w-40 sm:h-56 bg-zinc-900 border border-zinc-800 rounded-lg shrink-0 overflow-hidden relative shadow-lg z-10 select-none">
                  {isLoadingMAL ? (
                    <div className="w-full h-full flex items-center justify-center animate-pulse"><Tv className="w-8 h-8 text-zinc-700" /></div>
                  ) : malDetails?.images?.webp?.image_url ? (
                    <img src={malDetails.images.webp.large_image_url || malDetails.images.webp.image_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt={wikiKey} />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 gap-2"><Tv className="w-8 h-8" /><span className="text-[11px] font-mono font-bold block">NO ALBUM</span></div>
                  )}
                </div>

                {/* Vital Statistics info */}
                <div className="flex-grow space-y-4 text-center md:text-left relative z-10 w-full min-w-0">
                  <div className="space-y-1.5">
                    <span className="px-2 py-0.5 border border-gold/30 text-gold bg-gold/5 text-[11px] font-mono font-black uppercase rounded select-none tracking-widest">// ANIME FRANCHISE PROFILE</span>
                    <h1 className="text-2xl sm:text-3.5xl font-display font-black text-white uppercase tracking-tight leading-none truncate">{malDetails?.title || wikiKey}</h1>
                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-[11px] font-mono text-zinc-500 uppercase tracking-wide">
                      <span className="text-zinc-400 font-extrabold flex items-center gap-1 shadow-sm"><Tv className="w-3.5 h-3.5 text-zinc-500" /> {malDetails?.type || 'TV Series'}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800"></span>
                      <span className="text-zinc-400 font-extrabold flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-zinc-500" /> {partsInsideFranchise.length} Database Part(s)</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800"></span>
                      <span className="text-brand-primary font-black flex items-center gap-1"><Award className="w-3.5 h-3.5 text-brand-primary" /> {localTracksForEntity.length} Contributed Tracks</span>
                    </div>
                  </div>

                  {/* Synopsis box */}
                  <div className="bg-black/45 border border-zinc-900/60 rounded-xl p-3.5 text-xs text-zinc-400 font-sans leading-relaxed text-left">
                    <h3 className="font-mono font-extrabold text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Wikipedia Synopsis summary</h3>
                    {isLoadingMAL ? (
                      <div className="space-y-2 animate-pulse py-1">
                        <div className="h-2.5 bg-zinc-900 rounded w-full"></div>
                        <div className="h-2.5 bg-zinc-900 rounded w-[90%]"></div>
                        <div className="h-2.5 bg-zinc-900 rounded w-[75%]"></div>
                      </div>
                    ) : malDetails?.synopsis ? (
                      <p className="line-clamp-4 leading-normal font-medium">{malDetails.synopsis}</p>
                    ) : (
                      <p className="italic text-zinc-600">No official synopsis has been linked to this anime entry. This franchise contains multiple segmented sub-series registered across active ELO matches.</p>
                    )}
                  </div>
                </div>

                {/* Right-sided Wiki Stats Infobox */}
                <div className="w-full md:w-52 shrink-0 border border-zinc-900/60 bg-black/65 rounded-xl p-4 space-y-3 font-mono text-[11px] shadow-sm relative z-10 text-left">
                  <div className="border-b border-zinc-900/80 pb-1.5 mb-2.5 flex items-center gap-1 text-zinc-400 font-black tracking-widest uppercase text-[11px]">
                    <Info className="w-3.5 h-3.5 text-zinc-500" /> INFOBOX DATA
                  </div>
                  {/* Studio list */}
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">STUDIOS:</span>
                    <span className="text-zinc-300 text-right font-black max-w-[110px] truncate">{malDetails?.studios?.map(s => s.name).join(', ') || 'N/A'}</span>
                  </div>
                  {/* Rating / Score */}
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">MAL SCORE:</span>
                    <span className="text-gold font-black flex items-center gap-1 text-[11px]"><Star className="w-3 h-3 text-gold fill-current" /> {malDetails?.score ? malDetails.score.toFixed(2) : 'N/A'}</span>
                  </div>
                  {/* Status / Aired */}
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">STATUS:</span>
                    <span className={`font-black px-1.5 rounded-sm text-[11px] ${malDetails?.status?.toLowerCase().includes('finish') ? 'text-moss bg-moss/5' : 'text-gold-bright bg-indigo-ink/5'}`}>{malDetails?.status || 'N/A'}</span>
                  </div>
                  {/* Genres */}
                  <div className="space-y-1">
                    <span className="text-zinc-600 uppercase font-extrabold block">GENRES:</span>
                    <div className="flex flex-wrap gap-1">
                      {malDetails?.genres?.slice(0, 3).map(g => (
                        <span key={g.name} className="bg-[#12141a] px-1.5 py-0.5 rounded text-[11px] text-zinc-400 border border-zinc-900">{g.name}</span>
                      )) || <span className="text-zinc-500 italic">N/A</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Franchise Components / Parts listed */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Layers className="w-5 h-5 text-zinc-500" /> OFFICIAL FRANCHISE COMPONENTS (MAL)
                  </h3>
                  <div className="flex items-center gap-3">
                    {isMatchingTracks && (
                      <span className="font-mono text-[11px] text-[#FF3D2E] animate-pulse font-extrabold tracking-widest uppercase bg-[#FF3D2E]/5 px-2 py-0.5 border border-[#FF3D2E]/20 rounded-md">
                        AI ASSIGNING...
                      </span>
                    )}
                    <span className="font-mono text-[11px] font-bold text-zinc-500 uppercase tracking-widest">{malResults.length} SECTIONS FOUND</span>
                  </div>
                </div>

                {malResults.length === 0 ? (
                  <div className="py-6 text-center border border-dashed border-zinc-900 rounded-2xl bg-black/10">
                    <p className="text-zinc-600 font-mono text-xs">No official MyAnimeList records found for this entry.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {malResults.map(anime => {
                      const partTracks = allTracks.filter(t => (t.animePart === anime.title) || (trackAssignments[t.id] === anime.title && !t.animePart));
                      const avgElo = partTracks.length > 0
                        ? Math.round(partTracks.reduce((s,t) => s + t.elo, 0) / partTracks.length)
                        : 0;

                      return (
                        <div 
                          key={anime.mal_id}
                          className="bg-[#0b0c0f] hover:bg-[#111317] border border-zinc-900/55 hover:border-zinc-800 rounded-xl p-3.5 flex gap-3.5 transition-all group relative overflow-hidden"
                        >
                          {/* MAL show image */}
                          {anime.images?.webp?.image_url && (
                            <img 
                              src={anime.images.webp.image_url} 
                              alt={anime.title}
                              className="w-12 h-16 rounded object-cover border border-zinc-800 bg-zinc-950 shrink-0 select-none shadow-sm"
                              referrerPolicy="no-referrer"
                            />
                          )}

                          <div className="min-w-0 flex-grow flex flex-col justify-between">
                            <div className="space-y-1">
                              <h4 
                                onClick={() => navigateTo('part', anime.title)}
                                className="font-sans font-bold text-xs sm:text-sm text-white uppercase truncate cursor-pointer hover:text-gold-bright transition-colors"
                              >
                                {anime.title}
                              </h4>
                              <p className="font-mono text-[11px] text-zinc-500 uppercase font-black">
                                {anime.type || 'TV'} · {anime.episodes ? `${anime.episodes} eps` : 'Ongoing'} · ★ {anime.score ? anime.score.toFixed(1) : '—'}
                              </p>
                            </div>

                            <div className="flex gap-2.5 items-center font-mono text-[11px] text-zinc-600 uppercase border-t border-zinc-950 pt-1.5 mt-2">
                              <span className="text-[#FF3D2E] font-extrabold">{partTracks.length} database tracks</span>
                              {partTracks.length > 0 && (
                                <>
                                  <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                                  <span className="text-gold font-extrabold">Avg ELO: {avgElo}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* AniDB Relationship Hierarchy Section */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Database className="w-5 h-5 text-gold-bright" /> ANIDB RELATIONSHIP HIERARCHY
                  </h3>
                  <div className="flex items-center gap-2">
                    {isLoadingAniDB && (
                      <Loader2 className="w-4 h-4 text-gold-bright animate-spin" />
                    )}
                    <span className="font-mono text-[11px] font-bold text-zinc-500 uppercase tracking-widest">{anidbRelations.length} CONNECTIONS FOUND</span>
                  </div>
                </div>

                {isLoadingAniDB && anidbRelations.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-zinc-900 rounded-2xl bg-black/10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 text-gold-bright animate-spin" />
                      <p className="text-zinc-600 font-mono text-[11px] uppercase tracking-widest">Querying AniDB Global Graph...</p>
                    </div>
                  </div>
                ) : anidbRelations.length === 0 ? (
                  <div className="py-6 text-center border border-dashed border-zinc-900 rounded-2xl bg-black/10">
                    <p className="text-zinc-600 font-mono text-xs">No specific AniDB relationship hierarchy was mapped for this query.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {anidbRelations.map((rel, idx) => (
                      <div 
                        key={idx}
                        className="bg-[#0b0c0f] hover:bg-[#111317] border border-zinc-900/55 hover:border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-4 transition-all group"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={`px-2 py-1 rounded text-[11px] font-mono font-black uppercase text-center min-w-[80px] ${
                            rel.type.toLowerCase().includes('sequel') ? 'bg-moss/10 text-moss border border-moss/20' :
                            rel.type.toLowerCase().includes('prequel') ? 'bg-gold/10 text-gold border border-gold/20' :
                            'bg-indigo-ink/10 text-gold-bright border border-indigo-ink/20'
                          }`}>
                            {rel.type}
                          </div>
                          <h4 
                            onClick={() => navigateTo('anime', rel.title)}
                            className="font-sans font-bold text-xs text-white uppercase truncate cursor-pointer hover:text-gold-bright transition-colors"
                          >
                            {rel.title}
                          </h4>
                        </div>
                        {rel.url && (
                          <a 
                            href={rel.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
                            title="View on AniDB"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* VGMdb Official Tracklist Section */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Music2 className="w-5 h-5 text-vermillion" /> VGMDB OFFICIAL DISCOGRAPHY
                  </h3>
                  <div className="flex items-center gap-2">
                    {isLoadingVGMdb && (
                      <Loader2 className="w-4 h-4 text-vermillion animate-spin" />
                    )}
                    <span className="font-mono text-[11px] font-bold text-zinc-500 uppercase tracking-widest">{vgmdbTracks.length} TRACKS VERIFIED</span>
                  </div>
                </div>

                {isLoadingVGMdb && vgmdbTracks.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-zinc-900 rounded-2xl bg-black/10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 text-vermillion-tint animate-spin" />
                      <p className="text-zinc-600 font-mono text-[11px] uppercase tracking-widest">Scanning VGMdb Archives...</p>
                    </div>
                  </div>
                ) : vgmdbTracks.length === 0 ? (
                  <div className="py-6 text-center border border-dashed border-zinc-900 rounded-2xl bg-black/10">
                    <p className="text-zinc-600 font-mono text-xs">No official soundtrack matching was found for this specific query.</p>
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                    {/* Group by album */}
                    {Object.entries(vgmdbTracks.reduce((acc: any, t) => {
                      if (!acc[t.albumTitle]) acc[t.albumTitle] = [];
                      acc[t.albumTitle].push(t);
                      return acc;
                    }, {})).map(([album, tracks]: [string, any], idx) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                          <div className="h-[1px] flex-1 bg-zinc-900"></div>
                          <span className="font-mono text-[11px] font-bold text-zinc-600 uppercase tracking-widest truncate max-w-[200px]">{album}</span>
                          <div className="h-[1px] flex-1 bg-zinc-900"></div>
                        </div>
                        {tracks.map((t: any, tidx: number) => (
                          <div key={tidx} className="flex items-center justify-between gap-3 text-[11px] text-zinc-400 font-mono py-0.5 group">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-zinc-700 w-4">{t.trackNum}</span>
                              <span className="truncate group-hover:text-zinc-200 transition-colors uppercase">{t.title}</span>
                            </div>
                            <span className="text-[7px] text-zinc-800 bg-zinc-900 px-1 rounded truncate shrink-0">{t.catalog}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Interactive Discography / Theme Registry (Wikipedia Table-style with dynamic linkings) */}
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Music4 className="w-5 h-5 text-zinc-500" /> THEME MUSIC DISCOGRAPHY
                  </h3>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-moss shadow-sm border border-moss/20 px-2.5 py-0.5 rounded bg-moss/5">✓ Connected to ELO</span>
                </div>

                {/* Sub-Tabs of Local themes mapped */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Column 1: Openings */}
                  <div className="space-y-3.5">
                    <h4 className="font-mono font-black text-[11px] uppercase tracking-wider text-vermillion flex items-center gap-2 border-b border-vermillion/10 pb-1 w-full select-none">
                      <span className="px-1.5 py-0.5 bg-vermillion/10 border border-vermillion/25 rounded">OP</span> OPENING THEMES
                    </h4>
                    <div className="space-y-1.5">
                      {splitLocalThemes.openings.length === 0 ? (
                        <p className="text-zinc-500 italic text-[11px] py-4 pl-1">No openings registered in the leaderboard yet.</p>
                      ) : (
                        splitLocalThemes.openings.map(track => (
                          <div 
                            key={track.id} 
                            onClick={() => navigateTo('track', track.id)}
                            className="bg-black/20 hover:bg-[#111215]/50 border border-zinc-950 hover:border-brand-primary/30 p-2 rounded-lg flex items-center justify-between gap-3 transition-all group cursor-pointer hover:shadow-[0_2px_10px_rgba(255, 61, 46,0.08)]"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <button 
                                onClick={(e) => { e.stopPropagation(); onPlay(track); }} 
                                className="p-1.5 rounded-md bg-brand-primary/10 group-hover:bg-brand-primary group-hover:text-white text-brand-primary transition-all cursor-pointer select-none"
                              >
                                <Play className="w-3 h-3 fill-current" />
                              </button>
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <h5 className="font-sans font-extrabold text-[11.5px] uppercase text-white truncate">{track.title}</h5>
                                  {getVGMdbMatch(track.title) && (
                                    <span className="shrink-0 bg-vermillion/10 text-vermillion text-[6px] font-mono px-1 rounded border border-vermillion/20 uppercase font-black" title="Verified against official VGMdb tracklist">
                                      VGMdb
                                    </span>
                                  )}
                                </div>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); navigateTo('artist', track.artist); }}
                                  className="text-[11px] font-mono font-semibold text-zinc-500 hover:text-gold-bright text-left hover:underline select-text text-left block"
                                >
                                  by {track.artist}
                                </button>
                                {track.animePart || trackAssignments[track.id] ? (
                                  <span 
                                    className="text-[11px] font-mono text-zinc-500 block mt-1 truncate border border-zinc-900/60 rounded bg-[#111215]/80 px-1.5 py-0.5 w-max max-w-[200px] hover:text-zinc-300 hover:border-zinc-700 cursor-pointer transition-colors"
                                    onClick={(e) => { e.stopPropagation(); navigateTo('part', track.animePart || trackAssignments[track.id] as string); }}
                                  >
                                    ↳ {track.animePart || trackAssignments[track.id]}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-[11px] font-extrabold text-gold">{track.elo} ELO</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Column 2: Endings */}
                  <div className="space-y-3.5">
                    <h4 className="font-mono font-black text-[11px] uppercase tracking-wider text-moss flex items-center gap-2 border-b border-moss/10 pb-1 w-full select-none">
                      <span className="px-1.5 py-0.5 bg-moss/10 border border-moss/25 rounded">ED</span> ENDING THEMES
                    </h4>
                    <div className="space-y-1.5">
                      {splitLocalThemes.endings.length === 0 ? (
                        <p className="text-zinc-500 italic text-[11px] py-4 pl-1">No endings registered in the leaderboard yet.</p>
                      ) : (
                        splitLocalThemes.endings.map(track => (
                          <div 
                            key={track.id} 
                            onClick={() => navigateTo('track', track.id)}
                            className="bg-black/20 hover:bg-[#111215]/50 border border-zinc-950 hover:border-brand-primary/30 p-2 rounded-lg flex items-center justify-between gap-3 transition-all group cursor-pointer hover:shadow-[0_2px_10px_rgba(255, 61, 46,0.08)]"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <button 
                                onClick={(e) => { e.stopPropagation(); onPlay(track); }} 
                                className="p-1.5 rounded-md bg-brand-primary/10 group-hover:bg-brand-primary group-hover:text-white text-brand-primary transition-all cursor-pointer select-none"
                              >
                                <Play className="w-3 h-3 fill-current" />
                              </button>
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <h5 className="font-sans font-extrabold text-[11.5px] uppercase text-white truncate">{track.title}</h5>
                                  {getVGMdbMatch(track.title) && (
                                    <span className="shrink-0 bg-vermillion/10 text-vermillion text-[6px] font-mono px-1 rounded border border-vermillion/20 uppercase font-black" title="Verified against official VGMdb tracklist">
                                      VGMdb
                                    </span>
                                  )}
                                </div>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); navigateTo('artist', track.artist); }}
                                  className="text-[11px] font-mono font-semibold text-zinc-500 hover:text-gold-bright text-left hover:underline select-text text-left block"
                                >
                                  by {track.artist}
                                </button>
                                {track.animePart || trackAssignments[track.id] ? (
                                  <span 
                                    className="text-[11px] font-mono text-zinc-500 block mt-1 truncate border border-zinc-900/60 rounded bg-[#111215]/80 px-1.5 py-0.5 w-max max-w-[200px] hover:text-zinc-300 hover:border-zinc-700 cursor-pointer transition-colors"
                                    onClick={(e) => { e.stopPropagation(); navigateTo('part', track.animePart || trackAssignments[track.id] as string); }}
                                  >
                                    ↳ {track.animePart || trackAssignments[track.id]}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-[11px] font-extrabold text-gold">{track.elo} ELO</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic MyAnimeList Verification & Missing Openings Finder */}
              {malThemes && (
                <div className="bg-[#0b0c10] border-2 border-zinc-900/75 rounded-2xl p-5 sm:p-6 space-y-4">
                  <div className="border-b border-zinc-900 pb-2 flex items-center gap-2 flex-wrap justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-sm bg-indigo-ink/15 flex items-center justify-center border border-indigo-ink/20 text-gold-bright font-mono text-xs font-black select-none">M</div>
                      <div>
                        <h4 className="font-display font-black text-white text-base uppercase tracking-tight">Complete MyAnimeList Music Schedule</h4>
                        <p className="text-[11px] text-zinc-500 font-mono uppercase">Full thematic catalog cross-referenced dynamically against database</p>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-600 block">Jikan API v4 Core Sync</span>
                  </div>

                  {/* MAL Theme Cross Referencer lists */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                    {/* MAL Openings Schedule */}
                    <div className="space-y-3">
                      <h5 className="font-mono font-bold text-[11px] uppercase text-zinc-400 tracking-wider flex items-center gap-1">MAL Scheduled Openings:</h5>
                      <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1.5 custom-scrollbar">
                        {isLoadingMALThemes ? (
                          <div className="py-4 text-center text-zinc-500 flex items-center justify-center gap-2"><Clock className="w-4 h-4 animate-spin" /><span className="text-xs font-mono">Loading release schedule...</span></div>
                        ) : !malThemes.openings || malThemes.openings.length === 0 ? (
                          <p className="text-zinc-500 italic text-[11px]">No entries scheduled in official records.</p>
                        ) : (
                          malThemes.openings.map((themeStr, i) => {
                            const localMatch = matchMALThemeToLocal(themeStr, 'OP');
                            const matchStr = themeStr.replace(/^\d+:\s*/, '');
                            const match = matchStr.match(/^"(.*?)"\s*by\s*(.*)$/i);
                            const tName = match?.[1] || matchStr;
                            const aName = match?.[2] || 'Various Artists';

                            return (
                              <div key={i} className={`p-2 rounded-lg border flex items-center justify-between gap-3 text-[11px] ${localMatch ? 'bg-[#0A0805] border-zinc-900/50' : 'bg-black/40 border-dashed border-zinc-800/40'}`}>
                                <div className="min-w-0 space-y-0.5">
                                  <span className="text-zinc-400 font-sans block max-w-full font-bold truncate">{(i+1)}. "{tName}"</span>
                                  <span className="text-[11px] text-zinc-600 font-mono block truncate">by {aName}</span>
                                </div>
                                <div className="shrink-0 font-mono text-[11px] font-black uppercase">
                                  {localMatch ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-moss font-bold flex items-center gap-1 select-none">✓ IN DB</span>
                                      <span className="text-zinc-600">({localMatch.elo})</span>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={() => handleWikiPropose(tName, aName, 'OP', malDetails?.title || wikiKey)}
                                      className="px-2 py-1 rounded bg-[#251010]/30 border border-brand-primary/20 hover:border-brand-primary/50 text-brand-primary font-bold cursor-pointer hover:bg-brand-primary hover:text-white transition-all text-[11px] tracking-wide"
                                      title="Import or Propose Theme to Arena matches"
                                    >
                                      Import
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* MAL Endings Schedule */}
                    <div className="space-y-3">
                      <h5 className="font-mono font-bold text-[11px] uppercase text-zinc-400 tracking-wider flex items-center gap-1">MAL Scheduled Endings:</h5>
                      <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1.5 custom-scrollbar">
                        {isLoadingMALThemes ? (
                          <div className="py-4 text-center text-zinc-500 flex items-center justify-center gap-2"><Clock className="w-4 h-4 animate-spin" /><span className="text-xs font-mono">Loading release schedule...</span></div>
                        ) : !malThemes.endings || malThemes.endings.length === 0 ? (
                          <p className="text-zinc-500 italic text-[11px]">No entries scheduled in official records.</p>
                        ) : (
                          malThemes.endings.map((themeStr, i) => {
                            const localMatch = matchMALThemeToLocal(themeStr, 'ED');
                            const matchStr = themeStr.replace(/^\d+:\s*/, '');
                            const match = matchStr.match(/^"(.*?)"\s*by\s*(.*)$/i);
                            const tName = match?.[1] || matchStr;
                            const aName = match?.[2] || 'Various Artists';

                            return (
                              <div key={i} className={`p-2 rounded-lg border flex items-center justify-between gap-3 text-[11px] ${localMatch ? 'bg-[#0A0805] border-zinc-900/50' : 'bg-black/40 border-dashed border-zinc-800/40'}`}>
                                <div className="min-w-0 space-y-0.5">
                                  <span className="text-zinc-400 font-sans block max-w-full font-bold truncate">{(i+1)}. "{tName}"</span>
                                  <span className="text-[11px] text-zinc-600 font-mono block truncate">by {aName}</span>
                                </div>
                                <div className="shrink-0 font-mono text-[11px] font-black uppercase">
                                  {localMatch ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-moss font-bold flex items-center gap-1 select-none">✓ IN DB</span>
                                      <span className="text-zinc-600">({localMatch.elo})</span>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={() => handleWikiPropose(tName, aName, 'ED', malDetails?.title || wikiKey)}
                                      className="px-2 py-1 rounded bg-[#251010]/30 border border-brand-primary/20 hover:border-brand-primary/50 text-brand-primary font-bold cursor-pointer hover:bg-brand-primary hover:text-white transition-all text-[11px] tracking-wide"
                                      title="Import or Propose Theme to Arena matches"
                                    >
                                      Import
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================== ARTIST WIKI VIEW ============================== */}
          {wikiType === 'artist' && artistStats && (
            <div className="space-y-8 animate-fadeIn">
              {/* Profile card layout */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-black/80 via-zinc-950/90 to-black/80 border border-zinc-900/40 p-6 sm:p-8 flex flex-col md:flex-row gap-6 items-center md:items-start">
                
                {/* Visual Cover Avatar for Artist */}
                <div className="w-28 h-28 sm:w-32 sm:h-32 bg-gold/10 border-2 border-gold/30 rounded-full flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(255, 138, 61,0.2)] relative z-10 select-none overflow-hidden group">
                  {isLoadingArtistImage ? (
                    <div className="w-full h-full flex items-center justify-center animate-pulse"><Loader2 className="w-8 h-8 text-gold/50 animate-spin" /></div>
                  ) : artistImage ? (
                    <img 
                      src={artistImage} 
                      alt={wikiKey}
                      className="w-full h-full object-cover transition-transform duration-700"
                    />
                  ) : (
                    <span className="text-gold text-4xl font-black font-display uppercase italic relative z-10">{wikiKey.slice(0, 2)}</span>
                  )}
                  <div className="absolute inset-0 rounded-full border border-gold/10 duration-1000 scale-102 pointer-events-none" />
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors pointer-events-none" />
                </div>

                {/* Main Identity stats details */}
                <div className="flex-grow space-y-4 text-center md:text-left relative z-10 w-full min-w-0 pr-0">
                  <div className="space-y-1">
                    <span className="px-2 py-0.5 border border-brand-primary/30 text-brand-primary bg-brand-primary/5 text-[11px] font-mono font-black uppercase rounded select-none tracking-widest">// ANISON RECORDING ARTIST PROFILE</span>
                    <h1 className="text-3xl sm:text-4.5xl font-display font-black text-white uppercase tracking-tighter leading-tight truncate">{wikiKey}</h1>
                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-[11px] font-mono text-zinc-500 uppercase tracking-widest pt-0.5 select-none">
                      <span className="text-zinc-400 font-extrabold flex items-center gap-1"><Users className="w-3.5 h-3.5 text-zinc-500" /> {artistStats.totalSongs} Active theme(s)</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800"></span>
                      <span className="text-gold font-black flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> Average ELO: {artistStats.avgElo}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-800"></span>
                      <span className="text-moss font-black flex items-center gap-1"><Flame className="w-3.5 h-3.5" /> ELO Winrate: {artistStats.winRate}%</span>
                    </div>
                  </div>

                  {/* Biography Paragraph generator */}
                  <div className="bg-black/55 border border-zinc-900/60 rounded-xl p-4 text-xs text-zinc-400 font-sans leading-relaxed text-left">
                    <h3 className="font-mono font-extrabold text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5 text-zinc-600" /> Biography Summary</h3>
                    {artistProfile?.bio ? (
                      <div className="space-y-1 text-zinc-330 leading-relaxed font-sans text-xs">
                        <p className="font-semibold text-zinc-300 mb-1">About the Artist:</p>
                        <p className="whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto pr-1">
                          {artistProfile.bio}
                        </p>
                      </div>
                    ) : (
                      <p className="leading-relaxed text-zinc-330">
                        <strong>{wikiKey}</strong> is a musical artist featured on our anime theme leaderboard. 
                        With {artistStats.totalSongs} songs participating in match-ups, they have attained an overall win rate of {artistStats.winRate}% across {artistStats.totalMatches} matches. 
                        Their highest-rating song is <span className="text-white font-medium uppercase">"{artistStats.topSong.title}"</span> from the series <span className="text-white font-medium uppercase">"{artistStats.topSong.animeName}"</span>.
                      </p>
                    )}
                  </div>
                </div>

                {/* Right quick list */}
                <div className="w-full md:w-60 shrink-0 border border-zinc-900/60 bg-black/65 rounded-xl p-4 space-y-3 font-mono text-[11px] shadow-sm relative z-10 text-left">
                  <div className="border-b border-zinc-900/80 pb-1.5 mb-2.5 flex items-center gap-1 text-zinc-400 font-black tracking-widest uppercase text-[11px]">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" /> QUICK STATS
                  </div>
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">TOTAL MATCHES:</span>
                    <span className="text-zinc-300 text-right font-black">{artistStats.totalMatches}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">TOP RATING:</span>
                    <span className="text-gold font-black">{artistStats.topSong.elo} ELO</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                    <span className="text-zinc-600 uppercase font-extrabold">AVG WINRATE:</span>
                    <span className="text-moss font-black">{artistStats.winRate}%</span>
                  </div>
                  {artistProfile?.birthday && (
                    <div className="flex justify-between items-center gap-3 border-b border-zinc-950/40 pb-1.5">
                      <span className="text-zinc-600 uppercase font-extrabold">BIRTHDAY:</span>
                      <span className="text-zinc-305 font-bold truncate max-w-[120px]" title={artistProfile.birthday}>
                        {(() => {
                          try {
                            return new Date(artistProfile.birthday).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                          } catch (e) {
                            return artistProfile.birthday;
                          }
                        })()}
                      </span>
                    </div>
                  )}
                  {artistProfile?.websiteUrl && (
                    <a 
                      href={artistProfile.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex justify-between items-center gap-3 text-gold-bright hover:text-gold-bright border-b border-zinc-950/40 pb-1.5 transition-colors cursor-pointer font-bold"
                    >
                      <span className="text-zinc-600 uppercase font-extrabold">WEBSITE:</span>
                      <span className="flex items-center gap-1 text-[11px] uppercase font-black tracking-wider text-gold-bright hover:underline">Link <ExternalLink className="w-3 h-3" /></span>
                    </a>
                  )}
                  {artistProfile?.malUrl && (
                    <a 
                      href={artistProfile.malUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex justify-between items-center gap-3 text-vermillion hover:text-vermillion border-b border-zinc-950/40 pb-1.5 transition-colors cursor-pointer font-bold"
                    >
                      <span className="text-zinc-600 uppercase font-extrabold">MAL PAGE:</span>
                      <span className="flex items-center gap-1 text-[11px] uppercase font-black tracking-wider text-vermillion hover:underline">Link <ExternalLink className="w-3 h-3" /></span>
                    </a>
                  )}
                </div>
              </div>

              {/* Complete discography list */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Music4 className="w-5 h-5 text-zinc-500" /> SONG LIST / DISCOGRAPHY
                  </h3>
                  <span className="font-mono text-[11px] font-bold text-zinc-500 uppercase tracking-widest">SORTED BY RATING (ELO)</span>
                </div>

                <div className="space-y-2">
                  {localTracksForEntity.sort((a,b) => b.elo - a.elo).map((track, i) => (
                    <div 
                      key={track.id} 
                      onClick={() => navigateTo('track', track.id)}
                      className="bg-[#0a0b0e] hover:bg-[#101115] border border-zinc-900/65 hover:border-brand-primary/30 rounded-xl p-3 flex flex-wrap md:flex-nowrap items-center justify-between gap-4 transition-all group cursor-pointer hover:shadow-[0_4px_12px_rgba(255, 61, 46,0.06)]"
                    >
                      {/* Left: Play button and Title */}
                      <div className="flex items-center gap-3 min-w-0 flex-grow md:flex-none md:max-w-md">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onPlay(track); }} 
                          className="w-8 h-8 rounded-lg bg-brand-primary/10 group-hover:bg-brand-primary group-hover:text-white text-brand-primary flex items-center justify-center transition-all cursor-pointer shadow shrink-0 select-none"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <h4 className="font-sans font-extrabold text-sm uppercase text-white truncate">{track.title}</h4>
                            {getVGMdbMatch(track.title) && (
                              <span className="shrink-0 bg-vermillion/10 text-vermillion text-[7px] font-mono px-1 rounded border border-vermillion/20 uppercase font-black" title="Verified against official VGMdb tracklist">
                                VGMdb Verified
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] border border-zinc-900 px-1.5 py-0.5 rounded leading-none bg-black/40 font-mono text-zinc-500 uppercase font-bold shrink-0 block w-max select-none">theme</span>
                        </div>
                      </div>

                      {/* Middle clickable Anime link block */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); navigateTo('anime', track.animeName); }}
                        className="text-left py-1 px-3.5 bg-zinc-950/50 hover:bg-zinc-900 border border-zinc-900/40 rounded-lg flex items-center gap-2 min-w-0 max-w-sm group/btn cursor-pointer"
                        title={`Go to ${track.animeName} Wiki Page`}
                      >
                        <Tv className="w-3.5 h-3.5 text-zinc-500 group-hover/btn:text-brand-secondary transition-colors shrink-0" />
                        <span className="text-xs text-zinc-400 group-hover/btn:text-white transition-colors truncate uppercase font-sans font-bold">{track.animeName}</span>
                      </button>

                      {/* Right stats counters */}
                      <div className="flex items-center gap-5 justify-end ml-auto shrink-0 font-mono text-xs select-none">
                        <div className="text-right">
                          <span className="text-zinc-600 block text-[11px] uppercase font-bold">MATCH VALUE</span>
                          <span className="font-extrabold text-zinc-400">{track.matchesPlayed} battles</span>
                        </div>
                        <div className="text-right">
                          <span className="text-zinc-600 block text-[11px] uppercase font-bold">ELO SCORE</span>
                          <span className="font-black text-gold text-[13px]">{track.elo}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================== PART / SEGMENT WIKI VIEW ============================== */}
          {wikiType === 'part' && (
            <div className="space-y-8 animate-fadeIn">
              {/* Detailed segment header banner */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-black/85 via-zinc-950/95 to-black/85 border border-zinc-900/40 p-6 sm:p-7 flex flex-col md:flex-row gap-6 items-center justify-between">
                
                {/* Visual block */}
                <div className="flex items-center gap-4 text-center md:text-left">
                  <div className="w-14 h-14 bg-zinc-950/80 border border-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                    <Layers className="w-7 h-7 text-zinc-500" />
                  </div>
                  <div>
                    <span className="px-2 py-0.5 border border-brand-secondary/35 text-brand-secondary bg-brand-secondary/5 text-[11px] font-mono font-black uppercase rounded select-none tracking-widest block w-max max-w-full">// FRANCHISE PART / SEGMENT CATALOG</span>
                    <h1 className="text-xl sm:text-2.5xl font-display font-black text-white uppercase tracking-tight leading-tight mt-1">{wikiKey}</h1>
                    <button 
                      onClick={() => navigateTo('anime', wikiKey)}
                      className="text-[11px] font-mono uppercase text-zinc-400 hover:text-gold-bright hover:underline hover:underline-offset-2 flex items-center gap-1.5 mt-1 cursor-pointer"
                    >
                      <Tv className="w-3.5 h-3.5" /> Back to major franchise listing
                    </button>
                  </div>
                </div>

                {/* Substats Block */}
                <div className="grid grid-cols-2 gap-4 font-mono select-none">
                  <div className="bg-black/45 border border-zinc-900 p-3 rounded-xl text-center w-28">
                    <span className="text-zinc-600 block text-[11px] uppercase font-bold tracking-wider">TRACK COUNT</span>
                    <span className="text-lg font-black text-white">{localTracksForEntity.length} songs</span>
                  </div>
                  <div className="bg-black/45 border border-zinc-900 p-3 rounded-xl text-center w-28">
                    <span className="text-zinc-600 block text-[11px] uppercase font-bold tracking-wider">AVG INTENSITY</span>
                    <span className="text-lg font-black text-gold">{localTracksForEntity.length > 0 ? Math.round(localTracksForEntity.reduce((s,t)=>s+t.elo, 0)/localTracksForEntity.length) : 0} elo</span>
                  </div>
                </div>
              </div>

              {/* Layout matrix table of themes specifically for this part */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                  <h3 className="font-display font-black text-white text-lg uppercase tracking-tight flex items-center gap-2">
                    <Tv className="w-5 h-5 text-zinc-500" /> Part Theme list and specifications
                  </h3>
                  <span className="font-mono text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">Active records in databases</span>
                </div>

                <div className="space-y-2.5">
                  {localTracksForEntity.sort((a,b) => b.elo - a.elo).map((track, i) => (
                    <div 
                      key={track.id} 
                      onClick={() => navigateTo('track', track.id)}
                      className="bg-[#060608]/75 hover:bg-[#0b0c0f] border border-zinc-950 hover:border-brand-primary/30 rounded-xl p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 transition-all cursor-pointer group hover:shadow-[0_2px_10px_rgba(255, 61, 46,0.06)]"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-grow sm:flex-none sm:max-w-md">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onPlay(track); }} 
                          className="w-9 h-9 rounded-lg bg-brand-primary/10 group-hover:bg-brand-primary group-hover:text-white text-brand-primary flex items-center justify-center transition-all cursor-pointer shrink-0 shadow select-none"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="font-sans font-extrabold text-sm uppercase text-white truncate">{track.title}</h4>
                          <button 
                            onClick={(e) => { e.stopPropagation(); navigateTo('artist', track.artist); }}
                            className="text-[11px] font-mono text-zinc-500 hover:text-gold-bright font-extrabold text-left hover:underline select-text text-left block"
                          >
                            by {track.artist}
                          </button>
                        </div>
                      </div>

                      {/* Track Type display */}
                      <div className="font-mono text-xs select-none shadow-sm pr-4">
                        <span className="px-2.5 py-0.5 rounded border font-semibold text-zinc-400 border-zinc-700/40 bg-zinc-900/40">theme</span>
                      </div>

                      {/* Right Metrics for battle logs */}
                      <div className="flex gap-5 font-mono text-xs items-center shrink-0 ml-auto select-none">
                        <div className="text-right">
                          <span className="text-zinc-500 font-bold block text-[11px] uppercase tracking-wider">WIN/LOSS RECORD</span>
                          <span className="text-zinc-400 font-semibold">{track.wins}W - {track.losses}L</span>
                        </div>
                        <div className="text-right">
                          <span className="text-zinc-500 font-black block text-[11px] uppercase tracking-wider">ELO LEVEL</span>
                          <span className="text-gold font-black text-sm">{track.elo}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================== TRACK PROFILE DETAIL VIEW ============================== */}
          {wikiType === 'track' && track && (
            <div className="space-y-8 animate-fadeIn text-left">
              {/* Premium Visual Card */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-black/85 via-zinc-950/95 to-black/85 border border-zinc-900/40 p-6 sm:p-8 flex flex-col md:flex-row gap-8 items-center md:items-start select-text shadow-2xl">
                {/* Immersive Blurred backdrop banner */}
                <div className="absolute inset-0 z-0 opacity-15 overflow-hidden filter blur-2xl pointer-events-none">
                  <img 
                    src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/maxresdefault.jpg`} 
                    onError={(e) => {
                      e.currentTarget.src = `https://img.youtube.com/vi/${track.youtubeId}/hqdefault.jpg`;
                    }}
                    className="w-full h-full object-cover scale-150" 
                    alt="" 
                  />
                </div>

                {/* Left side: Artwork with hover play button */}
                <div 
                  onClick={() => onPlay(track)}
                  className="w-36 h-48 sm:w-40 sm:h-52 shrink-0 rounded-xl overflow-hidden border border-zinc-900 bg-zinc-950 shadow-2xl relative group cursor-pointer"
                >
                  <img 
                    src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/maxresdefault.jpg`} 
                    onError={(e) => {
                      e.currentTarget.src = `https://img.youtube.com/vi/${track.youtubeId}/hqdefault.jpg`;
                    }}
                    className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-all duration-300"
                    alt={track.title}
                  />
                  {/* Floating play overlays */}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-[1.5px]">
                    <div className="w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center shadow-[0_0_15px_rgba(255, 138, 61,0.4)]">
                      <Play className="w-5 h-5 ml-0.5 fill-current text-white" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/75 px-2 py-0.5 rounded text-[8.0px] font-mono font-black text-brand-primary uppercase tracking-wider border border-brand-primary/30 shadow select-none">
                    CLICK TO PLAY
                  </div>
                </div>

                {/* Right side: Detailed Metadata & Navigation Links */}
                <div className="flex-grow space-y-4 relative z-10 w-full">
                  <div>
                    <div className="flex flex-wrap gap-2 items-center mb-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-black tracking-widest uppercase border ${
                        track.type === 'OP' ? 'bg-vermillion/10 text-vermillion border-vermillion/30' :
                        track.type === 'ED' ? 'bg-moss/10 text-moss border-moss/30' :
                        'bg-indigo-ink/10 text-gold-bright border-indigo-ink/30'
                      }`}>
                        {track.type} THEME
                      </span>
                      {(() => {
                        const { eraName } = getAnimeEraAndYear(track.animeName);
                        return (
                          <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded text-[11px] font-black tracking-widest uppercase truncate max-w-[120px]">
                            {eraName}
                          </span>
                        );
                      })()}
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight mt-1 select-text">
                      {track.title}
                    </h2>
                  </div>

                  {/* Interconnected Wiki Navigation Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                    <button
                      onClick={() => navigateTo('artist', track.artist)}
                      className="px-4 py-3 bg-zinc-950/70 hover:bg-zinc-900/90 border border-zinc-900 hover:border-moss/40 rounded-xl flex items-center gap-3 transition-all cursor-pointer group text-left min-w-0"
                    >
                      <Users className="w-5 h-5 text-moss shrink-0" />
                      <div className="min-w-0 flex-grow">
                        <span className="block text-[11px] font-mono text-zinc-500 uppercase tracking-widest font-black leading-none">CREATIVE ARTIST</span>
                        <span className="block text-xs font-extrabold text-zinc-300 group-hover:text-gold-bright truncate mt-0.5 transition-colors">{track.artist}</span>
                      </div>
                    </button>

                    <button
                      onClick={() => navigateTo('anime', track.animeName)}
                      className="px-4 py-3 bg-zinc-950/70 hover:bg-zinc-900/90 border border-zinc-900 hover:border-brand-primary/40 rounded-xl flex items-center gap-3 transition-all cursor-pointer group text-left min-w-0"
                    >
                      <Tv className="w-5 h-5 text-brand-primary shrink-0" />
                      <div className="min-w-0 flex-grow">
                        <span className="block text-[11px] font-mono text-zinc-500 uppercase tracking-widest font-black leading-none">ANIME SERIES</span>
                        <span className="block text-xs font-extrabold text-zinc-300 group-hover:text-gold-bright truncate mt-0.5 transition-colors">{track.animeName}</span>
                      </div>
                    </button>
                  </div>

                  {/* Favorite and Library Shortcuts */}
                  <div className="flex flex-wrap gap-2 pt-2 select-none">
                    {onToggleFavorite && (
                      <button
                        onClick={() => onToggleFavorite(track.id)}
                        className={`px-3 py-1.5 rounded-lg font-mono text-[11px] font-black uppercase tracking-wider border flex items-center gap-1.5 cursor-pointer transition-all ${
                          favorites?.includes(track.id)
                            ? 'bg-rose-deep/10 text-vermillion-tint border-rose-deep/30 scale-95'
                            : 'bg-zinc-950/45 text-zinc-400 border-zinc-900 hover:border-zinc-800 hover:text-white'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${favorites?.includes(track.id) ? 'fill-current text-rose-deep' : ''}`} />
                        <span>{favorites?.includes(track.id) ? 'FAVORITED' : 'ADD HEART'}</span>
                      </button>
                    )}

                    {onToggleSaved && (
                      <button
                        onClick={() => onToggleSaved(track.id)}
                        className={`px-3 py-1.5 rounded-lg font-mono text-[11px] font-black uppercase tracking-wider border flex items-center gap-1.5 cursor-pointer transition-all ${
                          saved?.includes(track.id)
                            ? 'bg-indigo-ink/10 text-gold-bright border-indigo-ink/30 scale-95'
                            : 'bg-zinc-950/45 text-zinc-400 border-zinc-900 hover:border-zinc-800 hover:text-white'
                        }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${saved?.includes(track.id) ? 'fill-current text-gold-bright' : ''}`} />
                        <span>{saved?.includes(track.id) ? 'SAVED TO LIB' : 'ADD TO LIB'}</span>
                      </button>
                    )}

                    <button
                      onClick={async () => {
                        await exportToYouTubePlaylist(
                          track.title,
                          `Exported from Anisync: ${track.animeName}`,
                          [track]
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg font-mono text-[11px] font-black uppercase tracking-wider border flex items-center gap-1.5 cursor-pointer transition-all bg-vermillion/10 text-vermillion border-vermillion/30 hover:bg-vermillion/20"
                    >
                      <Youtube className="w-3.5 h-3.5 fill-current" />
                      <span>EXPORT TO YT</span>
                    </button>

                    <button
                      onClick={async () => {
                        await exportToSpotifyPlaylist(
                          track.title,
                          `Exported from Anisync: ${track.animeName}`,
                          [track]
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg font-mono text-[11px] font-black uppercase tracking-wider border flex items-center gap-1.5 cursor-pointer transition-all bg-moss/10 text-moss border-moss/30 hover:bg-moss/20"
                    >
                      <Music2 className="w-3.5 h-3.5 fill-current" />
                      <span>SPOTIFY</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Bento-style Stat Matrix Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-zinc-950/50 border border-zinc-900/60 rounded-xl relative overflow-hidden flex flex-col justify-between h-20">
                  <span className="text-[11px] font-mono text-zinc-500 font-black tracking-widest uppercase block mb-1">ELO RATING</span>
                  <div className="flex items-baseline gap-1 mt-auto">
                    <span className="text-2xl sm:text-3xl font-black text-gold">{track.elo}</span>
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">PTS</span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950/50 border border-zinc-900/60 rounded-xl relative overflow-hidden flex flex-col justify-between h-20">
                  <span className="text-[11px] font-mono text-zinc-500 font-black tracking-widest uppercase block mb-1">ARENA WR</span>
                  <div className="flex items-baseline gap-1 mt-auto">
                    <span className="text-2xl sm:text-3xl font-black text-white">
                      {track.matchesPlayed > 0 ? Math.round((track.wins / track.matchesPlayed) * 100) : 0}%
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">WINRATE</span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950/50 border border-zinc-900/60 rounded-xl relative overflow-hidden flex flex-col justify-between h-20">
                  <span className="text-[11px] font-mono text-zinc-500 font-black tracking-widest uppercase block mb-1">RECORD STATS</span>
                  <div className="flex items-baseline gap-0.5 mt-auto">
                    <span className="text-base sm:text-lg font-black text-moss">{track.wins || 0}W</span>
                    <span className="text-[11px] text-zinc-600 mx-1">·</span>
                    <span className="text-base sm:text-lg font-black text-vermillion">{track.losses || 0}L</span>
                    <span className="text-[11px] text-zinc-600 mx-1">·</span>
                    <span className="text-base sm:text-lg font-black text-zinc-500">{track.draws || 0}D</span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950/50 border border-zinc-900/60 rounded-xl relative overflow-hidden flex flex-col justify-between h-20">
                  <span className="text-[11px] font-mono text-zinc-500 font-black tracking-widest uppercase block mb-1">MATCHES PLAYED</span>
                  <div className="flex items-baseline gap-1 mt-auto">
                    <span className="text-2xl sm:text-3xl font-black text-[#eb5e28]">{track.matchesPlayed || 0}</span>
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">BATTLES</span>
                  </div>
                </div>
              </div>

              {/* Advanced Analytics Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ELO History Line Chart */}
                <div className="bg-[#0b0c10]/80 border border-zinc-900 rounded-2xl p-5 shadow-xl">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-mono text-[11px] uppercase tracking-wider text-gold font-black flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" /> ELO Trajectory
                    </h3>
                  </div>
                  <div className="h-48 w-full select-none">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trackAdvancedStats?.historyData || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#221B13" vertical={false} />
                        <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} width={40} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#090a0d', borderColor: '#221B13', borderRadius: '8px', fontSize: '12px' }}
                          itemStyle={{ color: '#FF8A3D', fontWeight: 'bold' }}
                        />
                        <Line type="monotone" dataKey="elo" stroke="#FF8A3D" strokeWidth={3} dot={{ r: 3, fill: "#FF8A3D", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Track Nemesis & Genre Winrate */}
                <div className="bg-[#0b0c10]/80 border border-zinc-900 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="font-mono text-[11px] uppercase tracking-wider text-vermillion font-black flex items-center gap-2 mb-3">
                      <Flame className="w-4 h-4" /> The Nemesis
                    </h3>
                    <div className="bg-black/50 border border-zinc-900/60 rounded-xl p-3 flex items-center gap-3">
                      {trackAdvancedStats?.nemesis ? (
                         <>
                            <div className="w-12 h-12 bg-zinc-900 rounded-lg shrink-0 overflow-hidden relative cursor-pointer" onClick={() => navigateTo('track', trackAdvancedStats.nemesis.id)}>
                              <img src={`https://img.youtube.com/vi/${trackAdvancedStats.nemesis.youtubeId}/mqdefault.jpg`} className="w-full h-full object-cover" alt="" />
                            </div>
                            <div className="min-w-0">
                               <p className="text-[11px] font-mono font-bold text-zinc-500 uppercase">MOST LOSSES AGAINST</p>
                               <p className="text-white font-black truncate text-sm hover:text-gold-bright cursor-pointer" onClick={() => navigateTo('track', trackAdvancedStats.nemesis.id)}>
                                 {trackAdvancedStats.nemesis.title}
                               </p>
                               <p className="text-zinc-500 text-[11px] font-bold truncate">by {trackAdvancedStats.nemesis.artist}</p>
                            </div>
                         </>
                      ) : (
                         <div className="text-zinc-600 font-mono text-[11px]">No rival nemesis identified yet.</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-mono text-[11px] uppercase tracking-wider text-gold-bright font-black flex items-center gap-2 mb-2">
                      <ShieldAlert className="w-4 h-4" /> Category Performance
                    </h3>
                    <div className="space-y-2">
                       {trackAdvancedStats?.winRateData.map(stat => (
                         <div key={stat.name} className="flex items-center gap-3">
                           <span className="text-[11px] text-zinc-400 font-mono w-24 truncate">{stat.name}</span>
                           <div className="flex-1 bg-zinc-950 h-2 rounded-full overflow-hidden">
                             <div className="bg-indigo-ink h-full rounded-full" style={{ width: `${stat.winRate}%` }}></div>
                           </div>
                           <span className="text-[11px] font-black text-gold-bright w-8">{stat.winRate}%</span>
                         </div>
                       ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Split Sections layout: Critique Form (Left) & Critic Reviews Feed (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Critique form container */}
                <div className="lg:col-span-5 space-y-4 text-left">
                  {currentUser ? (
                    <div className="bg-[#100C0A]/80 border border-zinc-900 p-5 rounded-2xl space-y-4 shadow-xl backdrop-blur-md relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/30 to-transparent" />
                      <div className="flex items-center gap-2 text-zinc-300 select-none">
                        <Sparkles className="w-4 h-4 text-brand-primary" />
                        <span className="text-[11px] font-mono font-black uppercase tracking-widest text-[#eb5e28]">
                          Write Soundtrack Critique
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 font-sans leading-normal">
                        Submit an official track review. Rating stars and analysis comments are compiled on this public track profile in real-time.
                      </p>

                      {/* Stars system */}
                      <div className="space-y-1.5 pt-1.5 border-t border-zinc-900/65">
                        <div className="flex justify-between items-center text-[11px] font-mono select-none">
                          <span className="font-black text-zinc-400 uppercase tracking-wider">MUSIC SCORE:</span>
                          <span className="text-gold font-extrabold flex items-center gap-1 bg-gold/10 px-1.5 py-0.5 border border-gold/20 rounded">
                            <Star className="w-3 h-3 fill-current text-gold" />
                            {trackReviewRating} / 10 STARS
                          </span>
                        </div>
                        <div className="flex justify-between gap-1 overflow-x-auto pb-1 select-none">
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                            <button
                              key={num}
                              type="button"
                              disabled={isTrackReviewSaved}
                              onClick={() => setTrackReviewRating(num)}
                              className={`aspect-square min-w-[24px] h-[24px] rounded font-mono text-[11px] font-extrabold flex items-center justify-center transition-all cursor-pointer ${
                                trackReviewRating === num
                                  ? 'bg-brand-primary text-white font-black shadow-[0_0_8px_rgba(255, 138, 61,0.4)] border-transparent'
                                  : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-white border border-zinc-800'
                              }`}
                            >
                              {num}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Text commentary */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-black">CRITIQUE FEEDBACK COMMENTARY:</span>
                        <textarea
                          value={trackReviewComment}
                          onChange={(e) => setTrackReviewComment(e.target.value)}
                          placeholder="Analyze the vocal strength, tempo dynamics, baseline energy, or nostalgia tier..."
                          className="w-full h-24 bg-black/55 border border-zinc-900 focus:border-brand-primary/45 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none placeholder-zinc-700 resize-none font-sans transition-all animate-none"
                          disabled={isTrackReviewSaved}
                        />
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!trackReviewComment.trim()) return;
                            try {
                              await addTrackReview({
                                trackId: track.id,
                                userId: currentUser.id,
                                username: currentUser.username || currentUser.email.split('@')[0],
                                userPicture: currentUser.picture || '',
                                rating: trackReviewRating,
                                comment: trackReviewComment,
                                source: 'direct'
                              });
                              toast.success('Your official soundtrack critique has been posted!');
                              setIsTrackReviewSaved(true);
                              setTrackReviewComment('');
                            } catch (err: any) {
                              toast.error(`Error publishing: ${err.message}`);
                            }
                          }}
                          disabled={isTrackReviewSaved || !trackReviewComment.trim()}
                          className={`px-4 py-2 w-full justify-center rounded font-mono text-[11px] uppercase font-black tracking-widest border transition-all cursor-pointer flex items-center gap-1.5 ${
                            isTrackReviewSaved 
                              ? 'bg-moss/10 text-moss border-moss/35' 
                              : 'bg-zinc-955 text-zinc-400 hover:text-white border-zinc-900 hover:border-zinc-800'
                          }`}
                        >
                          {isTrackReviewSaved ? '✓ Critique Published' : 'Publish Critique'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-zinc-900 border-dashed rounded-2xl p-6 text-center text-zinc-500 flex flex-col items-center justify-center gap-2">
                      <Star className="w-8 h-8 text-zinc-700 font-thin" />
                      <p className="text-xs font-semibold">Log in or create a profile to write an official critique for this track.</p>
                    </div>
                  )}
                </div>

                {/* Critique reviews feed on the right */}
                <div className="lg:col-span-7 space-y-4 text-left">
                  <div className="border-b border-zinc-900 pb-2 flex items-center justify-between">
                    <h3 className="font-display font-black text-white text-md uppercase tracking-tight flex items-center gap-2 select-none">
                      <Star className="w-4 h-4 text-gold fill-current" /> PUBLIC CRITIQUES & ANALYSIS FEED ({trackReviews.length})
                    </h3>
                  </div>

                  <div className="space-y-3 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                    {trackReviews.length === 0 ? (
                      <div className="py-12 text-center border border-zinc-950 rounded-2xl bg-zinc-950/20 text-zinc-500">
                        <Music2 className="w-10 h-10 text-zinc-800 mx-auto mb-2" />
                        <p className="text-xs font-mono tracking-wide">No critiques posted for {track.title} yet.</p>
                        <p className="text-[11px] mt-1 text-zinc-700">Be the first to declare your music analysis score above!</p>
                      </div>
                    ) : (
                      [...trackReviews].sort((a, b) => {
                        const isAFollowed = currentUser?.following?.includes(a.userId);
                        const isBFollowed = currentUser?.following?.includes(b.userId);
                        if (isAFollowed && !isBFollowed) return -1;
                        if (!isAFollowed && isBFollowed) return 1;
                        return b.createdAt - a.createdAt;
                      }).map((review) => (
                        <div key={review.id} className={`p-4 bg-[#100C0A]/45 border ${currentUser?.following?.includes(review.userId) ? 'border-brand-primary/40 shadow-sm shadow-brand-primary/10' : 'border-zinc-900/60'} rounded-xl space-y-3 relative`}>
                          <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap select-none">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {review.userPicture ? (
                                <img src={review.userPicture} className="w-7 h-7 rounded-sm border border-zinc-900 bg-black object-cover" referrerPolicy="no-referrer" alt="" />
                              ) : (
                                <div className="w-7 h-7 rounded-sm bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                                  <span className="font-mono text-[11px] font-black text-zinc-500 uppercase">{review.username.slice(0, 2)}</span>
                                </div>
                              )}
                              <div className="min-w-0 text-left font-mono">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="block font-bold text-xs text-white truncate font-sans">{review.username}</span>
                                </div>
                                <span className="block text-[11px] text-zinc-500 uppercase tracking-widest mt-0.5">
                                  {new Date(review.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · SOURCE: {review.source || 'direct'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gold/10 border border-gold/25 rounded shrink-0 text-gold font-mono text-[11px] font-bold">
                              <Star className="w-3 h-3 fill-current text-gold" />
                              {review.rating} / 10
                            </div>
                            <button
                              onClick={() => {
                                submitProposalToDb({
                                  id: Math.random().toString(36).substring(2, 11),
                                  type: 'report_comment',
                                  submittedBy: currentUser?.id || 'anonymous',
                                  submittedAt: new Date().toISOString(),
                                  status: 'pending',
                                  trackData: {
                                    title: track.title,
                                    artist: track.artist,
                                    animeName: track.animeName,
                                    type: track.type,
                                    youtubeId: track.youtubeId
                                  },
                                  oldTrackId: track.id,
                                  proposedYtId: review.id, // we store the review id here for the mod to know
                                  notes: `User reported comment from ${review.username}: "${review.comment}"`
                                }).then(() => toast.success("Comment reported to moderation queue.")).catch(e => toast.error(e.message));
                              }}
                              className="text-zinc-500 hover:text-vermillion p-1 rounded transition-colors ml-2"
                              title="Report Comment"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <p className="text-xs font-sans text-zinc-300 leading-relaxed italic border-t border-zinc-900/50 pt-2 text-left select-text">
                            "{review.comment}"
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </motion.div>
    </div>
  );
}
