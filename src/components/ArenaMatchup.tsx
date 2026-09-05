import { apiFetch } from "../utils/apiFetch";
import React, { useState, useEffect, useMemo } from "react";
import { AnimeTrack, TrackType, UserAccount } from "../types";
import { calculateNewRatings } from "../utils/elo";
import { calculateTrackScore } from "../utils/recommendationEngine";
import { stripTypeTags } from "../utils/songTags";
import {
  Sparkles,
  HelpCircle,
  Tv,
  ThumbsUp,
  ArrowRight,
  ListRestart,
  TrendingUp,
  History,
  Scale,
  Smile,
  CheckCircle2,
  AlertCircle,
  Music,
  Play,
  Star,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Settings,
  Check,
} from '@/utils/icons';
import { motion, AnimatePresence } from "motion/react";
import { AnimatedCounter } from "./AnimatedCounter";
import TrackActionsMenu from "./TrackActionsMenu";
import { addTrackReview } from "../utils/firestoreService";
import { toast } from "sonner";
import { playTactileSound } from "../utils/tactileAudio";
import { playSound } from "../utils/howlerAudio";
import { ArenaSkeleton } from './Skeleton';
import confetti from "canvas-confetti";
import { VoteCelebration } from "./gamification/VoteCelebration";
import { WINNER_COLORS } from "./gamification/VoteCelebration";
import Tilt from 'react-parallax-tilt';

function fireConfettiBurst(outcome: "A" | "B" | "draw") {
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

const CyberBackdrop = ({
  colorClass = "from-[#FF3D2E]/20",
}: {
  colorClass?: string;
}) => (
  <div className="absolute inset-0 w-full h-full bg-[#0A0805] overflow-hidden">
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
  if (!artist) return "Unknown Artist";
  if (artist.length > 50) {
    return artist.slice(0, 48) + "...";
  }
  return artist;
};

interface ArenaMatchupProps {
  tracks: AnimeTrack[];
  currentUser?: UserAccount | null;
  onVote: (
    trackAId: string,
    trackBId: string,
    outcome: "A" | "B" | "draw",
    ratingChanges: {
      aBefore: number;
      aAfter: number;
      bBefore: number;
      bAfter: number;
      changeA: number;
      changeB: number;
    },
  ) => void;
  recentHistory: any[];
  onUpdateTrackYtId?: (id: string, newYtId: string) => void;
  onPlay: (track: AnimeTrack) => void;
  isAdmin?: boolean;
  isCustomStream?: boolean;
  onSaveCommentary?: (message: string) => void;
  voterCoefficient?: number;
  voterInfo?: any;
}

export default function ArenaMatchup({
  tracks,
  currentUser = null,
  onVote,
  recentHistory,
  onUpdateTrackYtId,
  onPlay,
  isAdmin = false,
  isCustomStream = false,
  onSaveCommentary,
  voterCoefficient = 1.0,
  voterInfo = null,
}: ArenaMatchupProps) {
  const [trackAId, setTrackAId] = useState<string | null>(null);
  const [trackBId, setTrackBId] = useState<string | null>(null);

  const trackA = tracks.find((t) => t.id === trackAId) || null;
  const trackB = tracks.find((t) => t.id === trackBId) || null;

  const [phase, setPhase] = useState<'battle' | 'winner_reveal' | 'draw_reveal'>('battle');
  const [commentaryText, setCommentaryText] = useState("");
  const [isCommentarySaved, setIsCommentarySaved] = useState(false);
  const [showCritiqueForm, setShowCritiqueForm] = useState(false);
  const [reviewRating, setReviewRating] = useState<number>(8);
  const [reviewTrackSelection, setReviewTrackSelection] = useState<"A" | "B">("A");
  const [selectedCandidate, setSelectedCandidate] = useState<"A" | "B" | null>(null);
  const [useSmartMatchmaking, setUseSmartMatchmaking] = useState<boolean>(true);

  const [particleTrigger, setParticleTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [hoveredCard, setHoveredCard] = useState<"A" | "B" | null>(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>, card: "A" | "B") => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  const clickTimeoutRef = React.useRef<{ A: any; B: any }>({ A: null, B: null });
  const lastClickRef = React.useRef<{ side: "A" | "B" | null; time: number }>({ side: null, time: 0 });

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current.A) clearTimeout(clickTimeoutRef.current.A);
      if (clickTimeoutRef.current.B) clearTimeout(clickTimeoutRef.current.B);
    };
  }, []);

  const handleCardClick = (side: "A" | "B", track: AnimeTrack) => {
    if (phase !== 'battle') return;

    const now = Date.now();
    const isDoubleClick = lastClickRef.current.side === side && now - lastClickRef.current.time < 300;

    if (isDoubleClick) {
      if (clickTimeoutRef.current.A) {
        clearTimeout(clickTimeoutRef.current.A);
        clickTimeoutRef.current.A = null;
      }
      if (clickTimeoutRef.current.B) {
        clearTimeout(clickTimeoutRef.current.B);
        clickTimeoutRef.current.B = null;
      }
      lastClickRef.current = { side: null, time: 0 };
      setSelectedCandidate(null);
      setTimeout(() => {
        handleVote(side);
      }, 150);
    } else {
      lastClickRef.current = { side, time: now };
      
      if (clickTimeoutRef.current[side]) {
        clearTimeout(clickTimeoutRef.current[side]);
      }

      clickTimeoutRef.current[side] = setTimeout(() => {
        clickTimeoutRef.current[side] = null;
        onPlay(track);
      }, 250);
    }
  };

  const [voteResult, setVoteResult] = useState<{
    outcome: "A" | "B" | "draw";
    ratingChanges: {
      aBefore: number;
      aAfter: number;
      bBefore: number;
      bAfter: number;
      changeA: number;
      changeB: number;
    };
  } | null>(null);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<"A" | "B" | null>(null);
  const [arenaTypeFilter, setArenaTypeFilter] = useState<TrackType>("OP");
  const [arenaTagFilter, setArenaTagFilter] = useState<string>("ALL");

  const [isBlindMode, setIsBlindMode] = useState<boolean>(() => {
    return localStorage.getItem("anitheme_blind_mode") === "true";
  });

  const handleToggleBlindMode = () => {
    const newValue = !isBlindMode;
    setIsBlindMode(newValue);
    localStorage.setItem("anitheme_blind_mode", String(newValue));
  };

  const handleResolveTrack = async (track: AnimeTrack) => {
    if (resolvingId) return;
    setResolvingId(track.id);
    try {
      const existingYtIds = tracks.map((t) => t.youtubeId).filter(Boolean);
      const response = await apiFetch("/api/resolve-single", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          animeName: track.animeName,
          type: track.type,
          existingYtIds,
        }),
      });

      if (!response.ok) {
        throw new Error("Auto-resolve failed");
      }

      const data = await response.json();
      if (data.youtubeId) {
        onUpdateTrackYtId?.(track.id, data.youtubeId);
      } else {
        alert(
          "We found matches, but they are already assigned to other songs in your database, or YouTube is loaded. Try manually adjusting on the Leaderboard.",
        );
      }
    } catch (err) {
      alert("Could not automatically locate an active video on YouTube.");
    } finally {
      setResolvingId(null);
    }
  };

  const generateNewMatchup = (winnerTrack: AnimeTrack | null = null) => {
    setPhase('battle');
    setVoteResult(null);
    setSelectedCandidate(null);
    setCommentaryText("");
    setIsCommentarySaved(false);
    setShowCritiqueForm(false);

    if (tracks.length === 2) {
      setTrackAId(tracks[0].id);
      setTrackBId(tracks[1].id);
      return;
    }

    const typePool = tracks.filter((t) => {
      if (isCustomStream) return true;
      const matchType = t.type === arenaTypeFilter;
      const matchTag =
        arenaTagFilter === "ALL" || (t.tags && t.tags.includes(arenaTagFilter));
      return matchType && matchTag;
    });

    if (typePool.length < 2) {
      return;
    }

    if (winnerTrack) {
      const winnerId = winnerTrack.id;
      const winnerElo = winnerTrack.elo;
      const winnerType = winnerTrack.type;

      let potentialPartners = typePool.filter(
        (t) => t.id !== winnerId && t.type === winnerType && Math.abs(t.elo - winnerElo) <= 220,
      );
      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter(
          (t) => t.id !== winnerId && t.type === winnerType && Math.abs(t.elo - winnerElo) <= 400,
        );
      }
      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter((t) => t.id !== winnerId && t.type === winnerType);
      }
      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter((t) => t.id !== winnerId);
      }

      const newOpponent = potentialPartners[Math.floor(Math.random() * potentialPartners.length)];

      if (winnerTrack.id === trackAId) {
        setTrackAId(winnerId);
        setTrackBId(newOpponent.id);
      } else {
        setTrackBId(winnerId);
        setTrackAId(newOpponent.id);
      }
      return;
    }

    if (useSmartMatchmaking && currentUser) {
      const favoriteTrackIds = currentUser.favoriteTrackIds || [];
      const favTracks = favoriteTrackIds
        .map((id) => tracks.find((t) => t.id === id))
        .filter(Boolean) as AnimeTrack[];

      const trackScores = new Map<string, number>();
      
      const scored = typePool
        .map((t) => {
          let score = calculateTrackScore(t, currentUser, tracks, favTracks);
          trackScores.set(t.id, score);
          return { track: t, score };
        })
        .sort((a, b) => b.score - a.score);

      const topCandidatesCount = Math.max(3, Math.ceil(scored.length * 0.45));
      const poolCandidates = scored
        .slice(0, topCandidatesCount)
        .map((item) => item.track);

      const indexA = Math.floor(Math.random() * poolCandidates.length);
      const candidateA = poolCandidates[indexA];

      let potentialPartners = typePool.filter(
        (t) =>
          t.id !== candidateA.id && t.type === candidateA.type && Math.abs(t.elo - candidateA.elo) <= 220,
      );

      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter(
          (t) =>
            t.id !== candidateA.id && t.type === candidateA.type && Math.abs(t.elo - candidateA.elo) <= 400,
        );
      }
      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter((t) => t.id !== candidateA.id && t.type === candidateA.type);
      }
      if (potentialPartners.length === 0) {
        potentialPartners = typePool.filter((t) => t.id !== candidateA.id);
      }

      const partnerScored = potentialPartners
        .map((t) => ({
          track: t,
          score: trackScores.get(t.id) || 0,
        }))
        .sort((a, b) => b.score - a.score);

      const topPartnersCount = Math.max(
        2,
        Math.ceil(partnerScored.length * 0.5),
      );
      const finalizedPartners = partnerScored
        .slice(0, topPartnersCount)
        .map((item) => item.track);

      const indexB = Math.floor(Math.random() * finalizedPartners.length);
      const candidateB = finalizedPartners[indexB];

      setTrackAId(candidateA.id);
      setTrackBId(candidateB.id);
      return;
    }

    const indexA = Math.floor(Math.random() * typePool.length);
    const candidateA = typePool[indexA];

    let potentialPartners = typePool.filter(
      (t) => t.id !== candidateA.id && t.type === candidateA.type && Math.abs(t.elo - candidateA.elo) <= 180,
    );

    if (potentialPartners.length === 0) {
      potentialPartners = typePool.filter(
        (t) =>
          t.id !== candidateA.id && t.type === candidateA.type && Math.abs(t.elo - candidateA.elo) <= 350,
      );
    }

    if (potentialPartners.length === 0) {
      potentialPartners = typePool.filter((t) => t.id !== candidateA.id && t.type === candidateA.type);
    }

    if (potentialPartners.length === 0) {
      potentialPartners = typePool.filter((t) => t.id !== candidateA.id);
    }

    const indexB = Math.floor(Math.random() * potentialPartners.length);
    const candidateB = potentialPartners[indexB];

    setTrackAId(candidateA.id);
    setTrackBId(candidateB.id);
  };

  useEffect(() => {
    generateNewMatchup();
  }, [arenaTypeFilter, arenaTagFilter]);

  useEffect(() => {
    if (!trackAId || !trackBId) {
      generateNewMatchup();
    }
  }, [tracks, trackAId, trackBId]);

  useEffect(() => {
    if (phase === 'winner_reveal') {
      const winner = voteResult?.outcome === 'A' ? trackA : voteResult?.outcome === 'B' ? trackB : null;
      const timer = setTimeout(() => {
        if (winner) generateNewMatchup(winner);
      }, 2200);
      return () => clearTimeout(timer);
    } else if (phase === 'draw_reveal') {
      const timer = setTimeout(() => {
        generateNewMatchup(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, voteResult, trackA, trackB]);

  const handleVote = (outcome: "A" | "B" | "draw") => {
    if (!trackA || !trackB || phase !== 'battle') return;

    const ratingSummary = calculateNewRatings(trackA.elo, trackB.elo, outcome, 32, voterCoefficient);

    const changes = {
      aBefore: trackA.elo,
      aAfter: ratingSummary.newRatingA,
      bBefore: trackB.elo,
      bAfter: ratingSummary.newRatingB,
      changeA: ratingSummary.changeA,
      changeB: ratingSummary.changeB,
    };

    setVoteResult({
      outcome,
      ratingChanges: changes,
    });

    if (outcome === "A" || outcome === "B") {
      playSound('vote');
      setTimeout(() => fireConfettiBurst(outcome), 600);
      setPhase('winner_reveal');
    } else {
      setPhase('draw_reveal');
    }

    setParticleTrigger(prev => prev + 1);

    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(outcome === "draw" ? 10 : outcome === "A" ? [15, 30, 15] : [15, 30, 15]);
    }

    if (outcome === "A" || outcome === "B") {
      setReviewTrackSelection(outcome);
    } else {
      setReviewTrackSelection("A");
    }

    onVote(trackA.id, trackB.id, outcome, changes);
  };

  const arenaPool = useMemo(
    () =>
      tracks.filter((t) => {
        if (isCustomStream || tracks.length === 2) return true;
        const matchType = t.type === arenaTypeFilter;
        const matchTag =
          arenaTagFilter === "ALL" ||
          (t.tags && t.tags.includes(arenaTagFilter));
        return matchType && matchTag;
      }),
    [tracks, arenaTypeFilter, arenaTagFilter, isCustomStream],
  );

  const allAvailableTags = useMemo(() => {
    const tags = new Set<string>();
    tracks.forEach((t) => stripTypeTags(t.tags).forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }, [tracks]);

  if (tracks.length < 2) {
    return (
      <div className="bg-panel-bg border border-zinc-800 rounded-xl p-8 text-center max-w-md mx-auto my-12">
        <AlertCircle className="w-12 h-12 text-brand-primary mx-auto mb-4" />
        <h3 className="font-display font-bold text-lg text-white">
          Insufficient Themes
        </h3>
        <p className="text-zinc-400 text-sm mt-2">
          You need at least two tracks in your database to play face-offs in the
          arena. Load/Reset the default song dataset to play.
        </p>
      </div>
    );
  }

  if (arenaPool.length < 2) {
    return (
      <div className="space-y-8">
        <div className="text-center max-w-xl mx-auto space-y-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-brand-primary/10 text-brand-primary font-mono text-xs font-black uppercase tracking-widest border border-brand-primary/20">
            <Scale className="w-3.5 h-3.5" /> 1VS1 MATCHMAKER ARENA
          </span>
          <h2 className="font-display font-black text-3xl lg:text-4xl text-white uppercase tracking-tighter">
            Choose Your{" "}
            <span className="gradient-text-pink italic">Category</span>
          </h2>

          <div className="pt-2 flex flex-col items-center gap-4">
            <div className="flex flex-wrap justify-center items-center gap-1.5 p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
              {(["OP", "ED", "OST"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setArenaTypeFilter(type)}
                  className={`px-4 py-1.5 rounded text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer ${
                    arenaTypeFilter === type
                      ? "bg-brand-primary text-white shadow-sm glow-cherry"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap justify-center items-center gap-1.5 max-w-lg">
              <button
                onClick={() => setArenaTagFilter("ALL")}
                className={`px-3 py-1 rounded text-[11px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer border ${
                  arenaTagFilter === "ALL"
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "bg-zinc-950 border-zinc-900 text-zinc-600 hover:text-zinc-400"
                }`}
              >
                ALL STYLES
              </button>
              {allAvailableTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setArenaTagFilter(tag)}
                  className={`px-3 py-1 rounded text-[11px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer border ${
                    arenaTagFilter === tag
                      ? "bg-brand-secondary/20 border-brand-secondary/40 text-brand-secondary"
                      : "bg-zinc-950 border-zinc-900 text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-panel-bg border border-zinc-800 rounded-xl p-8 text-center max-w-md mx-auto">
          <Music className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="font-display font-bold text-lg text-white uppercase tracking-tight">
            Not Enough {arenaTypeFilter} themes with tag "{arenaTagFilter}"
          </h3>
          <p className="text-zinc-400 text-sm mt-2">
            You need at least two tracks matching your selected filters to start
            a match.
          </p>
          <div className="mt-6">
            <p className="text-[11px] font-mono text-zinc-500 uppercase">
              Try selecting a different style or category above.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!trackA || !trackB) {
    return <ArenaSkeleton />;
  }

  const isWinnerReveal = (side: "A" | "B") => phase === 'winner_reveal' && voteResult?.outcome === side;
  const isLoserFading = (side: "A" | "B") => phase === 'winner_reveal' && voteResult?.outcome !== side;
  const isDrawFade = phase === 'draw_reveal';

  return (
    <div className="space-y-4 sm:space-y-8">
      <div className="glass-panel p-4 sm:p-6 relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#FF3D2E] via-transparent to-[#3FA9F5]" />
        <div className="flex flex-col gap-4">
          <div className="text-center sm:text-left">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-brand-primary/10 text-brand-primary font-mono text-xs font-black uppercase tracking-widest border border-brand-primary/20">
              <Scale className="w-3.5 h-3.5" /> 1v1 Arena
            </span>
            <h2 className="font-display font-black text-2xl sm:text-3xl text-white uppercase tracking-tighter mt-2">
              Ready to Vote?
            </h2>
            <p className="text-[#FF3D2E] text-[11px] font-mono uppercase tracking-[0.12em] font-black mt-1">
              ⚡ Single-Click to Play | Double-Click to Vote
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <div className="flex items-center p-1 bg-zinc-950 border border-zinc-800 rounded-xl shrink-0">
              {(["OP", "ED", "OST"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setArenaTypeFilter(type)}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer ${
                    arenaTypeFilter === type
                      ? "bg-zinc-800 text-white shadow-md border border-zinc-700"
                      : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                  }`}
                >
                  {type === "OP" ? "OPENING" : type === "ED" ? "ENDING" : "OST"}
                </button>
              ))}
            </div>

            {currentUser && (
              <button
                type="button"
                onClick={() => setUseSmartMatchmaking(!useSmartMatchmaking)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono font-black uppercase tracking-wider transition-all select-none cursor-pointer shrink-0 ${
                  useSmartMatchmaking
                    ? "bg-rose-deep/10 border-rose-deep/50 text-vermillion-tint"
                    : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-white"
                }`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${useSmartMatchmaking ? "text-vermillion-tint" : ""}`} />
                <span>Smart: {useSmartMatchmaking ? "ON" : "OFF"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleBlindMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono font-black uppercase tracking-wider transition-all select-none cursor-pointer shrink-0 ${
                isBlindMode
                  ? "bg-[#FF3D2E]/15 border-[#FF3D2E]/50 text-[#FF3D2E]"
                  : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-white"
              }`}
            >
              <HelpCircle className={`w-3.5 h-3.5 ${isBlindMode ? "text-[#C81E55]" : ""}`} />
              <span>Blind: {isBlindMode ? "ON" : "OFF"}</span>
            </button>
          </div>

          <div className="bg-[#0A0805] border border-zinc-900 p-2 rounded-xl flex flex-wrap items-center gap-1.5 max-h-[80px] overflow-y-auto">
            <span className="text-[10px] font-mono font-black text-zinc-600 uppercase tracking-widest shrink-0 flex items-center gap-1 w-full mb-1">
              <Sparkles className="w-3 h-3 text-[#C81E55]" /> SONG STYLE
            </span>
            <button
              onClick={() => setArenaTagFilter("ALL")}
              className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer border shrink-0 ${
                arenaTagFilter === "ALL"
                  ? "bg-[#C81E55] text-white border-[#C81E55]"
                  : "bg-zinc-950 border-zinc-900 text-zinc-600 hover:text-zinc-400"
              }`}
            >
              ANY
            </button>
            {allAvailableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setArenaTagFilter(tag)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer border shrink-0 ${
                  arenaTagFilter === tag
                    ? "bg-[#C81E55]/20 border-[#C81E55]/40 text-[#C81E55]"
                    : "bg-zinc-950 border-zinc-900 text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full">
        {!currentUser ? (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel border-l-4 border-l-gold bg-gold/5 px-4 py-3 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gold/10 text-gold-bright shrink-0">
                <AlertCircle className="w-5 h-5" />
              </span>
              <div>
                <p className="text-gold-bright font-bold font-display uppercase tracking-tight text-xs">⚠️ Anonymous Guest Voting Active</p>
                <p className="text-zinc-300 text-[11px] mt-0.5 leading-relaxed">
                  Your votes are fully simulated locally so you can enjoy the Arena & witness ELO fluctuations, but they <span className="text-gold-bright font-bold underline">will not affect</span> global leaderboards or public master records. Sign in to vote officially!
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <span className="px-2.5 py-1 text-[11px] font-mono font-black uppercase text-gold-bright bg-gold/10 border border-gold/25 rounded-md tracking-wider">
                Simulation Only
              </span>
            </div>
          </motion.div>
        ) : null}
      </div>

      <div className="relative flex flex-col w-full gap-2">
        <div className="gradient-mesh-bg rounded-2xl" />

        <div className={`relative flex flex-col md:flex-row w-full h-[460px] md:h-[520px] lg:h-[60vh] max-h-[640px] gap-2 md:gap-4 items-stretch justify-center rounded-2xl bg-[#100C0A] p-2 md:p-4 border border-[#2B2319] shadow-2xl overflow-visible`}>
          <AnimatePresence>
            {phase === 'battle' && (
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

          <AnimatePresence>
            {trackA && !isLoserFading("A") && (
              <motion.div 
                layout
                className={`h-full ${isWinnerReveal("A") ? 'absolute inset-0 z-30 flex items-center justify-center pointer-events-none' : 'relative flex-1 w-full md:w-1/2 flex items-center justify-center'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: isDrawFade ? 0 : 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4 } }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <motion.div 
                  layout
                  className={`relative rounded-xl overflow-visible ${isWinnerReveal("A") ? 'w-full md:w-1/2 h-1/2 md:h-full' : 'w-full h-full'}`}
                  animate={{ scale: isWinnerReveal("A") ? 1.1 : 1 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Tilt
                    tiltMaxAngleX={isWinnerReveal("A") ? 0 : 6}
                    tiltMaxAngleY={isWinnerReveal("A") ? 0 : 6}
                    glareEnable={!isWinnerReveal("A")}
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
                      aria-pressed={selectedCandidate === "A"}
                      onClick={() => handleCardClick("A", trackA)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardClick("A", trackA);
                        }
                      }}
                      onMouseMove={(e) => handleMouseMove(e, "A")}
                      onMouseEnter={() => setHoveredCard("A")}
                      onMouseLeave={() => setHoveredCard(null)}
                      className={`relative group w-full h-full rounded-xl cursor-pointer transition-all duration-300 transform select-none flex flex-col justify-end p-4 md:p-6 active:scale-[0.98] press-feedback ${
                        activeDropdown === "A"
                          ? "z-40 shadow-[0_0_50px_rgba(255, 61, 46,0.4)]"
                          : isWinnerReveal("A")
                            ? "ring-4 ring-[#FF3D2E] shadow-[0_0_60px_rgba(255, 61, 46,0.5)] z-10"
                            : isDrawFade
                              ? "opacity-50 scale-95 blur-[2px]"
                              : selectedCandidate === "A"
                                ? "ring-4 ring-[#FF3D2E] shadow-[0_0_30px_rgba(255, 61, 46,0.85)] z-10 scale-[1.015]"
                                : selectedCandidate === "B"
                                  ? "opacity-40 grayscale-[30%] scale-98 hover:opacity-75"
                                  : "hover:ring-2 hover:ring-[#FF3D2E]/50 hover:brightness-125 transition-all duration-300 transform shadow-lg hover:shadow-[0_0_40px_rgba(255, 61, 46,0.3)]"
                      }`}
                    >
                      {hoveredCard === "A" && phase === 'battle' && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 rounded-xl"
                          style={{
                            background: `radial-gradient(circle 220px at ${mousePos.x}% ${mousePos.y}%, rgba(255, 61, 46, 0.15), transparent 85%)`
                          }}
                        />
                      )}
                      <div className="absolute inset-0 z-0 bg-[#100C0A] border-2 border-zinc-900 rounded-xl overflow-hidden">
                        {isBlindMode && phase === 'battle' ? (
                          <div className="w-full h-full flex flex-col items-center justify-start pt-6 bg-[#100C0A]/95 backdrop-blur-3xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#FF3D2E]/20 via-[#100C0A]/80 to-[#100C0A]" />
                            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjI1KSIvPjwvc3ZnPg==')] opacity-40 bg-repeat" />
                            <motion.div
                              animate={{ y: ["-100%", "200%"] }}
                              transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                              className="absolute inset-0 border-b border-[#FF3D2E]/40 bg-gradient-to-t from-[#FF3D2E]/10 to-transparent h-1/2 w-full"
                            />
                            <span className="px-3 py-1 border border-[#FF3D2E]/30 bg-[#FF3D2E]/10 rounded font-mono text-[11px] text-[#FF3D2E] uppercase tracking-[0.3em] relative z-10 font-black shadow-[0_0_10px_rgba(255, 61, 46,0.3)]">
                              Hidden Details
                            </span>
                          </div>
                        ) : (
                          <div className="relative w-full h-full">
                            <CyberBackdrop colorClass="from-[#FF3D2E]/20" />
                            {trackA.youtubeId && (
                              <img
                                src={
                                  trackA.customImageUrl ||
                                  `https://img.youtube.com/vi/${trackA.youtubeId}/maxresdefault.jpg`
                                }
                                onError={(e) => {
                                  if (
                                    !trackA.customImageUrl ||
                                    e.currentTarget.src === trackA.customImageUrl
                                  ) {
                                    e.currentTarget.src = `https://img.youtube.com/vi/${trackA.youtubeId}/hqdefault.jpg`;
                                  }
                                }}
                                alt={trackA.title}
                                className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-75 transition-opacity duration-500"
                                referrerPolicy="no-referrer"
                              />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-transparent"></div>
                      </div>

                      {trackA && (
                        <TrackActionsMenu
                          track={trackA}
                          isAdmin={isAdmin}
                          className="absolute top-4 left-4 z-30"
                          align="left"
                          onOpenStateChange={(isOpen) =>
                            setActiveDropdown(isOpen ? "A" : null)
                          }
                        />
                      )}

                      {phase === 'battle' && selectedCandidate === "A" && (
                        <div className="absolute top-4 right-4 bg-[#FF3D2E] text-zinc-950 font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-lg z-15 flex items-center gap-1.5 border border-[#FF3D2E]">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                          <span>Selected Preference</span>
                        </div>
                      )}

                      <div className="relative z-10 w-full min-w-0 flex flex-col items-start overflow-hidden">
                        <div className="flex justify-start w-full min-w-0 pr-4">
                          <h3 className="font-display font-black text-2xl md:text-3xl lg:text-4xl text-white leading-none uppercase tracking-tight truncate drop-shadow-lg">
                            {isBlindMode && phase === 'battle' ? "Mystery Theme A" : trackA.title}
                          </h3>
                        </div>
                        <div className="flex justify-start w-full min-w-0 mt-1 md:mt-2 pr-4">
                          <p className="text-zinc-200 text-sm md:text-lg italic drop-shadow-md font-bold truncate">
                            {isBlindMode && phase === 'battle'
                              ? "🤫 Revealed after you vote"
                              : truncateArtist(trackA.artist)}
                          </p>
                        </div>
                        <div className="flex justify-start w-full min-w-0 mt-2 pr-4">
                          <p className="text-zinc-400 text-[11px] md:text-xs font-mono font-black flex items-center gap-1 md:gap-1.5 uppercase tracking-wider bg-black/50 w-fit max-w-full px-2.5 py-1 md:px-3 md:py-1.5 rounded backdrop-blur-md border border-white/5 shadow-inner">
                            <Tv className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#FF3D2E] shrink-0" />{" "}
                            <span className="truncate">
                              {isBlindMode && phase === 'battle' ? "🤫 Series Hidden" : trackA.animeName}
                            </span>
                          </p>
                        </div>

                        {isWinnerReveal("A") && (
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
                              <AnimatedCounter value={Math.round(voteResult?.ratingChanges.aAfter ?? trackA.elo ?? 1200)} direction="up" playTickSound={true} />
                            </motion.span>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  </Tilt>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {trackB && !isLoserFading("B") && (
              <motion.div 
                layout
                className={`h-full ${isWinnerReveal("B") ? 'absolute inset-0 z-30 flex items-center justify-center pointer-events-none' : 'relative flex-1 w-full md:w-1/2 flex items-center justify-center'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: isDrawFade ? 0 : 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4 } }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <motion.div 
                  layout
                  className={`relative rounded-xl overflow-visible ${isWinnerReveal("B") ? 'w-full md:w-1/2 h-1/2 md:h-full' : 'w-full h-full'}`}
                  animate={{ scale: isWinnerReveal("B") ? 1.1 : 1 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Tilt
                    tiltMaxAngleX={isWinnerReveal("B") ? 0 : 6}
                    tiltMaxAngleY={isWinnerReveal("B") ? 0 : 6}
                    glareEnable={!isWinnerReveal("B")}
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
                      aria-pressed={selectedCandidate === "B"}
                      onClick={() => handleCardClick("B", trackB)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardClick("B", trackB);
                        }
                      }}
                      onMouseMove={(e) => handleMouseMove(e, "B")}
                      onMouseEnter={() => setHoveredCard("B")}
                      onMouseLeave={() => setHoveredCard(null)}
                      className={`relative group w-full h-full rounded-xl cursor-pointer transition-all duration-300 transform select-none flex flex-col justify-end p-4 md:p-6 active:scale-[0.98] press-feedback ${
                        activeDropdown === "B"
                          ? "z-40 shadow-[0_0_50px_rgba(63, 169, 245,0.4)]"
                          : isWinnerReveal("B")
                            ? "ring-4 ring-[#3FA9F5] shadow-[0_0_60px_rgba(63, 169, 245,0.5)] z-10"
                            : isDrawFade
                              ? "opacity-50 scale-95 blur-[2px]"
                              : selectedCandidate === "B"
                                ? "ring-4 ring-[#3FA9F5] shadow-[0_0_30px_rgba(63, 169, 245,0.85)] z-10 scale-[1.015]"
                                : selectedCandidate === "A"
                                  ? "opacity-40 grayscale-[30%] scale-98 hover:opacity-75"
                                  : "hover:ring-2 hover:ring-[#3FA9F5]/50 hover:brightness-125 transition-all duration-300 transform shadow-lg hover:shadow-[0_0_40px_rgba(63, 169, 245,0.3)]"
                      }`}
                    >
                      {hoveredCard === "B" && phase === 'battle' && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 rounded-xl"
                          style={{
                            background: `radial-gradient(circle 220px at ${mousePos.x}% ${mousePos.y}%, rgba(63, 169, 245, 0.18), transparent 85%)`
                          }}
                        />
                      )}
                      <div className="absolute inset-0 z-0 bg-[#100C0A] border-2 border-zinc-900 rounded-xl overflow-hidden">
                        {isBlindMode && phase === 'battle' ? (
                          <div className="w-full h-full flex flex-col items-center justify-start pt-6 bg-[#110709]/95 backdrop-blur-3xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#3FA9F5]/20 via-[#0A0F18]/80 to-[#0A0F18]" />
                            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjI1KSIvPjwvc3ZnPg==')] opacity-40 bg-repeat" />
                            <motion.div
                              animate={{ y: ["-100%", "200%"] }}
                              transition={{
                                repeat: Infinity,
                                duration: 3,
                                ease: "linear",
                                delay: 1.5,
                              }}
                              className="absolute inset-0 border-b border-[#3FA9F5]/40 bg-gradient-to-t from-[#3FA9F5]/10 to-transparent h-1/2 w-full"
                            />
                            <span className="px-3 py-1 border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 rounded font-mono text-[11px] text-[#3FA9F5] uppercase tracking-[0.3em] relative z-10 font-black shadow-[0_0_10px_rgba(63, 169, 245,0.3)]">
                              Hidden Details
                            </span>
                          </div>
                        ) : (
                          <div className="relative w-full h-full">
                            <CyberBackdrop colorClass="from-[#3FA9F5]/25" />
                            {trackB.youtubeId && (
                              <img
                                src={
                                  trackB.customImageUrl ||
                                  `https://img.youtube.com/vi/${trackB.youtubeId}/maxresdefault.jpg`
                                }
                                onError={(e) => {
                                  if (
                                    !trackB.customImageUrl ||
                                    e.currentTarget.src === trackB.customImageUrl
                                  ) {
                                    e.currentTarget.src = `https://img.youtube.com/vi/${trackB.youtubeId}/hqdefault.jpg`;
                                  }
                                }}
                                alt={trackB.title}
                                className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-75 transition-opacity duration-500"
                                referrerPolicy="no-referrer"
                              />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-transparent"></div>
                      </div>

                      {trackB && (
                        <TrackActionsMenu
                          track={trackB}
                          isAdmin={isAdmin}
                          className="absolute top-4 right-4 z-30"
                          align="right"
                          onOpenStateChange={(isOpen) =>
                            setActiveDropdown(isOpen ? "B" : null)
                          }
                        />
                      )}

                      {phase === 'battle' && selectedCandidate === "B" && (
                        <div className="absolute top-4 left-4 bg-[#3FA9F5] text-white font-mono text-[11px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded shadow-lg z-15 flex items-center gap-1.5 border border-[#3FA9F5]">
                          <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          <span>Selected Preference</span>
                        </div>
                      )}

                      <div className="relative z-10 text-right ms-auto flex flex-col items-end w-full min-w-0 overflow-hidden">
                        <div className="flex justify-end w-full min-w-0 pl-4">
                          <h3 className="font-display font-black text-2xl md:text-3xl lg:text-4xl text-white leading-none uppercase tracking-tight truncate drop-shadow-lg text-right">
                            {isBlindMode && phase === 'battle' ? "Mystery Theme B" : trackB.title}
                          </h3>
                        </div>
                        <div className="flex justify-end w-full min-w-0 mt-1 md:mt-2 pl-4">
                          <p className="text-zinc-200 text-sm md:text-lg italic drop-shadow-md font-bold text-right truncate">
                            {isBlindMode && phase === 'battle'
                              ? "🤫 Revealed after you vote"
                              : truncateArtist(trackB.artist)}
                          </p>
                        </div>
                        <div className="flex justify-end w-full min-w-0 mt-2 pl-4">
                          <p className="text-zinc-400 text-[11px] md:text-xs font-mono font-black flex items-center justify-end gap-1 md:gap-1.5 uppercase tracking-wider bg-black/50 w-fit max-w-full px-2.5 py-1 md:px-3 md:py-1.5 rounded backdrop-blur-md border border-white/5 shadow-inner">
                            <span className="truncate">
                              {isBlindMode && phase === 'battle' ? "🤫 Series Hidden" : trackB.animeName}
                            </span>{" "}
                            <Tv className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#3FA9F5] shrink-0" />
                          </p>
                        </div>

                        {isWinnerReveal("B") && (
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
                              <AnimatedCounter value={Math.round(voteResult?.ratingChanges.bAfter ?? trackB.elo ?? 1200)} direction="up" playTickSound={true} />
                            </motion.span>
                            <span className="text-[11px] md:text-[11px] uppercase text-[#3FA9F5] font-bold">
                              New Elo
                            </span>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  </Tilt>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {phase !== 'battle' && currentUser && showCritiqueForm && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl mx-auto p-5 glass-panel space-y-4 relative overflow-hidden mt-6 mb-2"
          >
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
            <div className="flex items-center gap-2 text-zinc-300">
              <Sparkles className="w-4 h-4 text-gold-bright" />
              <span className="text-[11px] font-mono font-black uppercase tracking-widest text-[#FF8A3D]">
                Battle Diary & Track Critique Review
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans leading-normal">
              Document your decision! Adding a rationale saves your thoughts directly onto your public **Arena Diary** profile and posts an official **Soundtrack Critique** for the chosen theme!
            </p>

            <div className="space-y-1.5 border-t border-b border-zinc-900/60 py-2.5">
              <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-black mb-1">CHOOSE THEME FOR CRITIQUE POST:</span>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold font-sans text-zinc-300 bg-black/40 px-3 py-1.5 border border-zinc-900 rounded-lg flex-1 hover:bg-zinc-950/60 font-semibold transition-all">
                  <input 
                    type="radio" 
                    name="critique-track" 
                    checked={reviewTrackSelection === "A"} 
                    onChange={() => setReviewTrackSelection("A")}
                    disabled={isCommentarySaved}
                    className="accent-gold text-gold-bright focus:ring-0 bg-zinc-900 border-zinc-700 w-3.5 h-3.5" 
                  />
                  <span className="truncate">Theme A: "{trackA?.title}" ({trackA?.animeName})</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold font-sans text-zinc-300 bg-black/40 px-3 py-1.5 border border-zinc-900 rounded-lg flex-1 hover:bg-zinc-950/60 font-semibold transition-all">
                  <input 
                    type="radio" 
                    name="critique-track" 
                    checked={reviewTrackSelection === "B"} 
                    onChange={() => setReviewTrackSelection("B")}
                    disabled={isCommentarySaved}
                    className="accent-gold text-gold-bright focus:ring-0 bg-zinc-900 border-zinc-700 w-3.5 h-3.5" 
                  />
                  <span className="truncate">Theme B: "{trackB?.title}" ({trackB?.animeName})</span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-mono">
                <span className="font-black text-zinc-400 uppercase tracking-wider">ASSIGN MUSIC CRITIQUE SCORE:</span>
                <span className="text-gold-bright font-extrabold flex items-center gap-1">
                  <Star className="w-3 h-3 fill-current text-gold-bright" />
                  {reviewRating} / 10 STARS
                </span>
              </div>
              <div className="flex justify-between gap-1 overflow-x-auto pb-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    disabled={isCommentarySaved}
                    onClick={() => setReviewRating(num)}
                    className={`aspect-square min-w-[24px] h-[24px] rounded font-mono text-[11px] font-extrabold flex items-center justify-center transition-all cursor-pointer ${
                      reviewRating === num
                        ? 'bg-gold text-zinc-950 font-black shadow-[0_0_8px_rgba(255, 138, 61,0.4)] border-transparent'
                        : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-white border border-zinc-800'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-black">CRITIQUE FEEDBACK COMMENTARY:</span>
              <textarea
                value={commentaryText}
                onChange={(e) => setCommentaryText(e.target.value)}
                placeholder="e.g. 'Both music themes contain amazing energy, but the vocals on this track hold unmatchable nostalgic vibes for me...'"
                className="w-full h-20 bg-black/55 border border-zinc-900 focus:border-gold/40 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none placeholder-zinc-700 resize-none font-sans transition-all"
                disabled={isCommentarySaved}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  playTactileSound('success');
                  if (!commentaryText.trim()) return;
                  onSaveCommentary?.(commentaryText);
                  const selectedTrack = reviewTrackSelection === "A" ? trackA : trackB;
                  if (selectedTrack) {
                    addTrackReview({
                      trackId: selectedTrack.id,
                      userId: currentUser.id,
                      username: currentUser.username || currentUser.email.split('@')[0],
                      userPicture: currentUser.picture || '',
                      rating: reviewRating,
                      comment: commentaryText,
                      source: 'arena'
                    })
                      .then(() => toast.success(`Critique published for ${selectedTrack.title}!`))
                      .catch(err => console.error("Could not optionally propagate track review:", err));
                  }
                  setIsCommentarySaved(true);
                }}
                disabled={isCommentarySaved || !commentaryText.trim()}
                className={`px-4 py-1.5 rounded bg-zinc-950 font-mono text-[11px] uppercase font-black tracking-widest border transition-all cursor-pointer ${
                  isCommentarySaved 
                    ? 'bg-moss/10 text-moss border-moss/35' 
                    : 'text-zinc-400 hover:text-white border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {isCommentarySaved ? '✓ Review Posted' : 'Post Review'}
              </button>
            </div>
          </motion.div>
        )}

        <VoteCelebration trigger={particleTrigger} winner={voteResult?.outcome || 'draw'} />
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-4 border-t border-[#221B13]">
        {phase === 'battle' && tracks.length > 2 && (
          <div className="flex justify-center w-full gap-3">
            <button
              id="skip-match-btn"
              onClick={() => {
                playTactileSound('rose');
                playSound('click');
                setTimeout(() => {
                  setSelectedCandidate(null);
                  generateNewMatchup(null);
                }, 120);
              }}
              className="btn-tactile-zinc"
            >
              <span>Skip Face-off</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              id="draw-match-btn"
              onClick={() => {
                playTactileSound('success');
                playSound('click');
                setTimeout(() => {
                  handleVote("draw");
                }, 120);
              }}
              className="btn-tactile-success"
            >
              <Smile className="w-4 h-4 text-neutral-950" /> Tie (Draw)
            </button>
          </div>
        )}
        
        {phase !== 'battle' && (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button
              onClick={() => {
                playTactileSound('primary');
                setShowCritiqueForm(!showCritiqueForm);
              }}
              className="btn-tactile-zinc"
            >
              <Sparkles className="w-4 h-4 text-gold-bright" />
              <span>Write Review</span>
              {showCritiqueForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {tracks.length > 2 ? (
              <div className="text-moss font-mono text-xs uppercase tracking-wider bg-moss/10 px-5 py-3 border border-moss/20 rounded-md shadow-md">
                 🗳️ Next Battle Loading...
              </div>
            ) : (
              <div className="text-moss font-mono text-xs uppercase tracking-wider bg-moss/10 px-5 py-3 border border-moss/20 rounded-md shadow-md">
                 🗳️ Clash recorded.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}