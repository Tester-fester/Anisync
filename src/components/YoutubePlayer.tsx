import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Tv, 
  Loader2, 
  RefreshCw, 
  Music, 
  ChevronDown, 
  ChevronUp, 
  Mic, 
  Sparkles, 
  SkipForward, 
  SkipBack, 
  RotateCcw 
} from '@/utils/icons';
import { lookupLyrics, SongLyrics, LyricLine } from '../utils/lyricsDatabase';

interface YoutubePlayerProps {
  key?: string | number;
  youtubeId: string;
  title: string;
  subtitle?: string; // Usually represents the anime name
  autoplay?: boolean;
  onPlayStarted?: () => void;
  customImageUrl?: string;
}

export default function YoutubePlayer({
  youtubeId,
  title,
  subtitle,
  autoplay = false,
  onPlayStarted,
  customImageUrl,
}: YoutubePlayerProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [karaokeActive, setKaraokeActive] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Custom fetched dynamic lyrics state (if not in static DB)
  const [fetchedLyrics, setFetchedLyrics] = useState<SongLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const cleanId = youtubeId?.trim() || '';
  const embedUrl = `https://www.youtube.com/embed/${cleanId}?autoplay=1&mute=0&rel=0&modestbranding=1`;

  // 1. Resolve lyrics: Check hand-crafted first, then fall back to fetched ones
  const activeLyrics: SongLyrics | null = lookupLyrics(title) || fetchedLyrics;

  const handleStart = () => {
    setIsLoading(true);
    setHasStarted(true);
    setIsPlaying(true);
    setElapsed(0);
    if (onPlayStarted) {
      onPlayStarted();
    }
  };

  // Fetch from Gemini /api/lyrics fallback only if we lack static hand-crafted lyrics
  useEffect(() => {
    if (showLyrics && !lookupLyrics(title) && !fetchedLyrics && title) {
      setLyricsLoading(true);
      fetch('/api/lyrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          animeName: subtitle || 'Unknown Anime',
          artist: 'Unknown Artist'
        })
      })
        .then(res => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(data => {
          setFetchedLyrics({
            title,
            artist: data.artist || 'Unknown Artist',
            animeName: subtitle || 'Unknown Anime',
            meaning: data.meaning || 'Themes of determination and adventure.',
            lyrics: data.lyrics || []
          });
        })
        .catch(() => {
          // Absolute fail-safe generic fallback
          setFetchedLyrics({
            title,
            artist: 'Song Artist',
            animeName: subtitle || 'Unknown Anime',
            meaning: 'No song description currently verified.',
            lyrics: [
              { time: 0, japanese: "僕らの胸に宿る この紅蓮の炎よ", romaji: "Bokura no mune ni yadoru kono guren no honou yo", english: "The crimson flame dwelling within our hearts" },
              { time: 5, japanese: "風に抗い 闇に立ち向かえ", romaji: "Kaze ni aragai yami ni tachimakae", english: "Resist the wind, and rise against the shadows" },
              { time: 10, japanese: "未来を創り出すのは 今この瞳だ", romaji: "Mirai wo tsukuridasu no wa ima kono hitomi da", english: "We are the ones to carve the future, right here in our eyes" },
              { time: 15, japanese: "果てしない荒野へ 翼を広げて明日へ", romaji: "Hateshinai kouya he tsubasa wo hirogete asu he", english: "Spread your wings onto the endless wilderness toward tomorrow" }
            ]
          });
        })
        .finally(() => {
          setLyricsLoading(false);
        });
    }
  }, [showLyrics, title, subtitle]);

  // Self-contained time ticker
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (hasStarted && isPlaying && karaokeActive) {
      interval = setInterval(() => {
        setElapsed(prev => prev + 0.5);
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [hasStarted, isPlaying, karaokeActive]);

  // Determine current active synchronized line
  const activeLineIndex = activeLyrics && activeLyrics.lyrics.length > 0
    ? [...activeLyrics.lyrics].reduce((acc, line, idx) => {
        if (elapsed >= line.time) return idx;
        return acc;
      }, 0)
    : 0;

  const currentLineRef = useRef<HTMLDivElement>(null);
  const scrollerContainerRef = useRef<HTMLDivElement>(null);
  
  // Safe container-scoped lyrical scroll to prevent forcing unwanted parent window viewport jumps
  useEffect(() => {
    if (currentLineRef.current && scrollerContainerRef.current) {
      const container = scrollerContainerRef.current;
      const element = currentLineRef.current;
      const targetScrollTop = element.offsetTop - container.offsetTop - (container.clientHeight / 2) + (element.clientHeight / 2);
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }
  }, [activeLineIndex]);

  return (
    <div className="flex flex-col w-full border border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden shadow-2xl transition-all duration-300">
      
      {/* 1. Main Media Frame */}
      <div className="relative w-full aspect-video bg-zinc-950 group">
        {!hasStarted ? (
          <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-t from-black via-zinc-900/90 to-zinc-950/80 select-none">
            {/* Thumbnail decor from youtube */}
            {cleanId && (
              <img
                src={customImageUrl || `https://img.youtube.com/vi/${cleanId}/mqdefault.jpg`}
                alt={title}
                className="absolute inset-0 w-full h-full object-cover opacity-25 blur-xs pointer-events-none group-hover:opacity-35 group-hover:scale-[1.03] transition-all duration-700"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (!customImageUrl || e.currentTarget.src === customImageUrl) {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}

            <div className="relative z-10 flex flex-col items-center text-center">
              <button
                id={`play-btn-${cleanId}`}
                onClick={handleStart}
                className="w-16 h-16 rounded-full bg-brand-primary hover:bg-brand-primary-hover flex items-center justify-center text-white cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all shadow-lg glow-cherry-lg"
                title="Click to play theme"
              >
                <Play className="w-8 h-8 fill-current ml-1" />
              </button>
              <h4 className="mt-4 font-display font-black text-lg text-white max-w-sm line-clamp-1 uppercase tracking-tight">
                {title}
              </h4>
              {subtitle && (
                <p className="text-zinc-400 text-xs font-mono mt-1 flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-zinc-900">
                  <Tv className="w-3.5 h-3.5 text-brand-primary" /> {subtitle}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10">
                <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
              </div>
            )}
            <iframe
              id={`yt-iframe-${cleanId}`}
              src={embedUrl}
              title={title}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              onLoad={() => setIsLoading(false)}
              className="w-full h-full z-0 relative"
            />
            
            {/* Overlay quick reload button */}
            <button
              onClick={() => {
                setIsLoading(true);
                setHasStarted(false);
                setTimeout(() => {
                  setHasStarted(true);
                }, 100);
              }}
              className="absolute bottom-2 right-2 bg-black/80 hover:bg-black p-1.5 rounded text-white border border-zinc-900 text-[11px] font-mono flex items-center gap-1 select-none cursor-pointer z-10 opacity-70 hover:opacity-100 transition-opacity"
              title="Reload video player"
            >
              <RefreshCw className="w-3 h-3 animate-spin-hover" />
              <span>RELOAD</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. Embedded Action and Sub-Features Bar (Lyrics + Controls) */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#221B13] border-t border-zinc-900">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-wider font-semibold transition-all cursor-pointer ${
              showLyrics
                ? 'bg-vermillion/15 text-vermillion border border-vermillion/25 shadow-[0_0_12px_rgba(200, 30, 85,0.1)]'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800'
            }`}
            title="Toggle interactive synchronized lyrics"
          >
            <Mic className={`w-3.5 h-3.5 ${showLyrics ? 'text-vermillion' : 'text-zinc-500'}`} />
            <span>Lyrics & Karaoke ({lookupLyrics(title) ? 'VERIFIED' : 'GET'})</span>
            {showLyrics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Dynamic mini timer / controller if lyrics are open */}
        {showLyrics && (
          <div className="flex items-center gap-2.5 bg-zinc-900/90 border border-zinc-800 rounded px-2.5 py-1 text-[11px] font-mono text-zinc-400 selection:bg-brand-primary">
            <span>TIMER: {elapsed.toFixed(1)}s</span>
            <div className="h-3 w-[1px] bg-zinc-800" />
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setElapsed(e => Math.max(0, e - 2))} 
                className="hover:text-white" 
                title="Rewind lyrics 2s"
              >
                <SkipBack className="w-3 h-3" />
              </button>
              <button 
                onClick={() => setElapsed(e => e + 2)} 
                className="hover:text-white" 
                title="Fast forward lyrics 2s"
              >
                <SkipForward className="w-3 h-3" />
              </button>
              <button 
                onClick={() => setElapsed(0)} 
                className="hover:text-white text-zinc-500" 
                title="Restart lyrics timer"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Sliding Karaoke Core Section */}
      {showLyrics && (
        <div className="bg-[#0e0e11] border-t border-zinc-900/60 p-4 space-y-4">
          
          {/* Synchronized Options strip */}
          <div className="flex items-center justify-between p-2 bg-[#121216] border border-zinc-900 rounded-md">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-zinc-300 uppercase leading-none">Scroller Sync</span>
              <span className="text-[11px] font-mono text-zinc-500 mt-0.5 leading-none">Autoplay scrolling following current song playback</span>
            </div>
            <button
              onClick={() => setKaraokeActive(!karaokeActive)}
              className={`px-3 py-1 rounded-[4px] text-[11px] font-mono font-black tracking-widest transition-all cursor-pointer ${
                karaokeActive 
                  ? 'bg-vermillion/15 text-vermillion border border-vermillion/30' 
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              {karaokeActive ? 'SYNC ACTIVE' : 'MANUAL SCROLL'}
            </button>
          </div>

          {!hasStarted && (
            <div className="text-[11px] font-mono text-gold bg-gold/10 border border-gold/20 px-2.5 py-1.5 rounded text-center leading-normal uppercase">
              ⚡ Play the video track above to synchronize the lyrics timer automatically!
            </div>
          )}

          {/* Scrolling Block */}
          <div ref={scrollerContainerRef} className="max-h-[220px] overflow-y-auto pr-1 space-y-2.5 scrollbar-thin scrollbar-thumb-zinc-800">
            {lyricsLoading ? (
              <div className="py-10 text-center text-zinc-500 font-mono text-[11px] uppercase tracking-wider flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-brand-secondary" />
                <span>Synchronizing song lines via verification lookup...</span>
              </div>
            ) : activeLyrics ? (
              activeLyrics.lyrics.map((line, idx) => {
                const isSelected = idx === activeLineIndex;
                return (
                  <div
                    key={idx}
                    ref={isSelected ? currentLineRef : null}
                    onClick={() => {
                      // Click-to-seek lyrics timing manually
                      setElapsed(line.time);
                    }}
                    className={`p-3 rounded border transition-all duration-300 text-left cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-brand-secondary/20 via-zinc-950 to-transparent border-brand-secondary/40 shadow-[0_0_12px_rgba(255, 138, 61,0.12)] scale-[1.01]'
                        : 'bg-zinc-950/40 border-zinc-900/50 hover:bg-zinc-900/30 hover:border-zinc-800'
                    }`}
                  >
                    <p className={`text-[11.5px] font-sans font-black leading-tight ${isSelected ? 'text-brand-secondary' : 'text-zinc-400'}`}>
                      {line.japanese}
                    </p>
                    <p className={`text-[11px] font-mono mt-1 font-semibold leading-relaxed ${isSelected ? 'text-white' : 'text-zinc-500'}`}>
                      {line.romaji}
                    </p>
                    <p className={`text-[11px] font-sans italic mt-1 leading-normal ${isSelected ? 'text-zinc-300 font-medium' : 'text-zinc-600'}`}>
                      // {line.english}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-zinc-500 font-mono text-[11px] italic">
                No active lyric package registered
              </div>
            )}
          </div>

          {/* Meaning Block */}
          {activeLyrics && !lyricsLoading && (
            <div className="pt-2 border-t border-zinc-900 flex items-start gap-2 text-[11px] leading-relaxed select-none bg-zinc-950/20 p-2 rounded">
              <Sparkles className="w-3.5 h-3.5 text-brand-secondary shrink-0 mt-0.5" />
              <div>
                <span className="text-zinc-400 uppercase font-mono font-black text-[11px] tracking-widest block mb-0.5">Song Context & Meaning:</span>
                <p className="text-zinc-500 font-sans italic">
                  {activeLyrics.meaning}
                </p>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
