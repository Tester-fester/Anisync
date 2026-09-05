import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Users, Tv, Music, MonitorPlay, X, Swords, Trophy, Home, UserCircle } from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { AnimeTrack, UserAccount } from '../types';

interface GlobalSearchProps {
  tracks: AnimeTrack[];
  userProfiles: UserAccount[];
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (userId: string) => void;
  onSelectTrack: (track: AnimeTrack) => void;
  onSelectAnimeWiki: (animeTitle: string) => void;
  onSearchChange: (query: string, field?: 'all' | 'artist' | 'anime' | 'title') => void;
  onNavigate?: (tab: 'leaderboard' | 'arena' | 'tournament' | 'tourney-builder' | 'profile') => void;
}

export default function GlobalSearch({
  tracks,
  userProfiles,
  isOpen,
  onClose,
  onSelectUser,
  onSelectTrack,
  onSelectAnimeWiki,
  onSearchChange,
  onNavigate,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // MAL Suggestions
  const [malSuggestions, setMalSuggestions] = useState<any[]>([]);
  const [isSearchingMal, setIsSearchingMal] = useState(false);

  // Keyboard shortcuts and click outside
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        onClose();
        if (document.activeElement instanceof HTMLInputElement) {
           document.activeElement.blur();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        // Just trigger the opening callback if it was unmanaged from parent, 
        // but here it is managed by parent. But we can trigger the focus if already open.
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Autofocus when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      setQuery(''); // Reset when closed
      setMalSuggestions([]);
    }
  }, [isOpen]);

  // Debounced query for MAL
  useEffect(() => {
    if (!isOpen) return;
    
    if (!query.trim()) {
      setMalSuggestions([]);
      return;
    }
    
    // Only search MAL if it's over 2 chars to save API limit
    if (query.trim().length > 2) {
      const timer = setTimeout(async () => {
        setIsSearchingMal(true);
        try {
          const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=4&order_by=members&sort=desc`);
          if (res.ok) {
            const data = await res.json();
            setMalSuggestions(data.data || []);
          }
        } catch (err) {
          console.error("Failed to fetch MAL suggestions", err);
        } finally {
          setIsSearchingMal(false);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [query, isOpen]);

  // Local filtering — memoized so we don't recompute on every render.
  // (Previously this ran on every keystroke against the full userProfiles
  // and tracks arrays, calling toLowerCase() 5 times per render.)
  const { matchingUsers, matchingTracks } = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return { matchingUsers: [], matchingTracks: [] };
    const users = userProfiles.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.bio && u.bio.toLowerCase().includes(q))
    ).slice(0, 3);
    const trks = tracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.animeName.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q)
    ).slice(0, 4);
    return { matchingUsers: users, matchingTracks: trks };
  }, [query, userProfiles, tracks]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex justify-center items-start pt-[10vh] sm:pt-[15vh] px-4 font-sans">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-neutral-950/80 backdrop-blur-lg cursor-pointer"
            onClick={onClose}
          />
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", bounce: 0.25, duration: 0.4 }}
            className="w-full max-w-2xl bg-[#0A0805] border border-zinc-800/80 rounded-2xl shadow-2xl relative flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative p-4 border-b border-zinc-800/80 shrink-0">
              <Search className="w-5 h-5 text-zinc-500 absolute left-8 top-1/2 -translate-y-1/2 group-focus-within:text-vermillion transition-colors" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search series, users, tracks..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) {
                     onSearchChange(query, 'all');
                     onClose();
                  }
                }}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-vermillion/80 focus:bg-[#0A0805] rounded-xl py-4 pl-12 pr-12 text-sm md:text-base font-black tracking-wide text-white placeholder:text-zinc-600 transition-all outline-none shadow-[0_0_20px_rgba(27, 46, 74,0.05)] focus:shadow-[0_0_20px_rgba(27, 46, 74,0.15)]"
              />
              <button
                onClick={onClose}
                className="absolute right-8 top-1/2 -translate-y-1/2 p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick actions — shown when query is empty so users can jump to
                orphan tabs (tourney-builder, etc.) and core flows. */}
            {query.trim().length === 0 && onNavigate && (
              <div className="flex-1 overflow-y-auto max-h-[60vh] custom-scrollbar p-3 space-y-3">
                <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-600 font-bold px-1">Quick actions</p>
                <div className="grid grid-cols-1 gap-1">
                  {[
                    { label: 'Go to Leaderboard', icon: Home, tab: 'leaderboard' as const, color: 'text-gold-bright' },
                    { label: 'Vote in the Arena', icon: Swords, tab: 'arena' as const, color: 'text-vermillion' },
                    { label: 'Tournaments', icon: Trophy, tab: 'tournament' as const, color: 'text-gold' },
                    { label: 'Build a Custom Bracket', icon: Trophy, tab: 'tourney-builder' as const, color: 'text-vermillion-tint' },
                    { label: 'Your Profile', icon: UserCircle, tab: 'profile' as const, color: 'text-brand-secondary' },
                  ].map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.tab}
                        onClick={() => { onNavigate(action.tab); onClose(); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-zinc-900/80 rounded-lg flex gap-3 items-center text-sm font-bold text-white transition-all group"
                      >
                        <Icon className={`w-4 h-4 ${action.color} transition-transform`} />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-zinc-600 font-mono px-1 pt-2">
                  Tip: type to search tracks, anime, or users.
                </p>
              </div>
            )}

            {query.trim().length > 0 && (
              <div className="flex-1 overflow-y-auto max-h-[60vh] custom-scrollbar flex flex-col divide-y divide-zinc-900/60 p-2">
                
                {/* CATEGORIZED RESULTS */}
                
                {/* 1. Global Filters */}
                <div className="p-2 space-y-1 bg-zinc-950/20 rounded-lg mb-2">
                   <button 
                     onClick={() => { onSearchChange(query, 'artist'); onClose(); }}
                     className="w-full text-left px-3 py-2 hover:bg-zinc-900/80 rounded-lg flex gap-3 items-center text-sm md:text-xs font-bold text-white transition-all shadow-sm group"
                   >
                     <Users className="w-4 h-4 text-brand-secondary transition-transform" />
                     Search <span className="text-brand-secondary">"{query}"</span> in Artists
                   </button>
                   <button 
                     onClick={() => { onSearchChange(query, 'anime'); onClose(); }}
                     className="w-full text-left px-3 py-2 hover:bg-zinc-900/80 rounded-lg flex gap-3 items-center text-sm md:text-xs font-bold text-white transition-all shadow-sm group"
                   >
                     <Tv className="w-4 h-4 text-brand-secondary transition-transform" />
                     Search <span className="text-brand-secondary">"{query}"</span> in Series
                   </button>
                   <button 
                     onClick={() => { onSearchChange(query, 'title'); onClose(); }}
                     className="w-full text-left px-3 py-2 hover:bg-zinc-900/80 rounded-lg flex gap-3 items-center text-sm md:text-xs font-bold text-white transition-all shadow-sm group"
                   >
                     <Music className="w-4 h-4 text-gold transition-transform" />
                     Search <span className="text-gold">"{query}"</span> in Song Titles
                   </button>
                </div>

                {/* 2. Tracks */}
                {matchingTracks.length > 0 && (
                  <div className="py-2 space-y-1">
                    <span className="text-[11px] font-mono font-black tracking-widest text-gold uppercase px-3 py-1 block">Quick Tracks</span>
                    {matchingTracks.map(track => (
                      <button
                        key={track.id}
                        onClick={() => { onSelectTrack(track); onClose(); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-zinc-900/80 rounded-xl flex gap-4 text-sm md:text-xs text-white transition-colors cursor-pointer items-center"
                      >
                        <div className="w-10 h-10 rounded border border-zinc-800 bg-zinc-950 overflow-hidden shrink-0 relative">
                           <img 
                              src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/default.jpg`} 
                              alt="" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                           />
                           <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                             <Music className="w-4 h-4 text-white/80 drop-shadow-md" />
                           </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate text-sm">{track.title}</div>
                          <div className="text-xs md:text-[11px] font-mono text-zinc-400 truncate mt-0.5">{track.artist} · {track.animeName}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* 3. Anime / MAL */}
                <div className="py-2 space-y-1">
                  <div className="flex justify-between items-center px-3 py-1">
                    <span className="text-[11px] font-mono font-black tracking-widest text-brand-secondary uppercase block">Anime Series (MAL)</span>
                    {isSearchingMal && <span className="text-[11px] font-mono uppercase text-zinc-500 animate-pulse">Searching...</span>}
                  </div>
                  
                  {!isSearchingMal && malSuggestions.length === 0 && (
                    <div className="py-2 px-3 text-xs italic text-zinc-600">No matching anime series found.</div>
                  )}

                  {malSuggestions.map(anime => (
                    <button
                      key={anime.mal_id}
                      onClick={() => { onSelectAnimeWiki(anime.title); onClose(); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-zinc-900/80 rounded-xl flex gap-4 text-xs text-white transition-colors cursor-pointer items-center"
                    >
                      <img src={anime.images?.webp?.image_url} className="w-10 h-14 rounded-md object-cover border border-zinc-800 shrink-0" referrerPolicy="no-referrer" alt="" />
                      <div className="flex-1 min-w-0">
                        <h5 className="font-bold truncate text-white uppercase tracking-tight text-sm">{anime.title}</h5>
                        <span className="text-[11px] text-zinc-400 font-mono font-bold uppercase mt-1 block">{anime.type || 'TV'} · {anime.episodes ? `${anime.episodes} eps` : 'Ongoing'}</span>
                        <div className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5 max-w-[80%]">{anime.synopsis}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* 4. Users / Curators */}
                {matchingUsers.length > 0 && (
                  <div className="py-2 space-y-1">
                    <span className="text-[11px] font-mono font-black tracking-widest text-[#6cbbe6] uppercase px-3 py-1 block">Curators & Members</span>
                    {matchingUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => { onSelectUser(user.id); onClose(); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-zinc-900/80 rounded-xl flex gap-3 text-xs text-white transition-colors cursor-pointer items-center"
                      >
                        {user.picture ? (
                          <img src={user.picture} className="w-10 h-10 rounded-lg border border-zinc-800 shadow-md" referrerPolicy="no-referrer" alt="" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-md"><Users className="w-5 h-5 text-zinc-600" /></div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm flex items-center gap-2">
                            {user.username}
                            {user.role === 'admin' && <span className="text-[11px] bg-rose-deep/20 text-vermillion-tint px-1.5 py-0.5 rounded font-black uppercase">Admin</span>}
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono truncate mt-0.5">{user.bio || 'Cataloguer'}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
              </div>
            )}
            
            {query.trim().length === 0 && (
              <div className="flex-1 p-8 flex flex-col items-center justify-center space-y-4 text-center">
                 <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-[0_0_30px_rgba(244, 236, 219,0.02)]">
                   <MonitorPlay className="w-6 h-6 text-zinc-700" />
                 </div>
                 <h3 className="font-bold text-zinc-400 text-lg">Global Navigation</h3>
                 <p className="text-sm font-mono text-zinc-600 max-w-sm">Use the command palette to instantly jump directly to themes, series lore, or player profiles across the entire Anisync ecosystem.</p>
                 <div className="flex flex-wrap gap-2 justify-center mt-4 pt-4 border-t border-zinc-900 max-w-xs">
                   <div className="px-2 py-1 bg-zinc-900 text-zinc-500 rounded text-[11px] font-mono border border-zinc-800">Brave Shine</div>
                   <div className="px-2 py-1 bg-zinc-900 text-zinc-500 rounded text-[11px] font-mono border border-zinc-800">Fate/Zero</div>
                   <div className="px-2 py-1 bg-zinc-900 text-zinc-500 rounded text-[11px] font-mono border border-zinc-800">Unravel</div>
                   <div className="px-2 py-1 bg-zinc-900 text-zinc-500 rounded text-[11px] font-mono border border-zinc-800">mfrimi</div>
                 </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
