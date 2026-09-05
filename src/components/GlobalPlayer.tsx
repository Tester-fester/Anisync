import React, { useState, useEffect, useRef } from 'react';
import { AnimeTrack } from '../types';
import { 
  Play, Pause, X, Maximize2, Minimize2, Tv, Volume2, VolumeX, 
  SkipForward, SkipBack, AlertTriangle, ShieldAlert, Trash2, 
  Check, Shuffle, MonitorPlay, Repeat, ListMusic, Search, 
  ArrowUpDown, Flame, Trophy, Share2, Music
} from '@/utils/icons';
import { submitProposalToDb, updateTrackInDb, deleteTrackFromDb } from '../utils/firestoreService';
import { toast } from 'sonner';
import { confirm } from '../utils/confirm';
import { motion, AnimatePresence, useMotionValue } from 'motion/react';

interface GlobalPlayerProps {
  track: AnimeTrack | null;
  onClose: () => void;
  isAdmin?: boolean;
  onAdminUpdate?: (updatedTrack: AnimeTrack) => void;
  onAdminDelete?: (trackId: string) => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  isShuffle?: boolean;
  onToggleShuffle?: () => void;
  playlist?: AnimeTrack[];
  playlistIndex?: number;
  onPlayIndex?: (index: number) => void;
  isMobileNavVisible?: boolean;
}

export default function GlobalPlayer({ 
  track, 
  onClose, 
  isAdmin, 
  onAdminUpdate, 
  onAdminDelete, 
  hasNext, 
  hasPrev, 
  onNext, 
  onPrev, 
  isShuffle, 
  onToggleShuffle,
  playlist = [],
  playlistIndex = -1,
  onPlayIndex,
  isMobileNavVisible = true
}: GlobalPlayerProps) {
  const isPlaylistActive = playlist && playlist.length > 1;
  const [isMinimized, setIsMinimized] = useState(true);
  const [isPip, setIsPip] = useState(false);
  // Track the PiP drag offset via motion values so we can reset it when
  // the user disables PiP. Without this, Framer Motion retains the
  // translate transform from the last drag and the player ends up
  // off-screen ("lost in a corner") after toggling PiP off.
  const pipX = useMotionValue(0);
  const pipY = useMotionValue(0);
  React.useEffect(() => {
    if (!isPip) {
      pipX.set(0);
      pipY.set(0);
    }
  }, [isPip, pipX, pipY]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('dead_link');
  
  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editYtId, setEditYtId] = useState('');
  const [editAnime, setEditAnime] = useState('');

  // Queue Search and Sort Configuration
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSort, setQueueSort] = useState<'default' | 'elo' | 'title' | 'anime'>('default');
  const [showQueueInBar, setShowQueueInBar] = useState(false);

  // Playback Repeat state: 'off' | 'one' | 'all'
  const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>('off');

  const repeatModeRef = useRef(repeatMode);
  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  // Force play when track changes
  useEffect(() => {
    if (track) {
      setIsPlaying(true);
      setEditTitle(track.title);
      setEditArtist(track.artist);
      setEditYtId(track.youtubeId || '');
      setEditAnime(track.animeName);
      setIsMinimized(false); // Auto-maximize when a song is clicked or active
    }
  }, [track]);

  const handleSubmitReport = async () => {
    if (!track) return;
    try {
      await submitProposalToDb({
        id: Math.random().toString(36).substring(2, 11),
        type: 'fix_link',
        submittedBy: "User (Player)",
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
        proposedYtId: reportReason === 'dead_link' ? 'REPLACEMENT_NEEDED' : track.youtubeId,
        notes: `User reported issue: ${reportReason}`
      });
      toast.success("Issue reported! Moderators will review it.");
      setShowReport(false);
    } catch (e: any) {
      toast.error("Failed to report: " + e.message);
    }
  };

  const handleAdminSave = async () => {
    if (!track) return;
    try {
      await updateTrackInDb(track.id, {
        title: editTitle,
        artist: editArtist,
        youtubeId: editYtId,
        animeName: editAnime
      });
      toast.success("Track completely updated!");
      setShowAdminEdit(false);
      onAdminUpdate?.({
        ...track,
        title: editTitle,
        artist: editArtist,
        youtubeId: editYtId,
        animeName: editAnime
      });
    } catch (e: any) {
      toast.error("Edit failed: " + e.message);
    }
  };

  const handleAdminDelete = async () => {
    if (!track) return;
    if (await confirm({ title: `Permanently delete "${track.title}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) {
      try {
        await deleteTrackFromDb(track.id);
        toast.success("Track deleted.");
        setShowAdminEdit(false);
        onAdminDelete?.(track.id);
        onClose();
      } catch (e: any) {
        toast.error("Delete failed: " + e.message);
      }
    }
  };

  // Handle Play/Pause iFrame postMessage API commands
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        const command = isPlaying ? 'playVideo' : 'pauseVideo';
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: command, args: [] }),
          '*'
        );
      } catch (err) {
        console.warn('Could not postMessage to YouTube iFrame:', err);
      }
    }
  }, [isPlaying, track]);

  // Handle Volume changes
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        if (isMuted) {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
        } else {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }), '*');
        }
      } catch (err) {
        // ignore
      }
    }
  }, [volume, isMuted, track]);

  // Listen to youtube events for track ending to play next
  useEffect(() => {
     const handleMessage = (event: MessageEvent) => {
        if (event.origin !== "https://www.youtube.com") return;
        try {
           const data = JSON.parse(event.data);
           if (data.event === 'infoDelivery' && data.info && data.info.playerState === 0) { // 0 = ended
              if (repeatModeRef.current === 'one') {
                if (iframeRef.current && iframeRef.current.contentWindow) {
                  iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }),
                    '*'
                  );
                  iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
                    '*'
                  );
                }
              } else {
                if (playlist && playlistIndex === playlist.length - 1 && repeatModeRef.current === 'off') {
                  // Final track, no wrap-around in "off" mode
                  setIsPlaying(false);
                } else if (onNext) {
                  onNext();
                }
              }
           }
        } catch (e) { }
     };
     window.addEventListener('message', handleMessage);
     return () => window.removeEventListener('message', handleMessage);
  }, [onNext, playlist, playlistIndex]);

  if (!track) return null;

  const cleanId = track.youtubeId?.trim() || '';
  const embedUrl = `https://www.youtube.com/embed/${cleanId}?autoplay=1&mute=0&rel=0&modestbranding=1&enablejsapi=1`;

  // Sort and filter playlist queue items
  const enrichedPlaylist = (playlist || []).map((t, idx) => ({ ...t, originalIndex: idx }));
  let filteredPlaylist = enrichedPlaylist;

  if (queueSearch.trim()) {
    const qNorm = queueSearch.toLowerCase();
    filteredPlaylist = filteredPlaylist.filter(t => 
      t.title.toLowerCase().includes(qNorm) || 
      t.artist.toLowerCase().includes(qNorm) || 
      (t.animeName && t.animeName.toLowerCase().includes(qNorm))
    );
  }

  if (queueSort === 'elo') {
    filteredPlaylist = [...filteredPlaylist].sort((a, b) => (b.elo || 1200) - (a.elo || 1200));
  } else if (queueSort === 'title') {
    filteredPlaylist = [...filteredPlaylist].sort((a, b) => a.title.localeCompare(b.title));
  } else if (queueSort === 'anime') {
    filteredPlaylist = [...filteredPlaylist].sort((a, b) => a.animeName.localeCompare(b.animeName));
  }

  const toggleRepeatMode = () => {
    setRepeatMode(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
    toast.message(`Repeat mode: ${repeatMode === 'off' ? 'Repeat ALL enabled' : repeatMode === 'all' ? 'Repeat SINGLE song enabled' : 'Repeat disabled'}`);
  };

  return (
    <motion.div 
       drag={isPip}
       dragMomentum={false}
       style={isPip ? { x: pipX, y: pipY } : undefined}
       className={`fixed ${isPip ? 'bottom-20 right-4 w-72 z-[100]' : `left-0 right-0 z-[60] ${isMobileNavVisible ? 'bottom-[76px] pb-safe lg:bottom-0' : 'bottom-0 pb-safe'} transition-all duration-300 ease-in-out flex justify-center pointer-events-none`}`}
    >
      <div className={`bg-[#100C0A]/98 backdrop-blur-xl border border-[#2B2319] shadow-[0_-12px_45px_rgba(0,0,0,0.85)] flex flex-col pointer-events-auto transition-all w-full ${isPip ? 'rounded-2xl h-auto p-1 shadow-2xl border' : (isMinimized ? 'h-16 md:h-20 w-full md:w-[820px] lg:w-[940px] md:rounded-t-2xl' : `h-[85vh] md:h-[550px] w-full ${isPlaylistActive ? 'md:w-[1050px] lg:w-[1250px]' : 'md:w-[820px] lg:w-[940px]'} md:rounded-t-3xl`)}`}>
        
        {/* ==================== CONTROL BAR DECK ==================== */}
        <div className={`flex items-center justify-between px-3.5 py-2.5 bg-[#101720]/95 border-[#2B2319] group cursor-pointer ${isPip ? 'rounded-xl' : 'md:px-5 border-b sm:rounded-t-2xl'}`} onClick={() => { if (!isPip) setIsMinimized(!isMinimized); }}>
          {/* Left Block - Thumbnail details & state */}
          <div className="flex items-center gap-3 overflow-hidden max-w-[45%] xs:max-w-[50%] shrink">
             <div className={`rounded-lg bg-[#2B2319] overflow-hidden relative shrink-0 border border-white/5 shadow-[0_0_15px_rgba(0,0,0,0.4)] ${isPip ? 'w-9 h-9' : 'w-10 h-10 md:w-12 md:h-12'}`}>
               {cleanId ? (
                 <img src={track.customImageUrl || `https://img.youtube.com/vi/${cleanId}/mqdefault.jpg`} alt={track.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center bg-[#FF3D2E]/20"><Tv className="w-5 h-5 text-[#FF3D2E]" /></div>
               )}
               {isPlaying && (
                 <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                   <span className="flex gap-0.5 items-end h-3">
                     <span className="w-0.5 bg-gold-bright rounded-sm animate-[bounce_1s_infinite_100ms] h-full"></span>
                     <span className="w-0.5 bg-gold-bright rounded-sm animate-[bounce_1s_infinite_300ms] h-2/3"></span>
                     <span className="w-0.5 bg-gold-bright rounded-sm animate-[bounce_1s_infinite_500ms] h-1/2"></span>
                   </span>
                 </div>
               )}
             </div>
             <div className="flex flex-col min-w-0 pr-1">
               <span className="font-display font-black text-xs md:text-sm text-white truncate group-hover:text-[#FF3D2E] transition-colors leading-tight uppercase tracking-tight">{track.title}</span>
               <div className="flex items-center gap-1 min-w-0">
                 <span className="text-[11px] md:text-[11px] uppercase font-mono text-slate-400 truncate leading-none mt-0.5">
                   {track.artist} <span className="opacity-40">•</span> <span className="text-[#FF3D2E] font-semibold">{track.animeName}</span>
                 </span>
               </div>
             </div>
          </div>
          
          {/* Middle/Right Deck Media Controls */}
          <div className="flex items-center gap-1.5 xs:gap-2.5 sm:gap-4 shrink-0" onClick={e => e.stopPropagation()}>
            {/* Admin utilities */}
            {isAdmin && (
              <button 
                 onClick={(e) => { e.stopPropagation(); setShowAdminEdit(!showAdminEdit); setIsMinimized(false); setShowReport(false); }}
                 className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded font-mono text-[11px] uppercase tracking-wider font-bold transition-colors ${showAdminEdit ? 'bg-vermillion/20 text-vermillion border border-vermillion/30' : 'bg-[#2B2319]/50 text-slate-400 hover:text-vermillion border border-transparent border-dashed'}`}
                 title="Admin Panel"
              >
                 <ShieldAlert className="w-3.5 h-3.5" /> <span className="hidden lg:inline">MOD CONTROLS</span>
              </button>
            )}

            <button 
                 onClick={(e) => { e.stopPropagation(); setShowReport(!showReport); setIsMinimized(false); setShowAdminEdit(false); }}
                 className={`hidden sm:flex items-center gap-1 px-2 py-1 bg-gold/5 hover:bg-gold/20 text-slate-400 hover:text-gold-bright rounded-lg border border-gold/10 font-mono text-[11px] uppercase tracking-wider font-bold transition-colors`}
                 title="Report Dead Link / Issue"
            >
                 <AlertTriangle className="w-3 h-3" /> <span className="hidden lg:inline">REPORT AUDIO</span>
            </button>
            
            <div className="h-4 w-px bg-[#2B2319] mx-0.5 hidden sm:block"></div>
            
            {/* Desktop Volume Slider */}
            <div className="hidden md:flex items-center gap-2 group/vol mr-1">
              <button 
                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                className="text-slate-400 hover:text-white transition-colors"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-vermillion" /> : <Volume2 className="w-4 h-4 text-slate-300" />}
              </button>
              <input 
                type="range" 
                min="0" max="100" 
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  e.stopPropagation();
                  setVolume(parseInt(e.target.value));
                  if (parseInt(e.target.value) > 0) setIsMuted(false);
                }}
                className="w-14 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FF3D2E]"
              />
            </div>

            {/* Shuffle Button */}
            {isPlaylistActive && (
              <button 
                className={`text-slate-400 hover:text-white p-1 transition-colors relative ${isShuffle ? 'text-[#FF3D2E]' : 'opacity-65'}`}
                onClick={(e) => { e.stopPropagation(); onToggleShuffle && onToggleShuffle(); }}
                title="Shuffle Playlist Queue"
              >
                 <Shuffle className="w-3.5 h-3.5 md:w-4 md:h-4" />
                 {isShuffle && <span className="absolute bottom-[-1px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FF3D2E]"></span>}
              </button>
            )}

            {/* Prev Item */}
            {isPlaylistActive && (
              <button 
                 className={`text-slate-400 hover:text-white p-1 transition-all ${hasPrev ? 'hover:-translate-y-0.5 active:translate-y-0' : 'opacity-25 cursor-not-allowed'}`}
                 onClick={(e) => { e.stopPropagation(); if (hasPrev && onPrev) onPrev(); }}
                 disabled={!hasPrev}
                 title="Previous song"
              >
                 <SkipBack className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </button>
            )}

            {/* Compact Play Button */}
            <button 
              className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-[#FF3D2E] hover:bg-[#FF3D2E]/90 text-white hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-lg shrink-0"
              onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 md:w-4 md:h-4 fill-current" /> : <Play className="w-3.5 h-3.5 md:w-4 md:h-4 fill-current ml-0.5" />}
            </button>

            {/* Next Item */}
            {isPlaylistActive && (
              <button 
                 className={`text-slate-400 hover:text-white p-1 transition-all ${hasNext ? 'hover:-translate-y-0.5 active:translate-y-0' : 'opacity-25 cursor-not-allowed'}`}
                 onClick={(e) => { e.stopPropagation(); if (hasNext && onNext) onNext(); }}
                 disabled={!hasNext}
                 title="Next song"
              >
                 <SkipForward className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </button>
            )}

            {/* Repeat Mode Control */}
            <button 
               className={`p-1 transition-colors relative ${repeatMode === 'off' ? 'text-slate-500' : 'text-vermillion'}`}
               onClick={(e) => { e.stopPropagation(); toggleRepeatMode(); }}
               title={`Repeat: ${repeatMode.toUpperCase()}`}
            >
               <Repeat className="w-3.5 h-3.5 md:w-4 md:h-4" />
               {repeatMode !== 'off' && (
                 <span className="absolute -top-1 right-0 text-[7px] font-black font-mono leading-none bg-vermillion text-white px-0.5 rounded">
                   {repeatMode === 'one' ? '1' : 'A'}
                 </span>
               )}
            </button>

            <div className="h-4 w-px bg-[#2B2319] mx-0.5"></div>

            {/* Fast Active Playlist Drawer Trigger */}
            {isPlaylistActive && playlist.length > 0 && (
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (isMinimized) {
                    setIsMinimized(false);
                    setShowQueueInBar(true);
                  } else {
                    setIsMinimized(true);
                  }
                }} 
                className={`p-1.5 rounded relative text-slate-400 hover:text-white transition-all flex items-center justify-center gap-1`}
                title="Active Playlist Queue Drawer"
              >
                <ListMusic className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="text-[11px] bg-[#FF3D2E]/20 border border-[#FF3D2E]/30 text-[#FF3D2E] text-[11px] px-1 rounded-md font-bold font-mono">
                  {playlist.length}
                </span>
              </button>
            )}

            {/* PIP Mode toggle */}
            <button 
              onClick={(e) => { e.stopPropagation(); setIsPip(!isPip); setIsMinimized(false); }} 
              className={`p-1 transition-colors sm:block hidden ${isPip ? 'text-[#FF3D2E]' : 'text-slate-400 hover:text-white'}`}
              title={isPip ? 'Disable Picture-in-Picture' : 'Enable Picture-in-Picture float mode'}
            >
              <MonitorPlay className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>

            {/* Maximize/Minimize trigger */}
            <button 
              onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); setIsPip(false); }} 
              className="text-slate-400 hover:text-white p-1 transition-transform active:scale-90" 
              title={isMinimized ? 'Expand Audio Lounge view' : 'Minimize back to audio deck'}
            >
              {isMinimized ? <Maximize2 className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Minimize2 className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            </button>

            {/* Close Button */}
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-slate-400 hover:text-vermillion p-1 transition-colors" title="Shut down Persistent Player">
              <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
          </div>
        </div>

        {/* ==================== EXPANDED WORKSPACE GRID ==================== */}
        <motion.div 
          animate={{ 
            height: isMinimized ? '1px' : '100%', 
            opacity: isMinimized ? 0.001 : 1,
            pointerEvents: isMinimized ? 'none' : 'auto'
          }}
          style={{
            flex: isMinimized ? '0 0 1px' : '1 1 0%'
          }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className={`relative w-full flex-1 flex flex-col bg-black/95 overflow-hidden rounded-b-xl ${isPip ? 'h-40' : ''}`}
        >
              {/* Reports form block overlays on active video */}
              {showReport && (
                <div className="absolute top-0 left-0 right-0 z-30 bg-[#101720]/95 backdrop-blur-md border-b border-burnt/40 p-4.5 shadow-xl flex flex-col gap-3">
                   <div className="flex items-center gap-2 text-gold-bright">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-mono text-[11px] uppercase font-black tracking-widest">Report Audio Link or Synchronization Issue</span>
                   </div>
                   <p className="text-zinc-400 text-[11px] font-sans -mt-1 scale-95 origin-left">
                     Help us refine Anisync's database. If this video is deleted, muted, or incorrect, report it below for immediate human moderation.
                   </p>
                   <select 
                     value={reportReason} 
                     onChange={(e) => setReportReason(e.target.value)}
                     className="bg-[#100C0A] border border-[#2B2319] text-xs text-white rounded-lg p-2.5 font-sans focus:outline-none focus:border-gold/40 cursor-pointer"
                   >
                     <option value="dead_link">Video Blocked / Dead YouTube Link</option>
                     <option value="wrong_song">Wrong Theme Match (Not the song/opening listed)</option>
                     <option value="bad_quality">Poor Audio Quality / Static / Lag</option>
                     <option value="wrong_metadata">Incorrect Metadata Tagging (Anime / Artist / Title misspelt)</option>
                   </select>
                   <div className="flex gap-2.5 justify-end">
                      <button onClick={() => setShowReport(false)} className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-400 hover:text-white border border-[#2B2319] hover:bg-white/5 transition-colors cursor-pointer">CANCEL</button>
                      <button onClick={handleSubmitReport} className="px-4 py-1.5 rounded-lg text-xs bg-gold/10 text-gold-bright border border-gold/30 hover:bg-gold/20 font-mono font-black uppercase tracking-wider transition-colors cursor-pointer">SUBMIT ANOMALY REPORT</button>
                   </div>
                </div>
              )}

              {/* Admin overridden modification interface */}
              {showAdminEdit && isAdmin && (
                <div className="absolute top-0 left-0 right-0 z-30 bg-[#101720]/98 backdrop-blur border-b border-rose-deep/50 p-4 shadow-xl flex flex-col gap-3">
                   <div className="flex items-center justify-between text-vermillion border-b border-rose-deep/20 pb-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4.5 h-4.5 text-vermillion" />
                        <span className="font-mono text-[11px] uppercase font-black tracking-widest">ADMIN STRATEGIC METADATA OVERRIDE</span>
                      </div>
                      <button onClick={handleAdminDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-deep/10 hover:bg-rose-deep hover:text-white text-vermillion-tint border border-rose-deep/20 text-[11px] font-mono uppercase font-bold tracking-wider transition-all cursor-pointer">
                         <Trash2 className="w-3.5 h-3.5 shrink-0" /> PURGE FROM ECOSYSTEM
                      </button>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-3 mt-1 text-left">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-mono text-slate-400 uppercase tracking-widest font-black">Track Title</label>
                        <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="bg-[#221B13] border border-rose-deep/30 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-vermillion/50" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-mono text-slate-400 uppercase tracking-widest font-black">Anime Name</label>
                        <input type="text" value={editAnime} onChange={e => setEditAnime(e.target.value)} className="bg-[#221B13] border border-rose-deep/30 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-vermillion/50" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-mono text-slate-400 uppercase tracking-widest font-black">Artist / Lyricist</label>
                        <input type="text" value={editArtist} onChange={e => setEditArtist(e.target.value)} className="bg-[#221B13] border border-rose-deep/30 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-vermillion/50" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-mono text-slate-400 uppercase tracking-widest font-black">YouTube Link ID</label>
                        <input type="text" value={editYtId} onChange={e => setEditYtId(e.target.value)} className="bg-[#221B13] border border-rose-deep/30 rounded-lg p-2 text-xs font-mono text-[#FF3D2E] focus:outline-none focus:border-vermillion/50" />
                      </div>
                   </div>

                   <div className="flex gap-2.5 justify-end border-t border-rose-deep/20 pt-2.5">
                      <button onClick={() => setShowAdminEdit(false)} className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-400 hover:text-white cursor-pointer hover:bg-white/5 transition-colors">DISCARD CHANGES</button>
                      <button onClick={handleAdminSave} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs bg-vermillion-hover hover:bg-vermillion text-white font-mono font-black uppercase tracking-wider shadow-[0_4px_15px_rgba(200, 30, 85,0.35)] transition-all cursor-pointer">
                        <Check className="w-4 h-4" /> SAVE MODIFICATIONS
                      </button>
                   </div>
                </div>
              )}              {/* TWO PANEL INTERATIVE CONTENT */}
              <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                
                {/* Panel 1: Main Video Play/Cover area (Left block, col-span-7 or col-span-12) */}
                <div className={`${isPlaylistActive ? 'md:col-span-7 md:border-r' : 'md:col-span-12'} flex flex-col h-full bg-black relative border-b md:border-b-0 border-[#2B2319]/20`}>
                  <div className="flex-1 relative w-full h-full bg-slate-950/40">
                    {cleanId ? (
                      <>
                        <iframe
                          ref={iframeRef}
                          src={embedUrl}
                          title={track.title}
                          frameBorder="0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="w-full h-full absolute inset-0 z-10"
                        />
                        {!isPlaying && (
                          <div 
                            onClick={() => setIsPlaying(true)}
                            className="w-full h-full flex flex-col items-center justify-center bg-zinc-950/98 absolute inset-0 z-20 cursor-pointer group"
                          >
                            <img 
                              src={track.customImageUrl || `https://img.youtube.com/vi/${cleanId}/mqdefault.jpg`} 
                              alt={track.title} 
                              className="absolute inset-0 w-full h-full object-cover opacity-15 filter blur-lg transition-transform duration-1000"
                              referrerPolicy="no-referrer"
                            />
                            <div className="relative z-10 flex flex-col items-center text-center p-6 space-y-4">
                              <span className="w-16 h-16 rounded-full bg-[#FF3D2E] text-white flex items-center justify-center hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-lg">
                                <Play className="w-8 h-8 fill-current ml-1" />
                              </span>
                              <div className="space-y-1">
                                <h5 className="font-display font-black text-white text-md uppercase tracking-wide px-4">
                                  {track.title}
                                </h5>
                                <p className="text-[#FF3D2E] font-mono text-[11px] uppercase tracking-widest font-black">// PLAYBACK SUSPENDED</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[#100C0A] text-zinc-500 font-mono text-xs uppercase p-6 text-center">
                         <Tv className="w-10 h-10 mb-3 opacity-50 text-[#FF3D2E]" />
                         Audio/Video Connection Missing
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel 2: Interactive playlist queue (Right block, col-span-5) */}
                {isPlaylistActive && (
                  <div className="md:col-span-5 flex flex-col bg-[#0A0805] overflow-hidden h-full">
                    {/* Queue Header info & actions */}
                    <div className="p-3 bg-[#0d1218]/90 border-b border-[#2B2319]/60 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ListMusic className="w-4 h-4 text-[#FF3D2E]" />
                          <span className="text-[11px] font-mono font-black text-white tracking-widest uppercase">ACTIVE PLAYBACK QUEUE</span>
                        </div>
                        <span className="text-[11px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-lg uppercase">
                          {playlist.length} Tracks Loaded
                        </span>
                      </div>

                      {/* Sorting & filtering bar */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                          <input
                            type="text"
                            value={queueSearch}
                            onChange={(e) => setQueueSearch(e.target.value)}
                            placeholder="FILTER CODES OR SERIES..."
                            className="w-full bg-[#0A0805] border border-zinc-900 focus:border-[#FF3D2E]/40 text-white rounded-lg pl-7.5 py-1 text-[11px] font-mono uppercase focus:outline-none transition-colors"
                          />
                          {queueSearch && (
                            <button onClick={() => setQueueSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-[12px] font-bold">×</button>
                          )}
                        </div>

                        {/* Sorting Selection Controller */}
                        <div className="flex items-center gap-1 shrink-0 bg-[#0A0805] p-0.5 border border-zinc-900 rounded-lg">
                          {[
                            { id: 'default', label: 'ORIGINAL' },
                            { id: 'elo', label: 'RATING' },
                            { id: 'title', label: 'A-Z' },
                            { id: 'anime', label: 'ANIME' }
                          ].map(criterion => (
                            <button
                              key={criterion.id}
                              onClick={() => {
                                setQueueSort(criterion.id as any);
                                toast.message(`Sorted active queue by: ${criterion.label}`);
                              }}
                              className={`px-1.5 py-0.5 text-[7px] font-black font-mono uppercase tracking-tighter rounded-md transition-all ${queueSort === criterion.id ? 'bg-[#FF3D2E]/20 text-[#FF3D2E]' : 'text-zinc-500 hover:text-zinc-400'}`}
                            >
                              {criterion.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Playable queue items scrollable list */}
                    <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-900 max-h-[220px] md:max-h-none p-2 space-y-1 select-none">
                      {filteredPlaylist.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-600 font-mono text-[11px] uppercase tracking-widest gap-2">
                          <Music className="w-5 h-5 text-zinc-800" />
                          No Tracks Match Filtering
                        </div>
                      ) : (
                        filteredPlaylist.map((item, sortedIdx) => {
                          const isCurrent = item.originalIndex === playlistIndex;
                          return (
                            <div
                              key={item.id + '-' + sortedIdx}
                              onClick={() => {
                                if (onPlayIndex) {
                                  onPlayIndex(item.originalIndex);
                                  toast.success(`Swapped to track: ${item.title}`);
                                }
                              }}
                              className={`p-1.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${isCurrent ? 'bg-indigo-ink/20 border-indigo-ink/30 text-gold-bright shadow-[0_0_15px_rgba(255, 61, 46,0.05)]' : 'bg-black/40 border-zinc-950 hover:bg-[#0c1219]/60 hover:border-[#2B2319]/30 text-zinc-400'}`}
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                {/* Left slot index or active animation */}
                                <div className="w-4 text-center text-zinc-600 font-mono font-bold text-[11px] shrink-0">
                                  {isCurrent ? (
                                    <span className="text-[#FF3D2E]">▶</span>
                                  ) : (
                                    item.originalIndex + 1
                                  )}
                                </div>

                                <div className="w-7 h-7 bg-zinc-900 rounded overflow-hidden shrink-0 relative border border-white/5">
                                  <img 
                                    src={item.customImageUrl || `https://img.youtube.com/vi/${item.youtubeId}/default.jpg`} 
                                    alt="" 
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                  {isCurrent && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 rounded-full bg-[#FF3D2E]"></div>
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <p className={`font-mono text-[11px] uppercase font-black truncate leading-none ${isCurrent ? 'text-white' : 'text-zinc-200'}`}>
                                    {item.title}
                                  </p>
                                  <p className="text-[11px] text-zinc-500 truncate mt-0.5 uppercase tracking-tighter">
                                    {item.animeName} {item.artist ? `• ${item.artist}` : ""}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
                                <span className="text-zinc-500">ELO</span>
                                <span className={`font-bold ${isCurrent ? 'text-gold-bright' : 'text-zinc-400'}`}>
                                  {Math.round(item.elo || 1200)}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

              </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
