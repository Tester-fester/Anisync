import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Tilt from 'react-parallax-tilt';
import confetti from 'canvas-confetti';
import { Tv, Play, HelpCircle } from '@/utils/icons';
import { AnimeTrack } from '../types';
import { AnimatedCounter } from './AnimatedCounter';
import { WINNER_COLORS } from './gamification/VoteCelebration';

// ─────────────────────────────────────────────────────────────────────────────
// TournamentMatchDuel — Arena-parity 1v1 card UI for the tournament bracket.
//
// This is a self-contained port of ArenaMatchup's 1v1 card stage:
//   • Tilt + glare per card (blue glare on A, rose glare on B)
//   • Mouse-follow spotlight (radial-gradient at cursor)
//   • Select-ring / winner-ring / loser-fade states
//   • Winner-reveal layout animation (winner takes center, loser fades out)
//   • Delayed ELO counter pop (scale [1, 1.4, 1] at 0.6s)
//   • Pop-in VS badge (gradient blue→rose) while in battle phase
//   • Spring tug-of-war vote bar with center divider puck + shockwave ring
//   • Side-colored confetti burst on reveal (uses WINNER_COLORS from VoteCelebration)
//
// All state lives in the parent (TournamentBracket) — this component is a pure
// renderer driven by props. The only internal state is mouse-tracking for the
// spotlight (local to each card, not shared with the parent).
// ─────────────────────────────────────────────────────────────────────────────

// Local copy of the Arena helper — kept here so the Duel is self-contained
// and TournamentBracket.tsx can delete its own copy once the match stage
// JSX moves here.
const CyberBackdrop = ({
  colorClass = 'from-[#FF3D2E]/20',
}: {
  colorClass?: string;
}) => (
  <div className="absolute inset-0 w-full h-full bg-[#0A0805] overflow-hidden pointer-events-none">
    <div
      className={`absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] ${colorClass} via-[#100C0A]/90 to-[#0A0805]`}
    />
    <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#221B13_1px,transparent_1px),linear-gradient(to_bottom,#221B13_1px,transparent_1px)] bg-[size:24px_24px]" />
    <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
    <div className="absolute top-1/4 left-1/4 w-1/2 h-1/2 border border-zinc-800/10 rounded-full animate-[spin_25s_linear_infinite]" />
    <div className="absolute top-4 left-4 w-3 h-3 border-t border-l border-zinc-700/40" />
    <div className="absolute top-4 right-4 w-3 h-3 border-t border-r border-zinc-700/40" />
    <div className="absolute bottom-4 left-4 w-3 h-3 border-b border-l border-zinc-700/40" />
    <div className="absolute bottom-4 right-4 w-3 h-3 border-b border-r border-zinc-700/40" />
  </div>
);

const truncateArtist = (artist: string) => {
  if (!artist) return 'Unknown Artist';
  if (artist.length > 50) return artist.slice(0, 48) + '...';
  return artist;
};

// Exact copy of ArenaMatchup's fireConfettiBurst — same timing, same colors,
// same angles. The spec calls this out as the canonical burst pattern.
function fireConfettiBurst(outcome: 'A' | 'B' | 'draw') {
  const colors = [...WINNER_COLORS[outcome].confetti];
  const isLeftWinner = outcome === 'A';
  const isDraw = outcome === 'draw';
  const originX = isDraw ? 0.5 : isLeftWinner ? 0.25 : 0.75;

  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x: originX, y: 0.6 },
    colors,
    startVelocity: 45,
    gravity: 0.8,
    ticks: 200,
    scalar: 1.1,
    shapes: ['circle', 'square'],
  });

  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: isLeftWinner ? 60 : 120,
      spread: 55,
      origin: { x: isLeftWinner ? 0 : 1, y: 0.7 },
      colors,
      startVelocity: 60,
      gravity: 0.5,
      ticks: 250,
      scalar: 0.9,
    });
  }, 100);

  if (!isDraw) {
    setTimeout(() => {
      confetti({
        particleCount: 50,
        spread: 100,
        startVelocity: 35,
        origin: { x: 0.5, y: 0.5 },
        colors,
        gravity: 0.6,
        ticks: 180,
        scalar: 1.2,
        shapes: ['star', 'circle'],
      });
    }, 250);
  }
}

export interface TournamentMatchDuelProps {
  trackA: AnimeTrack | null;
  trackB: AnimeTrack | null;
  isOnline: boolean;
  hasVoted: boolean;
  votedSide: 'A' | 'B' | null;
  selectedCandidate: 'A' | 'B' | null;
  revealed: boolean;
  winnerSide: 'A' | 'B' | null;
  aVotes: number;
  bVotes: number;
  pulseSide: 'A' | 'B' | null;
  pulseCount: number;
  eloAAfter?: number;
  eloBAfter?: number;
  eloADelta?: number;
  eloBDelta?: number;
  onCardClick: (side: 'A' | 'B', track: AnimeTrack) => void;
  actionsSlotA?: React.ReactNode;
  actionsSlotB?: React.ReactNode;
  onSwipeSelect?: (side: 'A' | 'B' | null) => void;
}

export default function TournamentMatchDuel({
  trackA,
  trackB,
  isOnline,
  hasVoted,
  votedSide,
  selectedCandidate,
  revealed,
  winnerSide,
  aVotes,
  bVotes,
  pulseSide,
  pulseCount,
  eloAAfter,
  eloBAfter,
  eloADelta,
  eloBDelta,
  onCardClick,
  actionsSlotA,
  actionsSlotB,
  onSwipeSelect,
}: TournamentMatchDuelProps) {
  // Per-card mouse-tracking state — drives the spotlight radial gradient.
  const [hoveredCard, setHoveredCard] = useState<'A' | 'B' | null>(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  // ── Reveal-state confetti burst ──
  // Fires once per match when revealed, with side-colored confetti.
  // Replaces the parent's old `lastRevealedMatchId` effect.
  const lastBurstKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!revealed) return;
    const matchKey = `${trackA?.id}_${trackB?.id}`;
    if (lastBurstKeyRef.current === matchKey) return;
    if (!winnerSide) return;
    lastBurstKeyRef.current = matchKey;
    const t = setTimeout(() => fireConfettiBurst(winnerSide), 600);
    return () => clearTimeout(t);
  }, [revealed, winnerSide, trackA?.id, trackB?.id]);

  // Reset burst tracker when the match changes
  useEffect(() => {
    lastBurstKeyRef.current = null;
  }, [trackA?.id, trackB?.id]);

  // Derived reveal flags — mirror Arena's isWinnerReveal / isLoserFading / isDrawFade
  const isWinnerReveal = (side: 'A' | 'B') => revealed && winnerSide === side;
  const isLoserFading = (side: 'A' | 'B') => revealed && winnerSide !== side && winnerSide !== null;
  const isDrawFade = revealed && winnerSide === null;

  // Tug-of-war percentages (used by the built-in vote bar)
  const totalVotes = aVotes + bVotes;
  const pctA = totalVotes === 0 ? 50 : Math.round((aVotes / totalVotes) * 100);
  const pctB = totalVotes === 0 ? 50 : 100 - pctA;

  return (
    <div className="space-y-4">
      {/* ── Spring Tug-of-War Vote Bar ── */}
      {trackA && trackB && (
        <div className="space-y-2.5 p-4 bg-zinc-950/50 border border-zinc-900 rounded-2xl relative select-none">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#FF3D2E]/20 to-transparent" />

          {/* Title & metrics row */}
          <div className="flex justify-between items-center text-[11px] font-mono">
            <span className="font-black text-[#FF3D2E] uppercase tracking-wider flex items-center gap-1.5 min-w-0 max-w-[44%] text-left">
              <span className="w-2 h-2 bg-[#FF3D2E] rounded-full shrink-0" />
              <span className="truncate">{trackA.title} ({aVotes})</span>
            </span>
            <span className="text-zinc-600 font-bold uppercase tracking-widest text-center shrink-0 px-2 text-[10px]">
              TUG OF WAR
            </span>
            <span className="font-black text-[#3FA9F5] uppercase tracking-wider text-right flex items-center gap-1.5 justify-end min-w-0 max-w-[44%]">
              <span className="truncate">({bVotes}) {trackB.title}</span>
              <span className="w-2 h-2 bg-[#3FA9F5] rounded-full shrink-0" />
            </span>
          </div>

          {/* Physical animated Tug of War Bar */}
          <div className="tug-bar-container w-full h-10 relative">
            {/* Contender A (Left, Blue) */}
            <motion.div
              className={`tug-bar-side-a absolute left-0 top-0 bottom-0 h-full flex items-center pl-4 ${pctA === 0 ? 'hidden' : pctA === 100 ? 'rounded-xl' : 'rounded-l-xl border-r-2 border-[#FF3D2E]/60'}`}
              animate={{ width: `${pctA}%` }}
              transition={{ type: 'spring', stiffness: 95, damping: 13 }}
            >
              {pctA >= 15 && (
                <motion.span
                  key={`pctA-${aVotes}`}
                  animate={{ scale: pulseSide === 'A' ? [1, 1.3, 1] : 1 }}
                  transition={{ duration: 0.25 }}
                  className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] font-mono text-[12px] font-black uppercase tracking-widest text-white select-none"
                >
                  {pctA}%
                </motion.span>
              )}
            </motion.div>

            {/* Contender B (Right, Red) */}
            <motion.div
              className={`tug-bar-side-b absolute right-0 top-0 bottom-0 h-full flex items-center justify-end pr-4 ${pctB === 0 ? 'hidden' : pctB === 100 ? 'rounded-xl' : 'rounded-r-xl border-l-2 border-[#3FA9F5]/60'}`}
              animate={{ width: `${pctB}%` }}
              transition={{ type: 'spring', stiffness: 95, damping: 13 }}
            >
              {pctB >= 15 && (
                <motion.span
                  key={`pctB-${bVotes}`}
                  animate={{ scale: pulseSide === 'B' ? [1, 1.3, 1] : 1 }}
                  transition={{ duration: 0.25 }}
                  className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] font-mono text-[12px] font-black uppercase tracking-widest text-white select-none"
                >
                  {pctB}%
                </motion.span>
              )}
            </motion.div>

            {/* Center divider puck */}
            {pctA > 0 && pctA < 100 && (
              <motion.div
                className="absolute top-0 bottom-0 w-1.5 bg-white border border-zinc-200 shadow-[0_0_20px_#ffffff] z-10 rounded-full"
                animate={{
                  left: `${pctA}%`,
                  x: '-50%',
                  scaleY: pulseCount > 0 ? [1, 1.4, 0.95, 1] : 1,
                  scaleX: pulseCount > 0 ? [1, 0.75, 1.1, 1] : 1,
                }}
                transition={{
                  left: { type: 'spring', stiffness: 95, damping: 13 },
                  scaleY: { duration: 0.28, ease: 'easeOut' },
                  scaleX: { duration: 0.28, ease: 'easeOut' },
                }}
              />
            )}

            {/* Dynamic shockwave blast rings */}
            <AnimatePresence>
              {pulseCount > 0 && (
                <motion.div
                  key={`pulse-${pulseCount}`}
                  initial={{ left: `${pctA}%`, x: '-50%', scale: 0.4, opacity: 0.8 }}
                  animate={{ scale: [1, 2.5], opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className={`absolute top-0 bottom-0 w-8 pointer-events-none rounded-full z-0 ${
                    pulseSide === 'A'
                      ? 'border border-[#FF3D2E]/60 shadow-[0_0_15px_rgba(255, 61, 46,0.4)]'
                      : 'border border-[#3FA9F5]/60 shadow-[0_0_15px_rgba(63, 169, 245,0.4)]'
                  }`}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── 1v1 Card Stage ── */}
      <motion.div
        className="relative flex flex-col md:flex-row w-full h-[460px] md:h-[520px] lg:h-[60vh] max-h-[640px] gap-2 md:gap-4 items-stretch rounded-2xl bg-[#100C0A] p-2 md:p-4 border border-[#2B2319] shadow-2xl overflow-visible"
        onPanEnd={(_, info) => {
          if (!hasVoted && (isOnline ? !revealed : true)) {
            if (info.offset.x > 80) onSwipeSelect?.('B');
            else if (info.offset.x < -80) onSwipeSelect?.('A');
          }
        }}
      >
        {/* Gradient mesh background */}
        <div className="gradient-mesh-bg rounded-2xl" />

        {/* ── Pop-in VS Badge (battle phase only) ── */}
        <AnimatePresence>
          {!revealed && !hasVoted && (!isOnline || !revealed) && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-12 h-12 md:w-16 md:h-16 flex items-center justify-center"
            >
              <div className="absolute inset-0 rounded-full bg-[#FFB800] flex items-center justify-center border-4 border-[#100C0A] shadow-2xl select-none">
                <div className="absolute inset-0 rounded-full ring-1 ring-[#100C0A]/20 pointer-events-none" />
                <span className="font-display font-black text-[#100C0A] italic text-lg md:text-xl tracking-tighter pointer-events-none">
                  VS
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Card A (Blue) ── */}
        <AnimatePresence>
          {trackA && !isLoserFading('A') && (
            <motion.div
              layout
              className={`h-full ${isWinnerReveal('A') ? 'absolute inset-0 z-30 flex items-center justify-center pointer-events-none' : 'relative flex-1 w-full md:w-1/2 flex items-center justify-center'}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: isDrawFade ? 0 : 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.div
                layout
                className={`relative rounded-xl overflow-visible ${isWinnerReveal('A') ? 'w-full md:w-1/2 h-1/2 md:h-full' : 'w-full h-full'}`}
                animate={{ scale: isWinnerReveal('A') ? 1.1 : 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <Tilt
                  tiltMaxAngleX={isWinnerReveal('A') ? 0 : 6}
                  tiltMaxAngleY={isWinnerReveal('A') ? 0 : 6}
                  glareEnable={!isWinnerReveal('A')}
                  glareMaxOpacity={0.15}
                  glareColor="#FF3D2E"
                  glarePosition="all"
                  scale={1.02}
                  transitionSpeed={1500}
                  className="w-full h-full rounded-xl"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <motion.div
                    role="button"
                    tabIndex={0}
                    aria-label={`Vote for ${trackA?.title || 'track A'}`}
                    aria-pressed={selectedCandidate === 'A'}
                    onClick={() => trackA && onCardClick('A', trackA)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && trackA) {
                        e.preventDefault();
                        onCardClick('A', trackA);
                      }
                    }}
                    onMouseMove={(e) => handleMouseMove(e)}
                    onMouseEnter={() => setHoveredCard('A')}
                    onMouseLeave={() => setHoveredCard(null)}
                    className={`relative group w-full h-full rounded-xl cursor-pointer transition-all duration-300 transform select-none flex flex-col justify-end p-4 md:p-6 active:scale-[0.98] press-feedback ${
                      hasVoted && (isOnline ? false : winnerSide === 'A')
                        ? 'z-40 shadow-[0_0_50px_rgba(255, 61, 46,0.4)]'
                        : isWinnerReveal('A')
                          ? 'ring-4 ring-[#FF3D2E] shadow-[0_0_60px_rgba(255, 61, 46,0.5)] z-10'
                          : isDrawFade
                            ? 'opacity-50 scale-95 blur-[2px]'
                            : hasVoted
                              ? 'opacity-30 grayscale blur-[2px] scale-95'
                              : selectedCandidate === 'A'
                                ? 'ring-4 ring-[#FF3D2E] shadow-[0_0_30px_rgba(255, 61, 46,0.85)] z-10 scale-[1.015]'
                                : selectedCandidate === 'B'
                                  ? 'opacity-40 grayscale-[30%] scale-98 hover:opacity-75'
                                  : 'hover:-translate-y-0.5 hover:ring-2 hover:ring-[#FF3D2E]/50 hover:brightness-125 transition-all duration-300 transform shadow-lg hover:shadow-md'
                    }`}
                  >
                    {/* Mouse-follow spotlight */}
                    {hoveredCard === 'A' && !hasVoted && (
                      <div
                        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 rounded-xl"
                        style={{
                          background: `radial-gradient(circle 220px at ${mousePos.x}% ${mousePos.y}%, rgba(255, 61, 46, 0.15), transparent 85%)`,
                        }}
                      />
                    )}

                    {/* Background image / CyberBackdrop */}
                    <div className="absolute inset-0 z-0 bg-[#100C0A] border-2 border-zinc-900 rounded-xl overflow-hidden">
                      <div className="relative w-full h-full">
                        <CyberBackdrop colorClass="from-[#FF3D2E]/20" />
                        {trackA?.youtubeId && (
                          <img
                            src={
                              trackA.customImageUrl ||
                              `https://img.youtube.com/vi/${trackA.youtubeId}/maxresdefault.jpg`
                            }
                            onError={(e) => {
                              if (
                                !trackA?.customImageUrl ||
                                e.currentTarget.src === trackA?.customImageUrl
                              ) {
                                e.currentTarget.src = `https://img.youtube.com/vi/${trackA?.youtubeId}/hqdefault.jpg`;
                              }
                            }}
                            alt={trackA.title}
                            className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-75 transition-opacity duration-500"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-transparent"></div>
                    </div>

                    {/* Actions menu slot (top-left) */}
                    {actionsSlotA && (
                      <div className="absolute top-4 left-4 z-30">{actionsSlotA}</div>
                    )}

                    {/* "Your Vote Cast" badge (online) */}
                    {hasVoted && isOnline && votedSide === 'A' && (
                      <div className="absolute top-4 right-4 z-15 bg-[#FF3D2E]/20 border border-[#FF3D2E]/50 text-white font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-[0_2px_10px_rgba(255, 61, 46,0.4)] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                        <span>Your Vote Cast</span>
                      </div>
                    )}

                    {/* "Selected Preference" badge (offline, pre-vote) */}
                    {!hasVoted && selectedCandidate === 'A' && (
                      <div className="absolute top-4 right-4 bg-[#FF3D2E] text-zinc-950 font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-lg z-15 flex items-center gap-1.5 border border-[#FF3D2E]">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                        <span>Selected Preference</span>
                      </div>
                    )}

                    {/* Play hint (hover only) */}
                    <div className="absolute top-0 left-0 w-full p-4 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex justify-center">
                      <div className="bg-black/80 backdrop-blur-sm border border-[#FF3D2E]/40 text-[#FF3D2E] px-4 py-1.5 rounded-full font-mono text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-[0_0_15px_rgba(255, 61, 46,0.3)]">
                        <Play className="w-3.5 h-3.5 fill-current" /> SINGLE-CLICK: PLAY | DOUBLE-CLICK: VOTE
                      </div>
                    </div>

                    {/* Track info */}
                    <div className="relative z-10 w-full min-w-0 flex flex-col items-start overflow-hidden">
                      {hasVoted && isOnline && votedSide === 'A' && (
                        <span className="ml-2 mb-2 text-[11px] md:text-[11px] border border-[#FF3D2E]/50 bg-[#FF3D2E]/20 text-white px-2 py-1 rounded-sm font-mono font-bold uppercase shadow-[0_2px_10px_rgba(255, 61, 46,0.4)]">
                          Your Vote Cast
                        </span>
                      )}

                      <div className="flex justify-start w-full min-w-0 pr-4 mt-2">
                        <h3 className="font-display font-black text-2xl md:text-4xl text-white leading-none uppercase tracking-tight truncate drop-shadow-lg">
                          {trackA.title}
                        </h3>
                      </div>
                      <div className="flex justify-start w-full min-w-0 mt-1 md:mt-2 pr-4">
                        <p className="text-[#FF3D2E]/80 text-sm md:text-lg italic drop-shadow-md font-bold truncate">
                          {truncateArtist(trackA.artist)}
                        </p>
                      </div>
                      <div className="flex justify-start w-full min-w-0 mt-2 pr-4">
                        <p className="text-zinc-400 text-[11px] md:text-xs font-mono font-black flex items-center gap-1 md:gap-1.5 uppercase tracking-wider bg-black/50 w-fit max-w-full px-2.5 py-1 md:px-3 md:py-1.5 rounded backdrop-blur-md border border-white/5 shadow-inner">
                          <Tv className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#FF3D2E] shrink-0" />
                          <span className="truncate">{trackA.animeName}</span>
                        </p>
                      </div>

                      {/* Delayed ELO counter pop on reveal */}
                      {hasVoted && !isOnline && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.6, duration: 0.4 }}
                          className="mt-4 text-white font-mono flex items-baseline gap-2 relative"
                        >
                          <span className="text-[11px] md:text-[11px] uppercase text-[#FF3D2E] font-bold">
                            New Elo
                          </span>
                          <motion.span
                            initial={{ scale: 1 }}
                            animate={{ scale: [1, 1.4, 1] }}
                            transition={{ delay: 0.6, duration: 0.5 }}
                            className="text-2xl md:text-3xl font-black text-[#FF3D2E]"
                          >
                            <AnimatedCounter
                              value={Math.round(eloAAfter ?? trackA.elo ?? 1200)}
                              direction="up"
                              playTickSound={true}
                            />
                          </motion.span>
                          {winnerSide === 'A' && eloADelta !== undefined && (
                            <div className="text-sm font-black text-[#FF3D2E] pointer-events-none">
                              +{eloADelta}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </Tilt>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Card B (Rose) ── */}
        <AnimatePresence>
          {trackB && !isLoserFading('B') && (
            <motion.div
              layout
              className={`h-full ${isWinnerReveal('B') ? 'absolute inset-0 z-30 flex items-center justify-center pointer-events-none' : 'relative flex-1 w-full md:w-1/2 flex items-center justify-center'}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: isDrawFade ? 0 : 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.div
                layout
                className={`relative rounded-xl overflow-visible ${isWinnerReveal('B') ? 'w-full md:w-1/2 h-1/2 md:h-full' : 'w-full h-full'}`}
                animate={{ scale: isWinnerReveal('B') ? 1.1 : 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <Tilt
                  tiltMaxAngleX={isWinnerReveal('B') ? 0 : 6}
                  tiltMaxAngleY={isWinnerReveal('B') ? 0 : 6}
                  glareEnable={!isWinnerReveal('B')}
                  glareMaxOpacity={0.15}
                  glareColor="#3FA9F5"
                  glarePosition="all"
                  scale={1.02}
                  transitionSpeed={1500}
                  className="w-full h-full rounded-xl"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <motion.div
                    role="button"
                    tabIndex={0}
                    aria-label={`Vote for ${trackB?.title || 'track B'}`}
                    aria-pressed={selectedCandidate === 'B'}
                    onClick={() => trackB && onCardClick('B', trackB)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && trackB) {
                        e.preventDefault();
                        onCardClick('B', trackB);
                      }
                    }}
                    onMouseMove={(e) => handleMouseMove(e)}
                    onMouseEnter={() => setHoveredCard('B')}
                    onMouseLeave={() => setHoveredCard(null)}
                    className={`relative group w-full h-full rounded-xl cursor-pointer transition-all duration-300 transform select-none flex flex-col justify-end p-4 md:p-6 active:scale-[0.98] press-feedback ${
                      hasVoted && (isOnline ? false : winnerSide === 'B')
                        ? 'z-40 shadow-[0_0_50px_rgba(63, 169, 245,0.4)]'
                        : isWinnerReveal('B')
                          ? 'ring-4 ring-[#3FA9F5] shadow-[0_0_60px_rgba(63, 169, 245,0.5)] z-10'
                          : isDrawFade
                            ? 'opacity-50 scale-95 blur-[2px]'
                            : hasVoted
                              ? 'opacity-30 grayscale blur-[2px] scale-95'
                              : selectedCandidate === 'B'
                                ? 'ring-4 ring-[#3FA9F5] shadow-[0_0_30px_rgba(63, 169, 245,0.85)] z-10 scale-[1.015]'
                                : selectedCandidate === 'A'
                                  ? 'opacity-40 grayscale-[30%] scale-98 hover:opacity-75'
                                  : 'hover:-translate-y-0.5 hover:ring-2 hover:ring-[#3FA9F5]/50 hover:brightness-125 transition-all duration-300 transform shadow-lg hover:shadow-md'
                    }`}
                  >
                    {/* Mouse-follow spotlight */}
                    {hoveredCard === 'B' && !hasVoted && (
                      <div
                        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 rounded-xl"
                        style={{
                          background: `radial-gradient(circle 220px at ${mousePos.x}% ${mousePos.y}%, rgba(63, 169, 245, 0.18), transparent 85%)`,
                        }}
                      />
                    )}

                    {/* Background image / CyberBackdrop */}
                    <div className="absolute inset-0 z-0 bg-[#100C0A] border-2 border-zinc-900 rounded-xl overflow-hidden">
                      <div className="relative w-full h-full">
                        <CyberBackdrop colorClass="from-[#3FA9F5]/25" />
                        {trackB?.youtubeId && (
                          <img
                            src={
                              trackB.customImageUrl ||
                              `https://img.youtube.com/vi/${trackB.youtubeId}/maxresdefault.jpg`
                            }
                            onError={(e) => {
                              if (
                                !trackB?.customImageUrl ||
                                e.currentTarget.src === trackB?.customImageUrl
                              ) {
                                e.currentTarget.src = `https://img.youtube.com/vi/${trackB?.youtubeId}/hqdefault.jpg`;
                              }
                            }}
                            alt={trackB.title}
                            className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-75 transition-opacity duration-500"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-transparent"></div>
                    </div>

                    {/* Actions menu slot (top-right) */}
                    {actionsSlotB && (
                      <div className="absolute top-4 right-4 z-30">{actionsSlotB}</div>
                    )}

                    {/* "Your Vote Cast" badge (online) */}
                    {hasVoted && isOnline && votedSide === 'B' && (
                      <div className="absolute top-4 left-4 z-15 bg-[#3FA9F5]/20 border border-[#3FA9F5]/50 text-white font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-[0_2px_10px_rgba(63, 169, 245,0.4)] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        <span>Your Vote Cast</span>
                      </div>
                    )}

                    {/* "Selected Preference" badge (offline, pre-vote) */}
                    {!hasVoted && selectedCandidate === 'B' && (
                      <div className="absolute top-4 left-4 bg-[#3FA9F5] text-white font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-lg z-15 flex items-center gap-1.5 border border-[#3FA9F5]">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        <span>Selected Preference</span>
                      </div>
                    )}

                    {/* Play hint */}
                    <div className="absolute top-0 left-0 w-full p-4 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex justify-center">
                      <div className="bg-black/80 backdrop-blur-sm border border-[#3FA9F5]/40 text-[#3FA9F5] px-4 py-1.5 rounded-full font-mono text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-[0_0_15px_rgba(63, 169, 245,0.3)]">
                        <Play className="w-3.5 h-3.5 fill-current" /> SINGLE-CLICK: PLAY | DOUBLE-CLICK: VOTE
                      </div>
                    </div>

                    {/* Track info */}
                    <div className="relative z-10 text-right ms-auto flex flex-col items-end w-full min-w-0 overflow-hidden">
                      {hasVoted && isOnline && votedSide === 'B' && (
                        <span className="mr-2 mb-2 text-[11px] md:text-[11px] border border-[#3FA9F5]/50 bg-[#3FA9F5]/20 text-white px-2 py-1 rounded-sm font-mono font-bold uppercase shadow-[0_2px_10px_rgba(63, 169, 245,0.4)]">
                          Your Vote Cast
                        </span>
                      )}

                      <div className="flex justify-end w-full min-w-0 pl-4 mt-2">
                        <h3 className="font-display font-black text-2xl md:text-4xl text-white leading-none uppercase tracking-tight truncate drop-shadow-lg text-right">
                          {trackB.title}
                        </h3>
                      </div>
                      <div className="flex justify-end w-full min-w-0 mt-1 md:mt-2 pl-4">
                        <p className="text-[#3FA9F5]/80 text-sm md:text-lg italic drop-shadow-md font-bold text-right truncate">
                          {truncateArtist(trackB.artist)}
                        </p>
                      </div>
                      <div className="flex justify-end w-full min-w-0 mt-2 pl-4">
                        <p className="text-zinc-400 text-[11px] md:text-xs font-mono font-black flex items-center justify-end gap-1 md:gap-1.5 uppercase tracking-wider bg-black/50 w-fit max-w-full ml-auto px-2.5 py-1 md:px-3 md:py-1.5 rounded backdrop-blur-md border border-white/5 shadow-inner">
                          <span className="truncate">{trackB.animeName}</span>
                          <Tv className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#3FA9F5] shrink-0" />
                        </p>
                      </div>

                      {/* Delayed ELO counter pop */}
                      {hasVoted && !isOnline && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.6, duration: 0.4 }}
                          className="mt-4 text-white font-mono flex items-baseline justify-end gap-2 relative w-full"
                        >
                          <motion.span
                            initial={{ scale: 1 }}
                            animate={{ scale: [1, 1.4, 1] }}
                            transition={{ delay: 0.6, duration: 0.5 }}
                            className="text-2xl md:text-3xl font-black text-[#3FA9F5]"
                          >
                            <AnimatedCounter
                              value={Math.round(eloBAfter ?? trackB.elo ?? 1200)}
                              direction="up"
                              playTickSound={true}
                            />
                          </motion.span>
                          <span className="text-[11px] md:text-[11px] uppercase text-[#3FA9F5] font-bold">
                            New Elo
                          </span>
                          {winnerSide === 'B' && eloBDelta !== undefined && (
                            <div className="text-sm font-black text-[#3FA9F5] pointer-events-none">
                              +{eloBDelta}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </Tilt>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty-state fallbacks (no track yet) */}
        {!trackA && (
          <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center text-zinc-600 font-mono text-xs select-none uppercase tracking-wider h-full w-full md:w-1/2">
            <HelpCircle className="w-8 h-8 text-zinc-800 animate-pulse mb-2" />
            <span>Waiting for contender A...</span>
          </div>
        )}
        {!trackB && (
          <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center text-zinc-500 font-mono text-xs select-none uppercase tracking-wider h-full w-full md:w-1/2">
            <HelpCircle className="w-8 h-8 text-zinc-800 animate-pulse mb-2" />
            <span>Waiting for contender B...</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
