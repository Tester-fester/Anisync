import React, { useState, useMemo, useEffect } from 'react';
import { AnimeTrack, UserAccount } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Music, Tv, Users, SlidersHorizontal, Play, Pause, ExternalLink, Info } from '@/utils/icons';
import { getAnimeEraAndYear } from '../utils/animeEras';
import CommunityExplore from './CommunityExplore';

interface DetailedSearchPageProps {
  tracks: AnimeTrack[];
  userProfiles: UserAccount[];
  initialQuery?: string;
  initialField?: 'all' | 'artist' | 'anime' | 'title' | 'users';
  onPlay: (track: AnimeTrack) => void;
  onShowWiki: (type: 'anime' | 'artist' | 'part' | 'track', key: string) => void;
  onViewProfile: (userId: string) => void;
}

export default function DetailedSearchPage({
  tracks,
  userProfiles,
  initialQuery = '',
  initialField = 'all',
  onPlay,
  onShowWiki,
  onViewProfile
}: DetailedSearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [field, setField] = useState<'all' | 'artist' | 'anime' | 'title' | 'users'>(initialField);
  const [visibleCount, setVisibleCount] = useState(20);
  
  // Update state if initial props change
  useEffect(() => {
    setQuery(initialQuery);
    setField(initialField);
    setVisibleCount(20);
  }, [initialQuery, initialField]);

  // Filters
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'OP' | 'ED' | 'OST'>('ALL');
  const [eraFilter, setEraFilter] = useState<'ALL' | 'retro' | 'classic' | 'modern' | 'reiwa'>('ALL');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

  // 1. Precomputed stats to power rich contextual filters
  const animeStats = useMemo(() => {
    const stats: Record<string, { count: number; totalMatches: number }> = {};
    for (const t of tracks) {
      const key = (t.animeName || 'Unknown').trim().toLowerCase();
      if (!stats[key]) stats[key] = { count: 0, totalMatches: 0 };
      stats[key].count++;
      stats[key].totalMatches += (t.matchesPlayed || 0);
    }
    return stats;
  }, [tracks]);

  const artistStats = useMemo(() => {
    const stats: Record<string, { count: number; maxElo: number }> = {};
    for (const t of tracks) {
      const key = (t.artist || 'Unknown').trim().toLowerCase();
      if (!stats[key]) stats[key] = { count: 0, maxElo: 0 };
      stats[key].count++;
      if (t.elo > stats[key].maxElo) stats[key].maxElo = t.elo;
    }
    return stats;
  }, [tracks]);

  // 2. State definitions for each unique filter modality
  const [animeScaleFilter, setAnimeScaleFilter] = useState<'ALL' | 'single' | 'franchise'>('ALL');
  const [animePlayFilter, setAnimePlayFilter] = useState<'ALL' | 'highly_played' | 'underdog'>('ALL');

  const [artistScaleFilter, setArtistScaleFilter] = useState<'ALL' | 'one_hit' | 'prolific'>('ALL');
  const [artistTierFilter, setArtistTierFilter] = useState<'ALL' | 'legendary' | 'rising' | 'indie'>('ALL');

  const [trackWrFilter, setTrackWrFilter] = useState<'ALL' | 'high' | 'mid' | 'low'>('ALL');
  const [trackMatchesFilter, setTrackMatchesFilter] = useState<'ALL' | 'veteran' | 'rookie' | 'unplayed'>('ALL');
  const [trackEloTierFilter, setTrackEloTierFilter] = useState<'ALL' | 'god' | 'warrior' | 'recruit'>('ALL');

  // Reset filters when the query scope changes
  useEffect(() => {
    setTypeFilter('ALL');
    setEraFilter('ALL');
    setAnimeScaleFilter('ALL');
    setAnimePlayFilter('ALL');
    setArtistScaleFilter('ALL');
    setArtistTierFilter('ALL');
    setTrackWrFilter('ALL');
    setTrackMatchesFilter('ALL');
    setTrackEloTierFilter('ALL');
  }, [field]);

  const isAnyFilterActive = useMemo(() => {
    if (field === 'anime') {
      return eraFilter !== 'ALL' || animeScaleFilter !== 'ALL' || animePlayFilter !== 'ALL';
    } else if (field === 'artist') {
      return artistScaleFilter !== 'ALL' || artistTierFilter !== 'ALL';
    } else {
      return typeFilter !== 'ALL' || eraFilter !== 'ALL' || trackWrFilter !== 'ALL' || trackMatchesFilter !== 'ALL' || trackEloTierFilter !== 'ALL';
    }
  }, [field, typeFilter, eraFilter, animeScaleFilter, animePlayFilter, artistScaleFilter, artistTierFilter, trackWrFilter, trackMatchesFilter, trackEloTierFilter]);

  const userResults = useMemo(() => {
    let res = userProfiles || [];
    if (query.trim()) {
      const q = query.toLowerCase();
      res = res.filter(u => 
        u.username.toLowerCase().includes(q) || 
        (u.bio && u.bio.toLowerCase().includes(q))
      );
    }
    // Return sorted by votesCount descending
    return res.sort((a, b) => (b.votesCount || 0) - (a.votesCount || 0));
  }, [userProfiles, query]);

  const results = useMemo(() => {
    if (field === 'users') return [];

    let res = tracks;

    if (query.trim()) {
      const q = query.toLowerCase();
      res = res.filter(t => {
        if (field === 'artist') return t.artist.toLowerCase().includes(q);
        if (field === 'anime') return t.animeName.toLowerCase().includes(q);
        if (field === 'title') return t.title.toLowerCase().includes(q);
        return t.title.toLowerCase().includes(q) || 
               t.artist.toLowerCase().includes(q) || 
               t.animeName.toLowerCase().includes(q);
      });
    }

    if (field === 'anime') {
      if (eraFilter !== 'ALL') {
        res = res.filter(t => {
          const { eraId } = getAnimeEraAndYear(t.animeName);
          return eraId === eraFilter;
        });
      }
      if (animeScaleFilter !== 'ALL') {
        res = res.filter(t => {
          const key = (t.animeName || 'Unknown').trim().toLowerCase();
          const item = animeStats[key];
          if (!item) return true;
          if (animeScaleFilter === 'single') return item.count === 1;
          if (animeScaleFilter === 'franchise') return item.count >= 2;
          return true;
        });
      }
      if (animePlayFilter !== 'ALL') {
        res = res.filter(t => {
          const key = (t.animeName || 'Unknown').trim().toLowerCase();
          const item = animeStats[key];
          if (!item) return true;
          if (animePlayFilter === 'highly_played') return item.totalMatches > 10;
          if (animePlayFilter === 'underdog') return item.totalMatches <= 10;
          return true;
        });
      }
    } 
    else if (field === 'artist') {
      if (artistScaleFilter !== 'ALL') {
        res = res.filter(t => {
          const key = (t.artist || 'Unknown').trim().toLowerCase();
          const item = artistStats[key];
          if (!item) return true;
          if (artistScaleFilter === 'one_hit') return item.count === 1;
          if (artistScaleFilter === 'prolific') return item.count >= 2;
          return true;
        });
      }
      if (artistTierFilter !== 'ALL') {
        res = res.filter(t => {
          const key = (t.artist || 'Unknown').trim().toLowerCase();
          const item = artistStats[key];
          if (!item) return true;
          if (artistTierFilter === 'legendary') return item.maxElo > 1300;
          if (artistTierFilter === 'rising') return item.maxElo >= 1100 && item.maxElo <= 1300;
          if (artistTierFilter === 'indie') return item.maxElo < 1100;
          return true;
        });
      }
    } 
    else {
      if (typeFilter !== 'ALL') {
        res = res.filter(t => t.type === typeFilter);
      }
      if (eraFilter !== 'ALL') {
        res = res.filter(t => {
          const { eraId } = getAnimeEraAndYear(t.animeName);
          return eraId === eraFilter;
        });
      }
      if (trackWrFilter !== 'ALL') {
        res = res.filter(t => {
          const wr = (t.wins || 0) / Math.max(1, t.matchesPlayed || 0);
          if (trackWrFilter === 'high') return wr > 0.60;
          if (trackWrFilter === 'mid') return wr >= 0.40 && wr <= 0.60;
          if (trackWrFilter === 'low') return wr < 0.40;
          return true;
        });
      }
      if (trackMatchesFilter !== 'ALL') {
        res = res.filter(t => {
          const m = t.matchesPlayed || 0;
          if (trackMatchesFilter === 'veteran') return m > 15;
          if (trackMatchesFilter === 'rookie') return m >= 1 && m <= 15;
          if (trackMatchesFilter === 'unplayed') return m === 0;
          return true;
        });
      }
      if (trackEloTierFilter !== 'ALL') {
        res = res.filter(t => {
          const elo = t.elo || 1200;
          if (trackEloTierFilter === 'god') return elo > 1300;
          if (trackEloTierFilter === 'warrior') return elo >= 1100 && elo <= 1300;
          if (trackEloTierFilter === 'recruit') return elo < 1100;
          return true;
        });
      }
    }

    return res.sort((a, b) => b.elo - a.elo); // Sort by elo by default
  }, [
    tracks, query, field, typeFilter, eraFilter,
    animeScaleFilter, animePlayFilter, animeStats,
    artistScaleFilter, artistTierFilter, artistStats,
    trackWrFilter, trackMatchesFilter, trackEloTierFilter
  ]);

  const artistGroups = useMemo(() => {
    if (field !== 'artist') return null;
    const groups: Record<string, { artist: string; tracks: AnimeTrack[]; totalElo: number; wins: number; matches: number; topTrack: AnimeTrack }> = {};
    for (const t of results) {
       const key = (t.artist || 'Unknown').trim().toLowerCase();
       if (!groups[key]) groups[key] = { artist: t.artist, tracks: [], totalElo: 0, wins: 0, matches: 0, topTrack: t };
       groups[key].tracks.push(t);
       groups[key].totalElo += t.elo;
       groups[key].wins += t.wins;
       groups[key].matches += t.matchesPlayed;
       if (t.elo > groups[key].topTrack.elo) groups[key].topTrack = t;
    }
    return Object.values(groups).sort((a, b) => b.totalElo - a.totalElo);
  }, [results, field]);

  const animeGroups = useMemo(() => {
    if (field !== 'anime') return null;
    const groups: Record<string, { anime: string; tracks: AnimeTrack[]; totalElo: number; wins: number; matches: number; topTrack: AnimeTrack }> = {};
    for (const t of results) {
       const key = (t.animeName || 'Unknown').trim().toLowerCase();
       if (!groups[key]) groups[key] = { anime: t.animeName, tracks: [], totalElo: 0, wins: 0, matches: 0, topTrack: t };
       groups[key].tracks.push(t);
       groups[key].totalElo += t.elo;
       groups[key].wins += t.wins;
       groups[key].matches += t.matchesPlayed;
       if (t.elo > groups[key].topTrack.elo) groups[key].topTrack = t;
    }
    return Object.values(groups).sort((a, b) => b.totalElo - a.totalElo);
  }, [results, field]);

  return (
    <div className="flex flex-col space-y-6 pt-4 pb-32">
      {/* Header section */}
      <div className="bg-gradient-to-b from-zinc-900 to-transparent p-6 rounded-3xl border border-zinc-800/80 shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>
        
        <div className="relative z-10 space-y-6">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
              <Search className="w-8 h-8 text-brand-primary" />
              Advanced Data Retrieval
            </h1>
            <p className="text-zinc-400 font-mono text-xs mt-2 ml-1">Index sweep: {tracks.length} master tracks loaded.</p>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-grow flex bg-black/60 border border-zinc-800 focus-within:border-vermillion rounded-xl overflow-hidden transition-all shadow-inner">
              <div className="flex items-center px-4 bg-zinc-950 border-r border-zinc-800">
                <select 
                  value={field}
                  onChange={(e) => setField(e.target.value as any)}
                  className="bg-transparent text-sm font-bold text-zinc-300 outline-none cursor-pointer"
                >
                  <option value="all">Any field</option>
                  <option value="anime">Series</option>
                  <option value="artist">Artist</option>
                  <option value="title">Title</option>
                  <option value="users">Community Profiles</option>
                </select>
              </div>
              <input 
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Initialising global query..."
                className="w-full bg-transparent px-4 py-3 text-white placeholder-zinc-600 outline-none font-medium tracking-wide"
              />
            </div>

            <button 
              onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              className={`px-4 py-3 rounded-xl border flex items-center gap-2 font-bold transition-all ${
                isFilterMenuOpen || isAnyFilterActive
                  ? 'bg-vermillion text-black border-vermillion font-extrabold shadow-[0_0_15px_rgba(27, 46, 74,0.3)]' 
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters {isAnyFilterActive && "•"}
            </button>
          </div>

          <AnimatePresence>
            {isFilterMenuOpen && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-4 border-t border-zinc-800/80">
                  {/* Dynamic Fields Layout */}
                  {field === 'anime' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Era Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Temporal Shift (Era)</label>
                        <div className="flex flex-wrap gap-2">
                           {[
                             { id: 'ALL', label: 'Any Era' },
                             { id: 'retro', label: 'Retro (<2000)' },
                             { id: 'classic', label: 'Classic (00s)' },
                             { id: 'modern', label: 'Modern (10s)' },
                             { id: 'reiwa', label: 'Reiwa (20s+)' }
                           ].map(era => (
                             <button
                               key={era.id}
                               onClick={() => setEraFilter(era.id as any)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                 eraFilter === era.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {era.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Franchise Scale Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Franchise Dimension</label>
                        <div className="flex flex-wrap gap-2">
                           {[
                             { id: 'ALL', label: 'Any Scale' },
                             { id: 'single', label: 'Standalone Title (1 track)' },
                             { id: 'franchise', label: 'Franchise (2+ tracks)' }
                           ].map(scale => (
                             <button
                               key={scale.id}
                               onClick={() => setAnimeScaleFilter(scale.id as any)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                 animeScaleFilter === scale.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {scale.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Activity Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Active Battle Density</label>
                        <div className="flex flex-wrap gap-2">
                           {[
                             { id: 'ALL', label: 'Any Density' },
                             { id: 'highly_played', label: 'Highly Played (>10 matches)' },
                             { id: 'underdog', label: 'Underdog (≤10 matches)' }
                           ].map(activity => (
                             <button
                               key={activity.id}
                               onClick={() => setAnimePlayFilter(activity.id as any)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                 animePlayFilter === activity.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {activity.label}
                             </button>
                           ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {field === 'artist' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Artist Scale Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Discography Range</label>
                        <div className="flex flex-wrap gap-2">
                           {[
                             { id: 'ALL', label: 'Any Catalog' },
                             { id: 'one_hit', label: 'Single/Rare (1 track)' },
                             { id: 'prolific', label: 'Prolific Singer (2+ tracks)' }
                           ].map(scale => (
                             <button
                               key={scale.id}
                               onClick={() => setArtistScaleFilter(scale.id as any)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                 artistScaleFilter === scale.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {scale.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Artist Tier Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Power / ELO Tier</label>
                        <div className="flex flex-wrap gap-2">
                           {[
                             { id: 'ALL', label: 'Any Tier' },
                             { id: 'legendary', label: 'Legendary (Peak ELO > 1300)' },
                             { id: 'rising', label: 'Rising Star (ELO 1100 - 1300)' },
                             { id: 'indie', label: 'Indie / Niche (< 1100 ELO)' }
                           ].map(tier => (
                             <button
                               key={tier.id}
                               onClick={() => setArtistTierFilter(tier.id as any)}
                               className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                                 artistTierFilter === tier.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {tier.label}
                             </button>
                           ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {field !== 'anime' && field !== 'artist' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                      {/* Classification Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Type</label>
                        <div className="flex flex-wrap gap-1.5">
                           {['ALL', 'OP', 'ED', 'OST'].map(t => (
                             <button
                               key={t}
                               onClick={() => setTypeFilter(t as any)}
                               className={`px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                                 typeFilter === t ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {t === 'ALL' ? 'Any' : t}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Era Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Era</label>
                        <div className="flex flex-wrap gap-1.5">
                           {[
                             { id: 'ALL', label: 'Any Era' },
                             { id: 'retro', label: 'Retro' },
                             { id: 'classic', label: 'Classic' },
                             { id: 'modern', label: 'Modern' },
                             { id: 'reiwa', label: 'Reiwa' }
                           ].map(era => (
                             <button
                               key={era.id}
                               onClick={() => setEraFilter(era.id as any)}
                               className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                                 eraFilter === era.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                               title={era.label}
                             >
                               {era.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Track ELO Tier */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Rating Tier</label>
                        <div className="flex flex-wrap gap-1.5">
                           {[
                             { id: 'ALL', label: 'Any' },
                             { id: 'god', label: 'God (>1300)' },
                             { id: 'warrior', label: 'Warrior' },
                             { id: 'recruit', label: 'Recruit' }
                           ].map(tier => (
                             <button
                               key={tier.id}
                               onClick={() => setTrackEloTierFilter(tier.id as any)}
                               className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                                 trackEloTierFilter === tier.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {tier.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Track Win Rate Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block">Win Ratio</label>
                        <div className="flex flex-wrap gap-1.5">
                           {[
                             { id: 'ALL', label: 'Any' },
                             { id: 'high', label: 'Dominant' },
                             { id: 'mid', label: 'Active' },
                             { id: 'low', label: 'Underdog' }
                           ].map(wr => (
                             <button
                               key={wr.id}
                               onClick={() => setTrackWrFilter(wr.id as any)}
                               className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                                 trackWrFilter === wr.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {wr.label}
                             </button>
                           ))}
                        </div>
                      </div>

                      {/* Battle Runs Filter */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-mono">Battles Run</label>
                        <div className="flex flex-wrap gap-1.5">
                           {[
                             { id: 'ALL', label: 'Any' },
                             { id: 'veteran', label: 'Veteran' },
                             { id: 'rookie', label: 'Rookie' },
                             { id: 'unplayed', label: 'Untested' }
                           ].map(runs => (
                             <button
                               key={runs.id}
                               onClick={() => setTrackMatchesFilter(runs.id as any)}
                               className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                                 trackMatchesFilter === runs.id ? 'bg-vermillion text-black' : 'bg-black/40 text-zinc-400 border border-zinc-800 hover:border-zinc-600'
                               }`}
                             >
                               {runs.label}
                             </button>
                           ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Results grid */}
      <div>
        {field === 'users' ? (
          <CommunityExplore userProfiles={userResults} onViewProfile={onViewProfile} />
        ) : (
          <>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-sm font-mono font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                Results <span className="text-zinc-600">[{results.length}]</span>
              </h2>
            </div>

         {results.length === 0 ? (
           <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-12 text-center">
             <Search className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
             <h3 className="text-lg font-bold text-zinc-500">No telemetry found</h3>
             <p className="text-zinc-600 text-sm mt-1">Adjust your signal parameters or filters.</p>
           </div>
         ) : (
           <>
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
             {artistGroups ? (
               artistGroups.slice(0, visibleCount).map(group => {
                   let imageUrl = group.topTrack.customImageUrl;
                   if (!imageUrl && group.topTrack.youtubeId) {
                     imageUrl = `https://img.youtube.com/vi/${group.topTrack.youtubeId}/maxresdefault.jpg`;
                   }
                   
                   return (
                     <motion.div 
                       key={group.artist}
                       layout
                       initial={{ opacity: 0, scale: 0.95 }}
                       animate={{ opacity: 1, scale: 1 }}
                       onClick={() => onShowWiki('artist', group.artist)}
                       className="group cursor-pointer relative bg-[#221B13] border border-zinc-800/80 hover:border-moss/50 rounded-lg flex flex-col transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] overflow-hidden h-[340px]"
                     >
                       <div className="relative w-full h-44 bg-zinc-900 flex-shrink-0 border-b border-zinc-800 overflow-hidden">
                         {imageUrl ? (
                           <img 
                             src={imageUrl} 
                             alt="Cover" 
                             className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-all duration-500" 
                             onError={(e) => { 
                               if (group.topTrack.youtubeId && e.currentTarget.src.includes('maxresdefault')) {
                                 e.currentTarget.src = `https://img.youtube.com/vi/${group.topTrack.youtubeId}/hqdefault.jpg`;
                               }
                             }}
                           />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center">
                             <Users className="w-12 h-12 text-zinc-800" />
                           </div>
                         )}

                         <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 backdrop-blur-[2px]">
                           <div className="bg-moss/90 text-black font-black uppercase tracking-widest text-xs px-4 py-2 rounded-full shadow-[0_0_20px_rgba(61, 220, 132,0.5)] flex items-center gap-2">
                             <ExternalLink className="w-4 h-4" /> View DB
                           </div>
                         </div>
                       </div>

                       <div className="p-4 flex flex-col flex-grow relative z-10">
                         <div className="flex items-center gap-2 mb-2 text-moss">
                           <Users className="w-4 h-4" />
                           <span className="font-mono text-[11px] font-black tracking-widest uppercase">Artist File</span>
                         </div>
                         <p className="text-xl font-black text-white leading-tight group-hover:text-moss transition-colors line-clamp-2">
                           {group.artist}
                         </p>
                         
                         <div className="flex flex-col gap-1.5 mt-3 text-sm text-zinc-400">
                            <div className="flex items-center gap-1.5 text-left">
                              <Music className="w-3.5 h-3.5 shrink-0" />
                              <span className="line-clamp-1">{group.tracks.length} Master Track{group.tracks.length !== 1 ? 's' : ''}</span>
                            </div>
                         </div>

                         <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-800/60 w-full">
                           <div className="flex items-baseline gap-1.5">
                             <span className="text-2xl font-black text-gold-bright leading-none">{Math.round(group.totalElo / group.tracks.length)}</span>
                             <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-500">AVG ELO</span>
                           </div>
                           
                           <div className="flex items-center gap-3">
                             <div className="flex flex-col items-end">
                               <span className="text-zinc-300 font-bold text-sm leading-none">
                                 {group.matches > 0 ? Math.round((group.wins / group.matches) * 100) : 0}%
                               </span>
                               <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-600">OVR WR</span>
                             </div>
                           </div>
                         </div>
                       </div>
                     </motion.div>
                   );
               })
             ) : animeGroups ? (
               animeGroups.slice(0, visibleCount).map(group => {
                   let imageUrl = group.topTrack.customImageUrl;
                   if (!imageUrl && group.topTrack.youtubeId) {
                     imageUrl = `https://img.youtube.com/vi/${group.topTrack.youtubeId}/maxresdefault.jpg`;
                   }
                   const { eraName } = getAnimeEraAndYear(group.anime);
                   
                   return (
                     <motion.div 
                       key={group.anime}
                       layout
                       initial={{ opacity: 0, scale: 0.95 }}
                       animate={{ opacity: 1, scale: 1 }}
                       onClick={() => onShowWiki('anime', group.anime)}
                       className="group cursor-pointer relative bg-[#221B13] border border-zinc-800/80 hover:border-[#FF3D2E]/50 rounded-lg flex flex-col transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] overflow-hidden h-[340px]"
                     >
                       <div className="relative w-full h-44 bg-zinc-900 flex-shrink-0 border-b border-zinc-800 overflow-hidden">
                         {imageUrl ? (
                           <img 
                             src={imageUrl} 
                             alt="Cover" 
                             className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-all duration-500" 
                             onError={(e) => { 
                               if (group.topTrack.youtubeId && e.currentTarget.src.includes('maxresdefault')) {
                                 e.currentTarget.src = `https://img.youtube.com/vi/${group.topTrack.youtubeId}/hqdefault.jpg`;
                               }
                             }}
                           />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center">
                             <Tv className="w-12 h-12 text-zinc-800" />
                           </div>
                         )}

                         <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 backdrop-blur-[2px]">
                           <div className="bg-[#FF3D2E]/90 text-black font-black uppercase tracking-widest text-xs px-4 py-2 rounded-full shadow-[0_0_20px_rgba(255, 61, 46,0.5)] flex items-center gap-2">
                             <ExternalLink className="w-4 h-4" /> View DB
                           </div>
                         </div>
                       </div>

                       <div className="p-4 flex flex-col flex-grow relative z-10">
                         <div className="flex items-center gap-2 mb-2 text-[#FF3D2E]">
                           <Tv className="w-4 h-4" />
                           <span className="font-mono text-[11px] font-black tracking-widest uppercase">Anime File</span>
                         </div>
                         <p className="text-xl font-black text-white leading-tight group-hover:text-[#FF3D2E] transition-colors line-clamp-2">
                           {group.anime}
                         </p>
                         
                         <div className="flex flex-col gap-1.5 mt-3 text-sm text-zinc-400">
                            <div className="flex items-center gap-1.5 text-left">
                              <Music className="w-3.5 h-3.5 shrink-0" />
                              <span className="line-clamp-1">{group.tracks.length} Master Track{group.tracks.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-left mt-1">
                              <span className="px-1.5 py-0.5 bg-zinc-800/80 rounded text-[11px] font-black tracking-widest text-zinc-400 uppercase border border-zinc-700/50">
                                {eraName}
                              </span>
                            </div>
                         </div>

                         <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-800/60 w-full">
                           <div className="flex items-baseline gap-1.5">
                             <span className="text-2xl font-black text-gold-bright leading-none">{Math.round(group.totalElo / group.tracks.length)}</span>
                             <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-500">AVG ELO</span>
                           </div>
                           
                           <div className="flex items-center gap-3">
                             <div className="flex flex-col items-end">
                               <span className="text-zinc-300 font-bold text-sm leading-none">
                                 {group.matches > 0 ? Math.round((group.wins / group.matches) * 100) : 0}%
                               </span>
                               <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-600">OVR WR</span>
                             </div>
                           </div>
                         </div>
                       </div>
                     </motion.div>
                   );
               })
             ) : (
               results.slice(0, visibleCount).map(track => {
               const { eraName } = getAnimeEraAndYear(track.animeName);
               
               // Resolve image: custom, or youtube
               let imageUrl = track.customImageUrl;
               if (!imageUrl && track.youtubeId) {
                 imageUrl = `https://img.youtube.com/vi/${track.youtubeId}/maxresdefault.jpg`;
               }

               return (
                 <motion.div 
                   key={track.id}
                   layout
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   className="group relative bg-[#221B13] border border-zinc-800/80 hover:border-vermillion/50 rounded-lg flex flex-col transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] overflow-hidden h-[340px]"
                 >
                   {/* Thumbnail area */}
                   <div className="relative w-full h-44 bg-zinc-900 flex-shrink-0 border-b border-zinc-800 overflow-hidden">
                     {imageUrl ? (
                       <img 
                         src={imageUrl} 
                         alt="Cover" 
                         className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500" 
                         onError={(e) => { 
                           if (track.youtubeId && e.currentTarget.src.includes('maxresdefault')) {
                             e.currentTarget.src = `https://img.youtube.com/vi/${track.youtubeId}/hqdefault.jpg`;
                           }
                         }}
                       />
                     ) : (
                       <div className="w-full h-full flex items-center justify-center">
                         <Music className="w-12 h-12 text-zinc-800" />
                       </div>
                     )}

                     {/* Top badges */}
                     <div className="absolute top-2 left-2 flex gap-1.5">
                       <span className="px-2 py-1 bg-black/80 backdrop-blur-sm text-[11px] font-black tracking-widest text-[#FF3D2E] uppercase rounded shadow-lg border border-[#FF3D2E]/30">
                         {track.type}
                       </span>
                       <span className="px-2 py-1 bg-black/80 backdrop-blur-sm text-[11px] font-black tracking-widest text-zinc-400 uppercase rounded shadow-lg border border-zinc-700">
                         {eraName}
                       </span>
                     </div>

                     {/* Detailed Track Profile overlay */}
                     <div 
                       onClick={() => onShowWiki('track', track.id)}
                       className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 cursor-pointer backdrop-blur-[2.5px]"
                     >
                       <div className="w-12 h-12 rounded-full bg-[#FF3D2E]/20 border border-[#FF3D2E]/40 text-[#FF3D2E] flex items-center justify-center transition-all duration-300 shadow-lg hover:bg-[#FF3D2E] hover:text-black hover:border-transparent mb-1.5 animate-none">
                         <Info className="w-5 h-5 flex-shrink-0" />
                       </div>
                       <span className="text-[11px] font-mono font-black text-[#FF3D2E] uppercase tracking-widest text-center">View Profile</span>
                     </div>

                     {/* Small Quick Play circular trigger in bottom-right corner */}
                     <button 
                       onClick={(e) => { e.stopPropagation(); onPlay(track); }}
                       className="absolute bottom-2.5 right-2.5 z-20 w-8 h-8 rounded-full bg-vermillion hover:bg-vermillion-tint text-black flex items-center justify-center shadow-lg cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0"
                       title={`Play "${track.title}"`}
                     >
                       <Play className="w-4 h-4 ml-0.5 fill-current flex-shrink-0" />
                     </button>
                     
                     <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#221B13] to-transparent pointer-events-none" />
                   </div>

                   {/* Info Area */}
                   <div className="p-4 flex flex-col flex-grow relative z-10">
                     <p className="text-xl font-black text-white leading-tight group-hover:text-vermillion transition-colors line-clamp-2">
                       {track.title}
                     </p>
                     
                     <div className="flex flex-col gap-1.5 mt-3 text-sm text-zinc-400">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onShowWiki('anime', track.animeName); }}
                          className="flex items-center gap-1.5 hover:text-brand-primary transition-colors text-left"
                        >
                          <Tv className="w-3.5 h-3.5 shrink-0" />
                          <span className="line-clamp-1">{track.animeName}</span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); onShowWiki('artist', track.artist); }}
                          className="flex items-center gap-1.5 hover:text-moss transition-colors text-left"
                        >
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span className="line-clamp-1">{track.artist}</span>
                        </button>
                     </div>

                     <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-800/60 w-full">
                       <div className="flex items-baseline gap-1.5">
                         <span className="text-2xl font-black text-gold-bright leading-none">{track.elo}</span>
                         <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-500">ELO</span>
                       </div>
                       
                       <div className="flex items-center gap-3">
                         <div className="flex flex-col items-end">
                           <span className="text-zinc-300 font-bold text-sm leading-none">{Math.round((track.wins / Math.max(1, track.matchesPlayed)) * 100)}%</span>
                           <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-600">WR</span>
                         </div>
                         
                         <button 
                           onClick={() => onShowWiki('anime', track.animeName)}
                           className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all ml-2"
                         >
                            <ExternalLink className="w-3.5 h-3.5" />
                         </button>
                       </div>
                     </div>
                   </div>
                 </motion.div>
               );
             })
           )}
           </div>
           
           {(artistGroups ? artistGroups.length : animeGroups ? animeGroups.length : results.length) > visibleCount && (
             <div className="text-center py-10 flex flex-col items-center">
               <p className="text-xs font-mono tracking-widest text-zinc-500 uppercase mb-4">
                 Showing {visibleCount} of {artistGroups ? artistGroups.length : animeGroups ? animeGroups.length : results.length} results
               </p>
               <button 
                 onClick={() => setVisibleCount(v => v + 20)}
                 className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-lg transition-colors border border-zinc-700 shadow-md uppercase tracking-widest text-sm"
               >
                 Load More
               </button>
             </div>
           )}
           </>
         )}
        </>
      )}
      </div>
    </div>
  );
}
