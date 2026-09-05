import React, { useRef, useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Trophy, 
  Star, 
  Plus, 
  Minus, 
  Crown,
  Maximize2,
  Play,
  ChevronLeft,
  ChevronRight
} from '@/utils/icons';
import { Tournament, AnimeTrack } from '../types';

interface BracketTreeViewProps {
  tournament: Tournament;
  tracks: AnimeTrack[];
  matchesByRound: { num: number; name: string; matches: any[] }[];
  onPlayTrack?: (track: AnimeTrack) => void;
  globalPlayingTrack?: AnimeTrack | null;
}

export default function BracketTreeView({ 
  tournament, 
  tracks, 
  matchesByRound,
  onPlayTrack,
  globalPlayingTrack
}: BracketTreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  // Swipe-and-Pan Container Drag State
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // Sizing constants for pixel-perfect coordinates
  const NODE_WIDTH = 290;
  const NODE_HEIGHT = 124;
  const GAP_X = 90;
  const BASE_Y_SPACING = 160;

  useEffect(() => {
    if (matchesByRound.length > 0) {
      const roundsCount = matchesByRound.length;
      const initialMatchesCount = matchesByRound[0]?.matches.length || 0;
      const heightNeeded = initialMatchesCount * BASE_Y_SPACING + 120;
      const widthNeeded = roundsCount * (NODE_WIDTH + GAP_X) + 120;
      setSvgSize({ width: Math.max(widthNeeded, 850), height: Math.max(heightNeeded, 550) });
    }
  }, [matchesByRound]);

  // Zoom HUD triggers
  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.1, 1.4));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.1, 0.6));
  };

  const handleResetZoom = () => {
    setScale(1);
  };

  // Drag-and-pan handler callbacks
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const target = e.target as HTMLElement;
    // Do not drag if clicking on an interactive card detail or custom control button
    if (target.closest('button') || target.closest('.cursor-pointer') || target.closest('[role="button"]')) {
      return;
    }
    setIsDragging(true);
    setStartX(e.pageX - containerRef.current.offsetLeft);
    setStartY(e.pageY - containerRef.current.offsetTop);
    setScrollLeft(containerRef.current.scrollLeft);
    setScrollTop(containerRef.current.scrollTop);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startX) * 1.5; // Drag sensitivity multiplier
    const walkY = (y - startY) * 1.5;
    containerRef.current.scrollLeft = scrollLeft - walkX;
    containerRef.current.scrollTop = scrollTop - walkY;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  // Safe-margin side scroll helpers
  const scrollBracket = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    const scrollAmount = 400;
    containerRef.current.scrollTo({
      left: containerRef.current.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount),
      behavior: 'smooth'
    });
  };

  // Find standard track Elos or rankings to showcase seeds
  const tracksByElo = useMemo(() => {
    return [...tracks].sort((a, b) => b.elo - a.elo);
  }, [tracks]);

  const getSeedString = (trackId: string) => {
    const idx = tracksByElo.findIndex(t => t.id === trackId);
    if (idx === -1) return '';
    return `#${idx + 1}`;
  };

  return (
    <div className="relative w-full rounded-2xl border border-zinc-900 bg-[#0A0805] shadow-inner overflow-hidden flex flex-col group">
      
      {/* Inline styles for custom active matchup border pulse animation */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes border-pulse {
          0%, 100% {
            border-color: rgba(255, 61, 46, 0.4);
            box-shadow: 0 0 8px rgba(255, 61, 46, 0.15);
          }
          50% {
            border-color: rgba(255, 61, 46, 0.95);
            box-shadow: 0 0 16px rgba(255, 61, 46, 0.45);
          }
        }
        .active-vote-pulse {
          animation: border-pulse 2s infinite ease-in-out;
        }
      `}} />

      {/* Absolute Header Overlay */}
      <div className="absolute top-4 left-4 z-20 flex gap-2" data-html2canvas-ignore="true">
        <span className="px-2.5 py-1 rounded bg-[#221B13] border border-brand-primary/20 text-brand-primary font-mono text-[11px] font-black tracking-widest uppercase flex items-center gap-1 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse shrink-0" />
          Interactive Arena Canvas
        </span>
      </div>

      {/* Outer Safe-Zone Navigation Arrows */}
      <button 
        data-html2canvas-ignore="true"
        onClick={() => scrollBracket('left')}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-neutral-950/70 border border-neutral-800/60 backdrop-blur-md text-zinc-300 hover:text-white hover:bg-neutral-900 shadow-xl transition-all cursor-pointer opacity-0 group-hover:opacity-100 duration-300"
        title="Scroll Left"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button 
        data-html2canvas-ignore="true"
        onClick={() => scrollBracket('right')}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-neutral-950/70 border border-neutral-800/60 backdrop-blur-md text-zinc-300 hover:text-white hover:bg-neutral-900 shadow-xl transition-all cursor-pointer opacity-0 group-hover:opacity-100 duration-300"
        title="Scroll Right"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Repositioned Low-Profile Floating Glass Zoom HUD */}
      <div 
        className="absolute bottom-4 right-4 z-20 bg-neutral-950/40 border border-neutral-800/40 backdrop-blur-sm rounded-full py-1.5 px-3 flex items-center gap-3 text-xs text-neutral-300 shadow-lg select-none"
        data-html2canvas-ignore="true"
      >
        <button 
          onClick={handleZoomOut}
          className="p-1 hover:text-white hover:bg-zinc-800/60 rounded-full transition-all cursor-pointer"
          title="Zoom Out"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-[11px] font-bold px-1 text-zinc-300 w-11 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button 
          onClick={handleZoomIn}
          className="p-1 hover:text-white hover:bg-zinc-800/60 rounded-full transition-all cursor-pointer"
          title="Zoom In"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-3.5 bg-zinc-800/80" />
        <button 
          onClick={handleResetZoom}
          className="p-1 hover:text-white hover:bg-zinc-800/60 rounded-full transition-all cursor-pointer flex items-center gap-1 font-mono text-[11px] font-black uppercase tracking-wider"
          title="Reset Zoom"
        >
          <Maximize2 className="w-3 h-3 text-brand-secondary" />
          Reset
        </button>
      </div>

      {/* Main Scrolled / Drag-and-Pan Surface */}
      <div 
        className="relative w-full h-[620px] overflow-auto custom-scrollbar bg-gradient-to-br from-[#0A0805] via-[#0A0805] to-[#0A0805] p-6 cursor-grab active:cursor-grabbing select-none" 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
      >
        <div 
          className="relative" 
          style={{ 
            width: svgSize.width * scale, 
            height: svgSize.height * scale, 
            minWidth: '100%', 
            minHeight: '100%' 
          }}
        >
          {/* Inner transformation hub with smooth hardware-accelerated transitions */}
          <div 
            style={{ 
              transform: `scale(${scale})`, 
              transformOrigin: '0 0',
              transition: 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              width: svgSize.width,
              height: svgSize.height
            }}
            className="absolute inset-x-0 top-0"
          >
            {/* SVG Connection Lines Wrapper with visible overflow */}
            <svg 
              className="absolute inset-0 pointer-events-none w-full h-full overflow-visible" 
              style={{ zIndex: 1 }}
            >
              {matchesByRound.map((round, rIndex) => {
                if (rIndex === matchesByRound.length - 1) return null; // Finals end node has no outwards path
                
                return round.matches.map((match, mIndex) => {
                  const nextRoundIndex = rIndex + 1;
                  const nextRoundMatches = matchesByRound[nextRoundIndex]?.matches;
                  if (!nextRoundMatches) return null;
                  
                  const nextMatchIndex = Math.floor(mIndex / 2);
                  
                  // Coordinate geometry math for pixel-perfect card linkages
                  const ySpacing = BASE_Y_SPACING * Math.pow(2, rIndex);
                  const startYOffset = ySpacing / 2;
                  
                  const currentX = 40 + rIndex * (NODE_WIDTH + GAP_X) + NODE_WIDTH;
                  const currentY = 120 + startYOffset + mIndex * ySpacing;
                  
                  const nextYSpacing = BASE_Y_SPACING * Math.pow(2, nextRoundIndex);
                  const nextStartYOffset = nextYSpacing / 2;
                  const nextX = 40 + nextRoundIndex * (NODE_WIDTH + GAP_X);
                  const nextY = 120 + nextStartYOffset + nextMatchIndex * nextYSpacing;
                  
                  const controlPointX = currentX + GAP_X / 2;

                  // High-Performance State-Driven connectors
                  const targetWinnerId = match.winnerId;
                  const isLineActiveCompleted = targetWinnerId !== undefined && targetWinnerId !== null;
                  
                  const isCurrentActiveRound = tournament.currentRound === round.num;
                  const isCurrentlyActiveMatchPath = isCurrentActiveRound && tournament.currentMatchIndex === match.matchIndex;
                  const isPathToFinal = nextRoundIndex === matchesByRound.length - 1;

                  let strokeClass = "stroke-neutral-800";
                  if (isLineActiveCompleted) {
                    strokeClass = isPathToFinal ? "stroke-gold" : "stroke-vermillion";
                  } else if (isCurrentlyActiveMatchPath) {
                    strokeClass = "stroke-vermillion/60 animate-pulse";
                  }

                  let dropShadowClass = "";
                  if (isLineActiveCompleted) {
                    dropShadowClass = isPathToFinal 
                      ? "drop-shadow-[0_0_8px_rgba(255, 138, 61,0.5)]" 
                      : "drop-shadow-[0_0_8px_rgba(255, 61, 46,0.45)]";
                  } else if (isCurrentlyActiveMatchPath) {
                    dropShadowClass = "drop-shadow-[0_0_6px_rgba(255, 61, 46,0.3)]";
                  }

                  return (
                    <g key={`flowline-${match.id}`}>
                      {/* Premium solid Cubic Bezier connection curve */}
                      <path
                        d={`M ${currentX} ${currentY} C ${controlPointX} ${currentY}, ${controlPointX} ${nextY}, ${nextX} ${nextY}`}
                        fill="none"
                        className={`transition-all duration-300 stroke-2 ${strokeClass} ${dropShadowClass}`}
                      />
                    </g>
                  );
                });
              })}
            </svg>

            {/* Visual Node Rectangles Layer */}
            {matchesByRound.map((round, rIndex) => {
              const ySpacing = BASE_Y_SPACING * Math.pow(2, rIndex);
              const startYOffset = ySpacing / 2;
              
              return round.matches.map((match, mIndex) => {
                const x = 40 + rIndex * (NODE_WIDTH + GAP_X);
                const y = 120 + startYOffset + mIndex * ySpacing - NODE_HEIGHT / 2;

                const hasA = match.trackAId !== undefined;
                const hasB = match.trackBId !== undefined;
                const aTrackObj = tracks.find(t => t.id === match.trackAId);
                const bTrackObj = tracks.find(t => t.id === match.trackBId);
                
                const isActiveMatch = tournament.currentRound === round.num && tournament.currentMatchIndex === match.matchIndex;
                const isWinnerDeclared = match.winnerId !== undefined && match.winnerId !== null;
                const isA_Winner = isWinnerDeclared && match.winnerId === match.trackAId;
                const isB_Winner = isWinnerDeclared && match.winnerId === match.trackBId;
                const isA_Loser = isWinnerDeclared && match.winnerId !== match.trackAId;
                const isB_Loser = isWinnerDeclared && match.winnerId !== match.trackBId;

                const isChampionNode = isWinnerDeclared && rIndex === matchesByRound.length - 1;

                // Votes aggregations
                const votesA = match.votes ? Object.values(match.votes).filter(v => v === 'A').length : (match.votesA || 0);
                const votesB = match.votes ? Object.values(match.votes).filter(v => v === 'B').length : (match.votesB || 0);
                const totalVotes = votesA + votesB;
                const pctA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 0;
                const pctB = totalVotes > 0 ? Math.round((votesB / totalVotes) * 100) : 0;

                const isPlayableA = hasA && aTrackObj;
                const isPlayableB = hasB && bTrackObj;

                // Check active audio playing node inside list
                const isPlayingA = globalPlayingTrack && isPlayableA && globalPlayingTrack.id === aTrackObj.id;
                const isPlayingB = globalPlayingTrack && isPlayableB && globalPlayingTrack.id === bTrackObj.id;

                return (
                  <motion.div
                    key={`matchnode-${match.id}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: Math.min(rIndex * 0.05, 0.4) }}
                    style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT, zIndex: 10 }}
                    className={`absolute flex flex-col justify-between rounded-xl p-3 select-none border transition-all duration-300 ${
                      isActiveMatch 
                        ? 'bg-neutral-950/85 border-vermillion/50 backdrop-blur-md shadow-[0_0_15px_rgba(255, 61, 46,0.25)] active-vote-pulse scale-[1.015]' 
                        : isChampionNode
                          ? 'bg-[#15110a]/95 border-gold/80 backdrop-blur-md shadow-[0_0_25px_rgba(255, 138, 61,0.25)]'
                          : 'bg-neutral-950/85 border border-neutral-800/60 backdrop-blur-md shadow-lg hover:border-neutral-700/60'
                    }`}
                  >
                    
                    {/* Champion Crown Overlay */}
                    {isChampionNode && (
                      <div className="absolute -top-4 right-1.5 text-gold filter drop-shadow-[0_0_10px_rgba(255, 138, 61,0.5)] z-20">
                        <Crown className="w-7 h-7 fill-gold animate-[bounce_2s_infinite]" />
                      </div>
                    )}

                    {/* Nodes Contenders Body */}
                    <div className="flex flex-col gap-1.5 h-full justify-center">
                      
                      {/* CONTENDER A ROW */}
                      <div 
                        onClick={() => isPlayableA && onPlayTrack?.(aTrackObj)}
                        className={`group/row flex items-center justify-between rounded-lg p-1.5 transition-all relative overflow-hidden ${
                          isPlayableA ? 'cursor-pointer' : 'cursor-default'
                        } ${
                          isA_Winner 
                            ? 'bg-moss/10 border border-moss/20 text-moss font-bold' 
                            : isA_Loser 
                              ? 'opacity-40 brightness-75 border border-transparent' 
                              : 'bg-black/20 hover:bg-zinc-900/40 text-neutral-300 border border-transparent hover:border-neutral-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isPlayableA ? (
                            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 relative bg-zinc-900 border border-neutral-850 shadow-sm flex items-center justify-center">
                              <img 
                                src={aTrackObj.customImageUrl || `https://i.ytimg.com/vi/${aTrackObj.youtubeId}/mqdefault.jpg`} 
                                alt="" 
                                className="w-full h-full object-cover transition-transform duration-300 group-hover/row:scale-110"
                                referrerPolicy="no-referrer"
                              />
                              {/* Audio waves visual animation */}
                              {isPlayingA ? (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                  <div className="flex items-center gap-0.5 h-4 px-1 shrink-0">
                                    {[0, 1, 2].map((idx) => (
                                      <motion.span
                                        key={idx}
                                        animate={{ height: ["4px", "14px", "4px"] }}
                                        transition={{
                                          duration: 0.5,
                                          repeat: Infinity,
                                          delay: idx * 0.12,
                                          ease: "easeInOut"
                                        }}
                                        className="w-0.5 bg-gold-bright rounded-full"
                                      />
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center justify-center">
                                  <Play className="w-3.5 h-3.5 text-white fill-white" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-neutral-900/80 border border-neutral-800/80 shrink-0 flex items-center justify-center text-neutral-600 font-mono text-[11px]">
                              TBD
                            </div>
                          )}

                          <div className="flex flex-col min-w-0 flex-1 leading-normal text-left">
                            <div className="flex items-center gap-1 min-w-0">
                              {hasA && aTrackObj && (
                                <span className="text-xs text-neutral-500 font-mono shrink-0">
                                  {getSeedString(aTrackObj.id)}
                                </span>
                              )}
                              <span className="truncate text-xs font-bold text-neutral-200 max-w-[140px] block" title={aTrackObj?.title}>
                                {isPlayableA ? aTrackObj.title : 'Contender TBD'}
                              </span>
                            </div>
                            {isPlayableA && (
                              <span className="truncate text-[11px] text-neutral-500 font-mono" title={aTrackObj?.animeName}>
                                {aTrackObj.animeName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Votes & metadata rating breakdown */}
                        <div className="flex items-center gap-1.5 font-mono text-xs shrink-0 font-bold ml-2">
                          {isA_Winner && <Star className="w-3.5 h-3.5 text-gold-bright fill-gold-bright shrink-0 animate-pulse" />}
                          {totalVotes > 0 && isPlayableA && (
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                              isA_Winner 
                                ? 'bg-moss/20 text-moss' 
                                : 'bg-neutral-900/60 text-neutral-500'
                            }`}>
                              {votesA} ({pctA}%)
                            </span>
                          )}
                          {!isWinnerDeclared && isPlayableA && (
                            <span className="text-xs text-neutral-500 font-mono px-1 select-none">
                              {aTrackObj.elo}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* CONTENDER B ROW */}
                      <div 
                        onClick={() => isPlayableB && onPlayTrack?.(bTrackObj)}
                        className={`group/row flex items-center justify-between rounded-lg p-1.5 transition-all relative overflow-hidden ${
                          isPlayableB ? 'cursor-pointer' : 'cursor-default'
                        } ${
                          isB_Winner 
                            ? 'bg-moss/10 border border-moss/20 text-moss font-bold' 
                            : isB_Loser 
                              ? 'opacity-40 brightness-75 border border-transparent' 
                              : 'bg-black/20 hover:bg-zinc-900/40 text-neutral-300 border border-transparent hover:border-neutral-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isPlayableB ? (
                            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 relative bg-zinc-900 border border-neutral-850 shadow-sm flex items-center justify-center">
                              <img 
                                src={bTrackObj.customImageUrl || `https://i.ytimg.com/vi/${bTrackObj.youtubeId}/mqdefault.jpg`} 
                                alt="" 
                                className="w-full h-full object-cover transition-transform duration-300 group-hover/row:scale-110"
                                referrerPolicy="no-referrer"
                              />
                              {/* Audio waves visual animation */}
                              {isPlayingB ? (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                  <div className="flex items-center gap-0.5 h-4 px-1 shrink-0">
                                    {[0, 1, 2].map((idx) => (
                                      <motion.span
                                        key={idx}
                                        animate={{ height: ["4px", "14px", "4px"] }}
                                        transition={{
                                          duration: 0.5,
                                          repeat: Infinity,
                                          delay: idx * 0.12,
                                          ease: "easeInOut"
                                        }}
                                        className="w-0.5 bg-gold-bright rounded-full"
                                      />
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center justify-center">
                                  <Play className="w-3.5 h-3.5 text-white fill-white" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-neutral-900/80 border border-neutral-800/80 shrink-0 flex items-center justify-center text-neutral-600 font-mono text-[11px]">
                              TBD
                            </div>
                          )}

                          <div className="flex flex-col min-w-0 flex-1 leading-normal text-left">
                            <div className="flex items-center gap-1 min-w-0">
                              {hasB && bTrackObj && (
                                <span className="text-xs text-neutral-500 font-mono shrink-0">
                                  {getSeedString(bTrackObj.id)}
                                </span>
                              )}
                              <span className="truncate text-xs font-bold text-neutral-200 max-w-[140px] block" title={bTrackObj?.title}>
                                {isPlayableB ? bTrackObj.title : 'Contender TBD'}
                              </span>
                            </div>
                            {isPlayableB && (
                              <span className="truncate text-[11px] text-neutral-500 font-mono" title={bTrackObj?.animeName}>
                                {bTrackObj.animeName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Votes & metadata rating breakdown */}
                        <div className="flex items-center gap-1.5 font-mono text-xs shrink-0 font-bold ml-2">
                          {isB_Winner && <Star className="w-3.5 h-3.5 text-gold-bright fill-gold-bright shrink-0 animate-pulse" />}
                          {totalVotes > 0 && isPlayableB && (
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                              isB_Winner 
                                ? 'bg-moss/20 text-moss' 
                                : 'bg-neutral-900/60 text-neutral-500'
                            }`}>
                              {votesB} ({pctB}%)
                            </span>
                          )}
                          {!isWinnerDeclared && isPlayableB && (
                            <span className="text-xs text-neutral-500 font-mono px-1 select-none">
                              {bTrackObj.elo}
                            </span>
                          )}
                        </div>
                      </div>

                    </div>
                  </motion.div>
                );
              });
            })}

            {/* Stage / Round names headers positioned meticulously above */}
            {matchesByRound.map((round, rIndex) => {
              const x = 40 + rIndex * (NODE_WIDTH + GAP_X) + NODE_WIDTH / 2;
              return (
                <div 
                  key={`stage-label-${round.num}`}
                  style={{ left: x, top: 40, transform: 'translateX(-50%)' }}
                  className="absolute font-mono text-[11px] font-black uppercase text-neutral-500 tracking-[0.25em] flex items-center gap-1.5 pb-2 border-b border-zinc-900 w-[240px] justify-center select-none"
                >
                  <Trophy className="w-3.5 h-3.5 text-neutral-600" />
                  {round.name}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
