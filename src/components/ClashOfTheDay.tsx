import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { AnimeTrack, UserAccount } from '../types';
import { Swords, CheckCircle2 } from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { calculateNewRatings } from '../utils/elo';
import { safeGetJSON, safeSetJSON } from '../utils/safeLocalStorage';

// ─────────────────────────────────────────────────────────────────────────────
// ClashOfTheDay — direct in-card voting (no ArenaMatchup redirect).
//
// Restyled to match the app design system (zinc surfaces, vermillion (A) vs
// azure (B) contenders — same side colors as Arena/Tournament, mono stat chips). Logic is unchanged:
//   • Two high-ELO tracks per day (deterministic by day-of-year).
//   • Matchup cached in localStorage so refreshes / ELO drift don't
//     reshuffle contenders mid-day.
//   • Vote flows through `onVote` → same batched Firestore path as Arena.
//   • Clicking anywhere else on the card plays the track via GlobalPlayer.
//   • Locked for the rest of the day after voting.
//
// Card shows: type badge, ELO chip, title, artist · anime, vote button.
// ─────────────────────────────────────────────────────────────────────────────

interface ClashOfTheDayProps {
  tracks: AnimeTrack[];
  currentUser?: UserAccount | null;
  onVote: (
    trackAId: string,
    trackBId: string,
    outcome: 'A' | 'B' | 'draw',
    ratingChanges: {
      aBefore: number;
      aAfter: number;
      bBefore: number;
      bAfter: number;
      changeA: number;
      changeB: number;
    },
  ) => void;
  onPlay: (track: AnimeTrack) => void;
  voterCoefficient?: number;
  hasPlayedToday?: boolean;
}

interface CachedClash {
  date: string;            // YYYY-MM-DD — used to invalidate the cache daily
  trackAId: string;
  trackBId: string;
  userVote: 'A' | 'B' | null; // the side the local user voted for (or null)
}

const CLASH_CACHE_KEY = 'anisync_clash_of_the_day';

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function hoursUntilReset(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0); // next local midnight
  return Math.max(0, Math.floor((tomorrow.getTime() - now.getTime()) / (1000 * 60 * 60)));
}

function minutesUntilReset(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return Math.max(0, Math.floor(((tomorrow.getTime() - now.getTime()) % (1000 * 60 * 60)) / (1000 * 60)));
}

export default function ClashOfTheDay({
  tracks,
  currentUser,
  onVote,
  onPlay,
  voterCoefficient = 1.0,
  hasPlayedToday = false,
}: ClashOfTheDayProps) {
  const [justVotedSide, setJustVotedSide] = useState<'A' | 'B' | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  // Keep the countdown fresh — one cheap re-render per minute instead of a
  // timer that's frozen at whatever the last render happened to show.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Day-based matchup selection (deterministic per day) ──────────────
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  const diff = new Date().getTime() - startOfYear.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  const topTracks = useMemo(
    () =>
      [...tracks]
        .sort((a, b) => b.elo - a.elo)
        .slice(0, Math.max(10, Math.floor(tracks.length * 0.2))),
    [tracks],
  );

  const pickMatchup = useCallback((): { trackA: AnimeTrack; trackB: AnimeTrack } | null => {
    if (tracks.length < 2 || topTracks.length < 2) return null;

    const trackA = topTracks[dayOfYear % topTracks.length];
    if (!trackA) return null;

    const sameTypeContenders = topTracks.filter(
      (t) => t.id !== trackA.id && t.type === trackA.type,
    );
    let finalTrackB: AnimeTrack | undefined;
    if (sameTypeContenders.length > 0) {
      finalTrackB = sameTypeContenders[(dayOfYear + 5) % sameTypeContenders.length];
    } else {
      const fallbackContenders = tracks.filter(
        (t) => t.id !== trackA.id && t.type === trackA.type,
      );
      if (fallbackContenders.length > 0) {
        finalTrackB = fallbackContenders[(dayOfYear + 5) % fallbackContenders.length];
      } else {
        const candidate = topTracks[(dayOfYear + 5) % topTracks.length];
        finalTrackB =
          candidate && candidate.id !== trackA.id
            ? candidate
            : topTracks[(dayOfYear + 1) % topTracks.length];
      }
    }
    if (!finalTrackB) return null;
    return { trackA, trackB: finalTrackB };
  }, [tracks, topTracks, dayOfYear]);

  // ── Cache hydration / matchup stabilization ──────────────────────────
  const initial = useMemo(() => {
    const today = todayKey();
    const cached = safeGetJSON<CachedClash | null>(CLASH_CACHE_KEY, null);
    const fresh = pickMatchup();
    if (!fresh) return null;

    if (cached && cached.date === today) {
      const a = tracks.find((t) => t.id === cached.trackAId) ?? fresh.trackA;
      const b = tracks.find((t) => t.id === cached.trackBId) ?? fresh.trackB;
      return { trackA: a, trackB: b, cached };
    }
    return {
      trackA: fresh.trackA,
      trackB: fresh.trackB,
      cached: {
        date: today,
        trackAId: fresh.trackA.id,
        trackBId: fresh.trackB.id,
        userVote: null,
      } as CachedClash,
    };
  }, [pickMatchup, tracks]);

  useEffect(() => {
    if (initial?.cached.date === todayKey()) {
      safeSetJSON(CLASH_CACHE_KEY, initial.cached);
    }
  }, [initial]);

  const [userVote, setUserVote] = useState<'A' | 'B' | null>(
    initial?.cached.userVote ?? null,
  );

  if (!initial) return null;
  const { trackA, trackB } = initial;

  const hasVotedToday = userVote !== null || hasPlayedToday;

  // ── Vote handler — optimistic UI + queue to Firestore via parent ─────
  const handleVote = (side: 'A' | 'B') => {
    if (hasVotedToday || isVoting) return;
    setIsVoting(true);

    const outcome: 'A' | 'B' = side;
    const { newRatingA, newRatingB, changeA, changeB } = calculateNewRatings(
      trackA.elo,
      trackB.elo,
      outcome,
      32,
      voterCoefficient,
    );

    const ratingChanges = {
      aBefore: trackA.elo,
      aAfter: newRatingA,
      bBefore: trackB.elo,
      bAfter: newRatingB,
      changeA,
      changeB,
    };

    setUserVote(side);
    setJustVotedSide(side);

    const today = todayKey();
    const updatedCache: CachedClash = {
      date: today,
      trackAId: trackA.id,
      trackBId: trackB.id,
      userVote: side,
    };
    safeSetJSON(CLASH_CACHE_KEY, updatedCache);

    try {
      onVote(trackA.id, trackB.id, outcome, ratingChanges);
    } catch (err) {
      console.error('[ClashOfTheDay] onVote propagation failed', err);
    }

    setTimeout(() => {
      setIsVoting(false);
      setJustVotedSide(null);
    }, 800);
  };

  const handlePlay = (track: AnimeTrack) => {
    if (isVoting) return;
    onPlay(track);
  };

  return (
    <div className="mb-8 select-none relative bg-[#0A0805] border border-zinc-900 rounded-2xl p-4 sm:p-6 overflow-hidden shadow-2xl shadow-zinc-900/40">
      {/* Subtle grid texture */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(244, 236, 219,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(244, 236, 219,0.5) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* Side auras — vermillion from A's side, azure from B's */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_left,_rgba(255, 61, 46,0.06),_transparent_55%),radial-gradient(ellipse_at_right,_rgba(63, 169, 245,0.06),_transparent_55%)]"
      />

      <div className="relative z-10 font-sans">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 rounded-lg bg-vermillion flex items-center justify-center shadow-lg overflow-hidden">
              <Swords className="w-6 h-6 relative z-10 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl font-display font-black text-vermillion uppercase tracking-tighter leading-none">
                Clash of the Day
              </h3>
              <p className="text-[10px] font-mono text-zinc-500 font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                <span className="inline-block w-1 h-1 rounded-full bg-brand-primary" />
                Tap to preview · Pick a side · Resets in {String(hoursUntilReset()).padStart(2, '0')}h {String(minutesUntilReset()).padStart(2, '0')}m
              </p>
            </div>
          </div>
        </div>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-stretch">
          <ContenderCard
            side="A"
            track={trackA}
            accentClass="vermillion"
            hasVotedToday={hasVotedToday}
            userVote={userVote}
            isVoting={isVoting}
            justVoted={justVotedSide === 'A'}
            onPlay={() => handlePlay(trackA)}
            onVote={() => handleVote('A')}
          />

          {/* VS Badge — solid championship gold, matches Arena */}
          <div className="flex justify-center items-center">
            <div className="relative w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full bg-[#FFB800] border-4 border-[#100C0A] shadow-2xl">
              <span className="font-display font-black text-[#100C0A] italic text-lg sm:text-xl tracking-tighter">VS</span>
            </div>
          </div>

          <ContenderCard
            side="B"
            track={trackB}
            accentClass="azure"
            hasVotedToday={hasVotedToday}
            userVote={userVote}
            isVoting={isVoting}
            justVoted={justVotedSide === 'B'}
            onPlay={() => handlePlay(trackB)}
            onVote={() => handleVote('B')}
          />
        </div>

        {/* Status pill */}
        <div className="mt-6 flex flex-col items-center gap-4">
          {hasVotedToday ? (
            <div className="px-5 py-2 rounded-full bg-brand-secondary/10 border border-brand-secondary/30 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-brand-secondary" />
              <span className="font-mono font-black text-[10px] uppercase tracking-widest text-brand-secondary">
                Daily Clash Completed · Bounty Claimed
              </span>
            </div>
          ) : (
            <p className="text-center text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
              Pick a contender to cast your vote — syncs to the global Arena ladder
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ContenderCard — vermillion (A) vs azure (B) battle card — same side colors
// as ArenaMatchup / TournamentMatchDuel.
// ────────────────────────────────────────────────────────────────────────────

interface ContenderCardProps {
  side: 'A' | 'B';
  track: AnimeTrack;
  accentClass: 'vermillion' | 'azure';
  hasVotedToday: boolean;
  userVote: 'A' | 'B' | null;
  isVoting: boolean;
  justVoted: boolean;
  onPlay: () => void;
  onVote: () => void;
}

function ContenderCard({
  side,
  track,
  accentClass,
  hasVotedToday,
  userVote,
  isVoting,
  justVoted,
  onPlay,
  onVote,
}: ContenderCardProps) {
  const accentMap = {
    vermillion: {
      border: 'border-vermillion/30',
      borderHover: 'hover:border-vermillion/60',
      borderWon: 'border-vermillion',
      ringWon: 'ring-vermillion',
      glow: 'hover:shadow-[0_0_30px_rgba(255, 61, 46,0.25)]',
      glowWon: 'shadow-[0_0_40px_rgba(255, 61, 46,0.3)]',
      text: 'text-vermillion',
      chip: 'border-vermillion/40',
      btn: 'bg-vermillion hover:brightness-110 text-black shadow-[0_4px_14px_rgba(255, 61, 46,0.35)]',
      voteBadge: 'bg-vermillion/90 backdrop-blur-sm text-black',
    },
    azure: {
      border: 'border-indigo-bright/30',
      borderHover: 'hover:border-indigo-bright/60',
      borderWon: 'border-indigo-bright',
      ringWon: 'ring-indigo-bright',
      glow: 'hover:shadow-[0_0_30px_rgba(63, 169, 245,0.25)]',
      glowWon: 'shadow-[0_0_40px_rgba(63, 169, 245,0.3)]',
      text: 'text-indigo-bright',
      chip: 'border-indigo-bright/40',
      btn: 'bg-indigo-bright hover:brightness-110 text-white shadow-[0_4px_14px_rgba(63, 169, 245,0.35)]',
      voteBadge: 'bg-indigo-bright/90 backdrop-blur-sm text-white',
    },
  }[accentClass];

  const isWinner = userVote === side;
  const isLoser = hasVotedToday && userVote !== null && userVote !== side;

  return (
    <motion.div
      className={`relative rounded-xl overflow-hidden h-[260px] flex flex-col justify-end p-4 border transition-all ${
        isWinner
          ? `${accentMap.borderWon} ${accentMap.glowWon}`
          : isLoser
            ? 'border-zinc-800/60 opacity-60'
            : `${accentMap.border} ${accentMap.borderHover} ${accentMap.glow} cursor-pointer`
      }`}
      onClick={() => {
        if (!isVoting) onPlay();
      }}
      whileHover={!isVoting ? { scale: 1.01 } : undefined}
      whileTap={!isVoting ? { scale: 0.99 } : undefined}
    >
      <img
        src={track.customImageUrl || `https://img.youtube.com/vi/${track.youtubeId}/mqdefault.jpg`}
        className="absolute inset-0 w-full h-full object-cover opacity-80"
        alt={track.title}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />

      {/* Top row: type badge + ELO chip (featured-card style) */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <span className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-zinc-700/50 text-[10px] font-black text-zinc-300 uppercase tracking-widest">
          {track.type}
        </span>
        <span className={`px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm border text-[11px] font-mono font-black tabular-nums ${accentMap.text} ${accentMap.chip}`}>
          {track.elo} ELO
        </span>
      </div>

      {/* "Your Vote" banner — top-center, wrapped so motion doesn't fight the centering translate */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
        <AnimatePresence>
          {isWinner && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`px-2.5 py-1 ${accentMap.voteBadge} font-mono text-[10px] font-black uppercase tracking-widest rounded-md shadow-lg flex items-center gap-1.5`}
            >
              <CheckCircle2 className="w-3 h-3" />
              Your Vote
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Just-voted burst animation */}
      <AnimatePresence>
        {justVoted && (
          <motion.div
            initial={{ opacity: 0.8, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.8 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={`absolute inset-0 z-30 pointer-events-none rounded-xl ring-4 ${accentMap.ringWon}`}
          />
        )}
      </AnimatePresence>

      {/* Card body */}
      <div className="relative z-10">
        <h4 className="font-display font-black text-white text-lg sm:text-xl leading-tight truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {track.title}
        </h4>
        <p className="font-mono text-zinc-300 text-[11px] font-bold uppercase truncate mt-1">
          {track.artist} · {track.animeName}
        </p>

        {!hasVotedToday ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onVote();
            }}
            disabled={isVoting}
            className={`w-full mt-3 rounded-lg ${accentMap.btn} py-2.5 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all select-none flex items-center justify-center gap-2 cursor-pointer ${
              isVoting && justVoted ? 'opacity-70 pointer-events-none' : ''
            }`}
          >
            {isVoting && justVoted ? (
              <span>Syncing…</span>
            ) : (
              <>
                <Swords className="w-3.5 h-3.5" />
                Vote {side}
              </>
            )}
          </button>
        ) : isWinner ? (
          <div className={`w-full mt-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-center bg-black/40 border rounded-lg flex items-center justify-center gap-1.5 ${accentMap.text} ${accentMap.chip}`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Your Vote
          </div>
        ) : (
          <div className="w-full mt-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-zinc-700 text-center bg-zinc-900/40 border border-zinc-800/60 rounded-lg">
            —
          </div>
        )}
      </div>
    </motion.div>
  );
}