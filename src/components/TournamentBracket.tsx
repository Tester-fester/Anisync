import { apiFetch } from "../utils/apiFetch";
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AnimeTrack, Tournament, TournamentMatch, TrackType } from '../types';
import { calculateNewRatings } from '../utils/elo';
import TrackActionsMenu from './TrackActionsMenu';
import BracketTreeView from './BracketTreeView';
import { 
  Trophy, 
  Play, 
  Tv, 
  ArrowRight, 
  Flame, 
  Layers, 
  TrendingUp, 
  Sparkles,
  RefreshCw,
  ChevronRight,
  Vote,
  Compass,
  Users,
  User,
  Clock,
  LogOut,
  AlertCircle,
  Music,
  Star,
  ChevronUp,
  ChevronDown,
  ScanEye,
  Radio,
  Crown,
  X,
  Download,
  Monitor,
  Clipboard,
  ExternalLink as LinkOut
} from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { TrophyReveal } from './TrophyReveal';
import { UnifiedShare } from './UnifiedShare';
import { ShareCard } from './ShareCard';
import { AnimatedCounter } from './AnimatedCounter';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { addTrackReview } from '../utils/firestoreService';
import Marquee from 'react-fast-marquee';
import { AmbientParticles } from './AmbientParticles';
import { playChampionFanfare } from '../utils/howlerAudio';
// Dropped `html-to-image` import — was unused (toPng never called), and the
// bundle was paying for both html-to-image AND html2canvas. Keeping html2canvas
// since it's what the screenshot export actually uses.
import html2canvas from 'html2canvas';
import { playTactileSound, playLevelUpFanfare } from '../utils/tactileAudio';
import { generateId } from '../utils/autoId';
import TournamentMatchDuel from './TournamentMatchDuel';

interface TournamentBracketProps {
  tracks: AnimeTrack[];
  initialFilter?: string | null;
  onVoteInTournament: (
    trackAId: string,
    trackBId: string,
    outcome: 'A' | 'B',
    ratingChanges: {
      aBefore: number;
      aAfter: number;
      bBefore: number;
      bAfter: number;
      changeA: number;
      changeB: number;
    }
  ) => void;
  onUpdateFullTournament: (tourney: Tournament) => void;
  activeTournament: Tournament | null;
  onStartTournament: (tourney: Tournament) => void;
  onClearTournament: () => void;
  onUpdateTrackYtId?: (id: string, newYtId: string) => void;

  // Multi-user Lobbies props
  availableTournaments: Tournament[];
  selectedOnlineTournamentId: string | null;
  onSelectOnlineTournamentId: (id: string | null) => void;
  localTournament: Tournament | null;
  onUpdateLocalTournament: (tournament: Tournament | null) => void;
  currentUser: any;
  onPlay: (track: AnimeTrack) => void;
  globalPlayingTrack?: AnimeTrack | null;
  onRequestCustomBuilder?: () => void;
  onDeleteOnlineTournament?: (id: string) => void;
  voterCoefficient?: number;
}

// Lightweight, hardware-accelerated floaters that bypass React Virtual DOM diffing & state re-renders completely!
const FloatingEmojiEngine: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleSpawn = (e: Event) => {
      const customEvent = e as CustomEvent<{ emoji: string }>;
      if (!customEvent.detail || !containerRef.current) return;
      
      const { emoji } = customEvent.detail;
      const spawnX = Math.random() * 80 + 10; // random 10% to 90%
      
      // Keep maximum DOM nodes clamped to prevent bloating the page
      if (containerRef.current.childNodes.length > 30) {
        containerRef.current.removeChild(containerRef.current.firstChild!);
      }

      const el = document.createElement('div');
      el.textContent = emoji;
      el.style.position = 'fixed';
      el.style.bottom = '-45px';
      el.style.left = `${spawnX}vw`;
      el.style.zIndex = '9999';
      el.style.fontSize = `${Math.random() * 8 + 24}px`; // Beautiful clear sizing
      el.style.pointerEvents = 'none';
      el.style.userSelect = 'none';
      el.style.opacity = '0';
      el.style.transform = 'translate3d(0, 0, 0) scale(0.4)';
      el.style.willChange = 'transform, opacity';
      
      containerRef.current.appendChild(el);

      // Composited animation pipeline runs directly on the GPU compositor thread for flawless 120fps action
      const animation = el.animate([
        { transform: 'translate3d(0, 0, 0) scale(0.4)', opacity: 0 },
        { transform: `translate3d(${(Math.random() - 0.5) * 40}px, -150px, 0) scale(1.1)`, opacity: 1, offset: 0.15 },
        { transform: `translate3d(${(Math.random() - 0.5) * 100}px, -450px, 0) scale(0.95)`, opacity: 0.8, offset: 0.8 },
        { transform: `translate3d(${(Math.random() - 0.5) * 150}px, -650px, 0) scale(0.6)`, opacity: 0 }
      ], {
        duration: 1800 + Math.random() * 500,
        easing: 'ease-out'
      });

      animation.onfinish = () => {
        el.remove();
      };
    };

    window.addEventListener('spawn-emoji', handleSpawn);
    return () => {
      window.removeEventListener('spawn-emoji', handleSpawn);
    };
  }, []);

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden" />;
};

export default function TournamentBracket({
  tracks,
  initialFilter,
  onVoteInTournament,
  onUpdateFullTournament,
  activeTournament,
  onStartTournament,
  onClearTournament,
  onUpdateTrackYtId,
  availableTournaments,
  selectedOnlineTournamentId,
  onSelectOnlineTournamentId,
  localTournament,
  onUpdateLocalTournament,
  currentUser,
  onPlay,
  globalPlayingTrack,
  onRequestCustomBuilder,
  onDeleteOnlineTournament,
  voterCoefficient = 1.0
}: TournamentBracketProps) {
  // Setup States
  const [tourneyName, setTourneyName] = useState('Theme Championship Grand Prix');
  const [tourneySize, setTourneySize] = useState<4 | 8 | 16 | 32>(8);
  const [tourneyFilter, setTourneyFilter] = useState<string>(initialFilter || 'OP');
  const [selectedSavedTourney, setSelectedSavedTourney] = useState<any | null>(null);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  
  React.useEffect(() => {
    if (initialFilter) {
      setTourneyFilter(initialFilter);
    }
  }, [initialFilter]);
  const [selectionMethod, setSelectionMethod] = useState<'seeded' | 'random' | 'custom'>('seeded');
  const [isOnline, setIsOnline] = useState(false);
  const [votingDuration, setVotingDuration] = useState<number>(60); // 60 seconds interval default
  // Pacing controls removed per spec — online tournaments ALWAYS auto-advance when the timer hits 0.
  const [lobbyPrivacy, setLobbyPrivacy] = useState<'public' | 'private'>('public');
  const [lobbyPassword, setLobbyPassword] = useState<string>('');

  const [hasVotedInCurrentMatch, setHasVotedInCurrentMatch] = useState(false);
  const [reviewRating, setReviewRating] = useState<number>(8);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [reviewTrackSelection, setReviewTrackSelection] = useState<'A' | 'B'>('A');
  const [isReviewSaved, setIsReviewSaved] = useState<boolean>(false);
  const [showCritiqueForm, setShowCritiqueForm] = useState(false);
  
  const [voteOverlayResult, setVoteOverlayResult] = useState<{
    winnerId: string;
    loserId: string;
    changes: any;
  } | null>(null);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showChampionShareCard, setShowChampionShareCard] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cleanBroadcastMode, setCleanBroadcastMode] = useState(false);
  // Chroma-key (green-screen) mode removed — modern OBS uses Browser Source with
  // transparent body background, no chroma keying required.
  const [showPredictionsMode, setShowPredictionsMode] = useState(false);

  // OBS Browser Source overlay mode — when true, the component renders a broadcast-safe
  // overlay layout (huge timer, big track titles, tug-of-war bar, chat ticker, winner
  // banner) with a transparent body background so OBS Studio can composite it directly
  // over the stream via "Sources → Add → Browser".
  const [isObsOverlayMode, setIsObsOverlayMode] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('obs') === '1') {
      setIsObsOverlayMode(true);
    }
  }, []);

  // Force the host page's body background transparent when in OBS overlay mode —
  // this is the key trick that lets OBS Browser Source composite our overlay
  // directly over the stream without chroma-keying.
  useEffect(() => {
    if (!isObsOverlayMode) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-obs-overlay', '1');
    styleEl.textContent = `html, body { background: transparent !important; overflow: hidden !important; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.head.querySelectorAll('[data-obs-overlay="1"]').forEach(el => el.remove());
    };
  }, [isObsOverlayMode]);
  const [myPrediction, setMyPrediction] = useState<Record<string, string>>({}); // matchId -> trackId
  const [isLocallyMuted, setIsLocallyMuted] = useState(false);

  // Streamer Integrations & Interactive Polling States
  // NOTE: Simulated/fake "YouTube Audience Simulator" removed per spec — streamers
  // need REAL chat integration, not a fake one. Only the real Twitch IRC listener remains.
  const [isStreamerDashboardOpen, setIsStreamerDashboardOpen] = useState(false);
  const [twitchChannel, setTwitchChannel] = useState('');
  const [isTwitchConnected, setIsTwitchConnected] = useState(false);
  const [twitchVotesLog, setTwitchVotesLog] = useState<{ id: string; user: string; vote: 'A' | 'B'; timestamp: number }[]>([]);
  const [chatMessagesLog, setChatMessagesLog] = useState<{ id: string; user: string; text: string }[]>([]);

  // Gamified Tug of War dynamic force pulse trackers
  const [pulseSide, setPulseSide] = useState<'A' | 'B' | null>(null);
  const [pulseCount, setPulseCount] = useState(0);

  // Sync AV playback for lobby
  useEffect(() => {
    if (activeTournament?.isOnline && activeTournament.currentlyPlayingId && !isLocallyMuted) {
      const trackToPlay = tracks.find(t => t.id === activeTournament.currentlyPlayingId);
      if (trackToPlay) {
         onPlay(trackToPlay);
      }
    }
  }, [activeTournament?.currentlyPlayingId, isLocallyMuted]);

  const handleGlobalReaction = (emoji: string) => {
    // Dispatch a native CustomEvent for zero-CPU GPU-accelerated emoji spawning
    window.dispatchEvent(new CustomEvent('spawn-emoji', { detail: { emoji } }));
  };

  const handleShareBracket = async () => {
    const node = document.getElementById('bracket-screenshot-area');
    if (!node) return toast.error("Could not find bracket visually.");
    
    setIsCapturing(true);
    toast.info("Generating pristine snapshot...");
    try {
      // Use html2canvas to draw the bracket.
      // We leverage the `onclone` callback to reset scaling and layout properties in the cloned node.
      // This produces a full-resolution, unclipped, flat capture of the entire bracket!
      const canvas = await html2canvas(node, {
        backgroundColor: '#0A0805',
        useCORS: true,
        allowTaint: true,
        scale: 2, // 2x density for gorgeous ultra-sharp print quality
        logging: false,
        onclone: (clonedDoc) => {
          const clonedArea = clonedDoc.getElementById('bracket-screenshot-area');
          if (clonedArea) {
            // Find scrollable viewport and expand it
            const scrollBar = clonedArea.querySelector('.custom-scrollbar') as HTMLElement;
            if (scrollBar) {
              scrollBar.style.height = 'auto';
              scrollBar.style.width = 'auto';
              scrollBar.style.maxHeight = 'none';
              scrollBar.style.overflow = 'visible';
            }
            
            // Find the scaled content wrapper and reset its scale back to 100%
            const innerTransform = clonedArea.querySelector('[style*="transform"]') as HTMLElement;
            if (innerTransform) {
              innerTransform.style.transform = 'none';
              innerTransform.style.width = 'auto';
              innerTransform.style.height = 'auto';
            }

            // Also, reset any parent wrapper sizing
            const scaledParent = innerTransform?.parentElement as HTMLElement;
            if (scaledParent) {
              scaledParent.style.width = 'auto';
              scaledParent.style.height = 'auto';
            }
          }
        },
        ignoreElements: (element) => {
          // Bypass specific unneeded elements
          return element.tagName === 'IMG' || element.hasAttribute('data-html2canvas-ignore');
        }
      });

      const dataUrl = canvas.toDataURL('image/png');
      setCapturedImage(dataUrl);

      // Attempt standard download
      try {
        const link = document.createElement('a');
        link.download = `bracket-${activeTournament?.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'share'}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("Ready! A snapshot preview is loaded. If download didn't start, use the popup controls. 🚀");
      } catch (dlErr) {
        console.warn("Direct programmatic download blocked by sandboxing; lightbox remains active.");
        toast.info("Visual snapshot generated! Save or share it using the loaded modal overlay. ✨");
      }
    } catch (err) {
      console.error("Visual capture error:", err);
      toast.error("Failed to capture bracket.");
    } finally {
      setIsCapturing(false);
    }
  };

  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'A' | 'B' | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<'A' | 'B' | null>(null);

  // Generate Guest Session UUID to track votes cleanly if they aren't logged in
  const guestSessionId = useMemo(() => {
    let id = sessionStorage.getItem('anitheme_guest_voter_id');
    if (!id) {
      id = 'voter_' + Math.random().toString(36).substring(2, 11);
      sessionStorage.setItem('anitheme_guest_voter_id', id);
    }
    return id;
  }, []);

  const voterId = currentUser?.email || currentUser?.id || guestSessionId;

  // Real-time ticking clock to trigger re-renders for the online match
  // countdown timer. Previously this ran unconditionally on mount, re-rendering
  // the entire 3,334-line component every second even when the user was on the
  // lobby screen with no active match. Now gated on there being an online
  // tournament with a matchEndTime in the future.
  const [currentTime, setCurrentTime] = useState(Date.now());
  const hasActiveCountdown = !!(activeTournament?.isOnline && activeTournament?.matchEndTime && activeTournament.matchEndTime > currentTime);
  useEffect(() => {
    if (!hasActiveCountdown) return;
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasActiveCountdown]);

  // Sync state variables on change of tournament
  useEffect(() => {
    setHasVotedInCurrentMatch(false);
    setSelectedCandidate(null);
    setVoteOverlayResult(null);
    setReviewComment('');
    setIsReviewSaved(false);
    setReviewRating(8);
    setReviewTrackSelection('A');
  }, [activeTournament?.id, activeTournament?.currentMatchIndex, activeTournament?.currentRound]);

  // Auto-target the critique to the selected candidate on vote choice change
  useEffect(() => {
    if (selectedCandidate) {
      setReviewTrackSelection(selectedCandidate);
    }
  }, [selectedCandidate]);

  const handleResolveTrack = async (track: AnimeTrack) => {
    if (resolvingId) return;
    setResolvingId(track.id);
    try {
      const existingYtIds = tracks.map(t => t.youtubeId).filter(Boolean);
      const response = await apiFetch('/api/resolve-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        throw new Error('Auto-resolve failed');
      }

      const data = await response.json();
      if (data.youtubeId) {
        onUpdateTrackYtId?.(track.id, data.youtubeId);
        toast.success(`Theme "${track.title}" connected with live Youtube ID successfully!`);
      } else {
        toast.info("No unclaimed live matches found. Try editing the link on the Leaderboard.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Auto-resolve lookup failed. Please input url manually.");
    } finally {
      setResolvingId(null);
    }
  };

  // Create single-elimination tournament bracket
  const handleGenerateTournament = () => {
    let seededPlayers: AnimeTrack[] = [];

    if (window.navigator?.vibrate) {
       window.navigator.vibrate([80, 50, 80]);
    }

    if (selectionMethod === 'custom') {
      if (!selectedSavedTourney) {
        toast.error("Please click and select one of your saved custom tournaments first! (or choose rankings/random mode instead)");
        return;
      }
      const savedTrackIds = selectedSavedTourney.trackIds || selectedSavedTourney.tracks || [];
      seededPlayers = savedTrackIds.map((id: string) => tracks.find(t => t.id === id)).filter(Boolean) as AnimeTrack[];
      
      if (seededPlayers.length < tourneySize) {
        toast.error(`Not all tracks from this saved custom tournament exist in the master database (Found ${seededPlayers.length} of ${tourneySize}).`);
        return;
      }
    } else {
      // 1. Filter tracks
      let pool = [...tracks];
      if (tourneyFilter.startsWith('custom_list_')) {
        const listId = tourneyFilter.replace('custom_list_', '');
        const list = currentUser?.customLists?.find((l: any) => l.id === listId);
        if (list) {
          pool = pool.filter(t => list.trackIds.includes(t.id));
        } else {
          toast.error("Could not find the selected custom list.");
          return;
        }
      } else if (tourneyFilter !== 'ALL') {
        pool = pool.filter(t => t.type === tourneyFilter);
      }

      if (pool.length < tourneySize) {
        toast.error(`Not enough tracks of type "${tourneyFilter}" to generate a ${tourneySize}-sized tournament. (Only have ${pool.length}).`);
        return;
      }

      // Sort by Elo if seeding, or shuffle if random
      if (selectionMethod === 'seeded') {
        pool.sort((a, b) => b.elo - a.elo);
      } else {
        pool = pool.sort(() => Math.random() - 0.5);
      }

      // Grab the first N elements for players
      const players = pool.slice(0, tourneySize);

      // Standard Seeding pairing (Top seeds encounter bottom seeds)
      if (selectionMethod === 'seeded') {
        const size = players.length;
        if (size === 4) {
          seededPlayers = [players[0], players[3], players[1], players[2]]; // 1v4, 2v3
        } else if (size === 8) {
          seededPlayers = [
            players[0], players[7], // Match 0 (1v8)
            players[3], players[4], // Match 1 (4v5)
            players[1], players[6], // Match 2 (2v7)
            players[2], players[5]  // Match 3 (3v6)
          ];
        } else if (size === 16) {
          seededPlayers = [
            players[0], players[15], // 1v16
            players[7], players[8],  // 8v9
            players[3], players[12], // 4v13
            players[4], players[11], // 5v12
            players[1], players[14], // 2v15
            players[6], players[9],  // 7v10
            players[2], players[13], // 3v14
            players[5], players[10]  // 6v11
          ];
        } else if (size === 32) {
          // 32-player bracket: 1v32, 16v17, 8v25, 9v24, 4v29, 13v20, 5v28, 12v21,
          // 2v31, 15v18, 7v26, 10v23, 3v30, 14v19, 6v27, 11v22
          seededPlayers = [
            players[0],  players[31], // 1v32
            players[15], players[16], // 16v17
            players[7],  players[24], // 8v25
            players[8],  players[23], // 9v24
            players[3],  players[28], // 4v29
            players[12], players[19], // 13v20
            players[4],  players[27], // 5v28
            players[11], players[20], // 12v21
            players[1],  players[30], // 2v31
            players[14], players[17], // 15v18
            players[6],  players[25], // 7v26
            players[9],  players[22], // 10v23
            players[2],  players[29], // 3v30
            players[13], players[18], // 14v19
            players[5],  players[26], // 6v27
            players[10], players[21]  // 11v22
          ];
        } else {
          seededPlayers = players;
        }
      } else {
        seededPlayers = players; // Shuffled directly
      }
    }

    // Build tournament matches indices flat array
    const matches: TournamentMatch[] = [];
    let currentRoundPlayersCount: number = tourneySize;
    let roundIndex = 0;

    while (currentRoundPlayersCount >= 2) {
      const matchCountInRound = currentRoundPlayersCount / 2;
      for (let m = 0; m < matchCountInRound; m++) {
        const matchItem: TournamentMatch = {
          id: `m_${roundIndex}_${m}`,
          round: roundIndex,
          matchIndex: m,
          voted: false,
          votes: {},
          votesA: 0,
          votesB: 0
        };

        if (roundIndex === 0) {
          matchItem.trackAId = seededPlayers[m * 2].id;
          matchItem.trackBId = seededPlayers[m * 2 + 1].id;
        }

        matches.push(matchItem);
      }
      currentRoundPlayersCount = matchCountInRound;
      roundIndex++;
    }

    const tId = generateId('tourney');
    const newTourney: Tournament = {
      id: tId,
      name: tourneyName.trim() || 'Championship Tournament',
      size: tourneySize,
      typeFilter: tourneyFilter,
      currentRound: 0,
      currentMatchIndex: 0,
      matches,
      status: 'active',
      isOnline,
      votingDuration: isOnline ? votingDuration : undefined,
      // Online tournaments ALWAYS auto-advance — pacing controls removed per spec.
      matchEndTime: isOnline ? Date.now() + votingDuration * 1000 : undefined,
      privacy: isOnline ? lobbyPrivacy : undefined,
      lobbyPassword: isOnline && lobbyPrivacy === 'private' ? lobbyPassword : undefined,
      createdBy: currentUser?.email || 'Guest Contender',
      createdByUsername: currentUser?.username || 'Guest',
      historyLog: [],
    };

    if (isOnline) {
      onUpdateFullTournament(newTourney);
      onSelectOnlineTournamentId(newTourney.id);
    } else {
      onUpdateLocalTournament(newTourney);
    }

    toast.success(`Success! Generated high-fidelity ${isOnline ? 'Online live' : 'Offline local'} bracket!`);
  };

  // Resolve current active match
  const currentActiveMatch = useMemo(() => {
    if (!activeTournament) return null;
    return activeTournament.matches.find(
      m => m.round === activeTournament.currentRound && m.matchIndex === activeTournament.currentMatchIndex
    ) || null;
  }, [activeTournament]);

  // Map contestants
  const matchTracks = useMemo(() => {
    if (!currentActiveMatch) return { a: null, b: null };
    const a = tracks.find(t => t.id === currentActiveMatch.trackAId) || null;
    const b = tracks.find(t => t.id === currentActiveMatch.trackBId) || null;
    return { a, b };
  }, [currentActiveMatch, tracks]);

  // Check if voter has already voted in this specific active match
  const userHasVotedInActiveMatch = useMemo(() => {
    if (!activeTournament || !currentActiveMatch) return false;
    if (hasVotedInCurrentMatch) return true;
    if (!activeTournament.isOnline) return hasVotedInCurrentMatch;
    return currentActiveMatch.votes?.[voterId] !== undefined;
  }, [activeTournament, currentActiveMatch, voterId, hasVotedInCurrentMatch]);

  const userVotedSide = useMemo<'A' | 'B' | null>(() => {
    if (!userHasVotedInActiveMatch || !matchTracks.a || !matchTracks.b) return null;
    if (activeTournament?.isOnline) {
      return currentActiveMatch?.votes?.[voterId] as 'A' | 'B' | null;
    } else {
      if (voteOverlayResult?.winnerId === matchTracks.a.id) return 'A';
      if (voteOverlayResult?.winnerId === matchTracks.b.id) return 'B';
    }
    return null;
  }, [userHasVotedInActiveMatch, activeTournament, voterId, currentActiveMatch, voteOverlayResult, matchTracks]);

  // Countdown timer calculation
  const secondsLeft = useMemo(() => {
    if (!activeTournament || !activeTournament.isOnline || !activeTournament.matchEndTime) return 0;
    return Math.max(0, Math.ceil((activeTournament.matchEndTime - currentTime) / 1000));
  }, [activeTournament, currentTime]);

  const isMatchRevealed = useMemo(() => {
    if (!activeTournament) return false;
    if (!activeTournament.isOnline) return voteOverlayResult !== null;
    // Online: results are revealed automatically when the timer expires — no manual host action required.
    return secondsLeft === 0;
  }, [activeTournament, currentActiveMatch, secondsLeft, voteOverlayResult]);

  // Dynamically calculate online community + real Twitch IRC votes in real time
  const aVotes = useMemo(() => {
    if (!currentActiveMatch) return 0;
    let base = 0;
    if (activeTournament?.isOnline) {
      if (!currentActiveMatch.votes) base = currentActiveMatch.votesA || 0;
      else base = Object.values(currentActiveMatch.votes).filter(v => v === 'A').length;
    } else {
      base = voteOverlayResult?.winnerId === matchTracks.a?.id ? 1 : 0;
    }
    const twitchAddon = isTwitchConnected ? twitchVotesLog.filter(v => v.vote === 'A').length : 0;
    return base + twitchAddon;
  }, [currentActiveMatch, activeTournament?.isOnline, voteOverlayResult, matchTracks.a?.id, isTwitchConnected, twitchVotesLog]);

  const bVotes = useMemo(() => {
    if (!currentActiveMatch) return 0;
    let base = 0;
    if (activeTournament?.isOnline) {
      if (!currentActiveMatch.votes) base = currentActiveMatch.votesB || 0;
      else base = Object.values(currentActiveMatch.votes).filter(v => v === 'B').length;
    } else {
      base = voteOverlayResult?.winnerId === matchTracks.b?.id ? 1 : 0;
    }
    const twitchAddon = isTwitchConnected ? twitchVotesLog.filter(v => v.vote === 'B').length : 0;
    return base + twitchAddon;
  }, [currentActiveMatch, activeTournament?.isOnline, voteOverlayResult, matchTracks.b?.id, isTwitchConnected, twitchVotesLog]);

  // Dynamic vote change tracking refs and effects for juicy animations
  const prevA = useRef(0);
  const prevB = useRef(0);

  useEffect(() => {
    if (aVotes > prevA.current) {
      setPulseSide('A');
      setPulseCount(p => p + 1);
    }
    prevA.current = aVotes;
  }, [aVotes]);

  useEffect(() => {
    if (bVotes > prevB.current) {
      setPulseSide('B');
      setPulseCount(p => p + 1);
    }
    prevB.current = bVotes;
  }, [bVotes]);

  // Reset streamer votes on match change
  useEffect(() => {
    setTwitchVotesLog([]);
    setHasVotedInCurrentMatch(false);
    prevA.current = 0;
    prevB.current = 0;
  }, [currentActiveMatch?.id, activeTournament?.id]);

  // Twitch IRC Chat WebSocket client (Anonymous login serverless reader)
  useEffect(() => {
    if (!isTwitchConnected || !twitchChannel) return;

    let ws: WebSocket | null = null;
    let pingInterval: any = null;

    try {
      ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

      ws.onopen = () => {
        toast.success(`Listening to Twitch Chat in #${twitchChannel}!`);
        ws?.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws?.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
        ws?.send(`JOIN #${twitchChannel.toLowerCase().trim()}`);
        
        pingInterval = setInterval(() => {
          ws?.send('PING');
        }, 30000);
      };

      ws.onmessage = (event) => {
        const data = event.data as string;
        if (data.startsWith('PING')) {
          ws?.send('PONG :tmi.twitch.tv');
          return;
        }

        const msgMatch = data.match(/:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)/);
        if (msgMatch) {
          const username = msgMatch[1];
          let text = msgMatch[2].trim().replace(/\r?\n|\r/g, "");
          
          // Add to chat feed window
          const newChatMsg = { id: Math.random().toString(), user: username, text };
          setChatMessagesLog(prev => [newChatMsg, ...prev].slice(0, 30));

          // Evaluate vote triggers: 1, 2, !1, !2, A, B, !vote A, !vote B
          const txt = text.toLowerCase();
          let voteVal: 'A' | 'B' | null = null;
          if (txt === '1' || txt === '!1' || txt === 'a' || txt === '!vote a' || txt === '!vote 1') {
            voteVal = 'A';
          } else if (txt === '2' || txt === '!2' || txt === 'b' || txt === '!vote b' || txt === '!vote 2') {
            voteVal = 'B';
          }

          if (voteVal) {
            setTwitchVotesLog(prev => {
              const existingIndex = prev.findIndex(v => v.user === username);
              if (existingIndex !== -1) {
                const updated = [...prev];
                updated[existingIndex] = { id: Math.random().toString(), user: username, vote: voteVal!, timestamp: Date.now() };
                return updated;
              } else {
                return [...prev, { id: Math.random().toString(), user: username, vote: voteVal!, timestamp: Date.now() }];
              }
            });
            handleGlobalReaction(voteVal === 'A' ? '⚡' : '🔥');
          }
        }
      };

      ws.onerror = () => {
        setIsTwitchConnected(false);
        toast.error("Twitch WS Connection lost!");
      };

      ws.onclose = () => {
        setIsTwitchConnected(false);
      };

    } catch (e) {
      console.error(e);
      setIsTwitchConnected(false);
    }

    return () => {
      if (ws) ws.close();
      if (pingInterval) clearInterval(pingInterval);
    };
  }, [isTwitchConnected, twitchChannel]);

  // NOTE: Simulated audience chat generator removed per spec — streamers want
  // REAL chat integration (Twitch IRC above), not a fake bot. Old generator
  // lived here and produced pseudo-random "GokuSuper", "Mikasa_Ack" etc. messages.

  const [championConfettiRan, setChampionConfettiRan] = useState<string | null>(null);

  useEffect(() => {
    if (activeTournament?.status === 'completed' && activeTournament.winnerId && championConfettiRan !== activeTournament.id) {
      setChampionConfettiRan(activeTournament.id);
      
      // Play celebratory level-up fanfare sound
      playLevelUpFanfare();
      // Also play the Howler champion fanfare (C-E-G-C-E arpeggio)
      playChampionFanfare();
      
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#FF3D2E', '#3DDC84', '#FFD1CC', '#3FA9F5', '#1B2E4A', '#FFD34D']
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#FF3D2E', '#3DDC84', '#FFD1CC', '#3FA9F5', '#1B2E4A', '#FFD34D']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      
      if (window.navigator?.vibrate) {
         window.navigator.vibrate([80, 50, 80, 50, 80]); // extra pulse for champion
      }

      frame();
    }
  }, [activeTournament?.status, activeTournament?.winnerId, activeTournament?.id, championConfettiRan]);

  // NOTE: the per-match confetti burst was moved into <TournamentMatchDuel />.
  // It fires its own WINNER_COLORS burst via fireConfettiBurst() when the
  // match transitions to `revealed`. The champion celebration confetti
  // effect further below is separate and untouched (kept rainbow per spec).

  const clickTimeoutRef = React.useRef<{ A: any; B: any }>({ A: null, B: null });
  const lastClickRef = React.useRef<{ side: 'A' | 'B' | null; time: number }>({ side: null, time: 0 });

  const handleTournamentCardClick = (side: 'A' | 'B', track: AnimeTrack) => {
    if (userHasVotedInActiveMatch) return;
    if (activeTournament?.isOnline && isMatchRevealed) return;

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
      
      // Play satisfying success double-tap verification pop sound
      playTactileSound('success');
      
      handleVoteTournament(side);
    } else {
      lastClickRef.current = { side, time: now };
      
      // Play crisp tactical pop audio signal
      playTactileSound(side === 'A' ? 'primary' : 'rose');
      
      if (clickTimeoutRef.current[side]) {
        clearTimeout(clickTimeoutRef.current[side]);
      }

      clickTimeoutRef.current[side] = setTimeout(() => {
        clickTimeoutRef.current[side] = null;
        if (activeTournament?.isOnline && activeTournament.createdBy === voterId) {
          onUpdateFullTournament({ ...activeTournament, currentlyPlayingId: track.id });
        }
        onPlay(track);
      }, 250);
    }
  };

  // Handle Voting (Bifurcated: Online syncs immediately to Firestore, Offline updates local browser state)
  const handleVoteTournament = (votedFor: 'A' | 'B') => {
    if (!activeTournament || !currentActiveMatch || userHasVotedInActiveMatch) return;
    // Late-vote guard: once the host has settled this match (voted=true),
    // any further vote clicks must be ignored — otherwise the vote gets
    // recorded into a match that already has a winnerId, and the tug-of-war
    // bar would update after the result is already locked in.
    if (activeTournament.isOnline && currentActiveMatch.voted) return;
    const { a: trA, b: trB } = matchTracks;
    if (!trA || !trB) return;

    if (window.navigator?.vibrate) {
       window.navigator.vibrate(15);
    }

    // Stop currently playing track
    onPlay(null as unknown as AnimeTrack);

    // Instant local vote stamp so network latency cannot allow fast duplicate click injections
    setHasVotedInCurrentMatch(true);
    
    if (activeTournament.isOnline) {
      // In online mode: record vote immediately into the match schema and save to Firestore.
      // IMPORTANT: clone the matches array — `...activeTournament` is a shallow copy
      // and would otherwise mutate the prop's array (which silently breaks React's
      // change detection downstream, e.g. the tug-of-war bar wouldn't re-animate).
      const updatedTourney = {
        ...activeTournament,
        matches: activeTournament.matches.map(m => m.id === currentActiveMatch.id ? { ...m } : m),
      };
      const mIndex = updatedTourney.matches.findIndex(m => m.id === currentActiveMatch.id);
      if (mIndex !== -1) {
        const targetMatch = updatedTourney.matches[mIndex];
        const votesMap = targetMatch.votes ? { ...targetMatch.votes } : {};
        votesMap[voterId] = votedFor;
        targetMatch.votes = votesMap;
        targetMatch.votesA = (targetMatch.votesA || 0) + (votedFor === 'A' ? 1 : 0);
        targetMatch.votesB = (targetMatch.votesB || 0) + (votedFor === 'B' ? 1 : 0);
      }
      onUpdateFullTournament(updatedTourney);
      toast.success(`Your live vote was locked for ${votedFor === 'A' ? trA.title : trB.title}!`);
    } else {
      // For offline: lock vote state locally
      const winnerId = votedFor === 'A' ? trA.id : trB.id;
      const eloChanges = calculateNewRatings(trA.elo, trB.elo, votedFor, 32, voterCoefficient);
      setVoteOverlayResult({
        winnerId,
        loserId: votedFor === 'A' ? trB.id : trA.id,
        changes: {
          aBefore: trA.elo,
          aAfter: eloChanges.newRatingA,
          bBefore: trB.elo,
          bAfter: eloChanges.newRatingB,
          changeA: eloChanges.changeA,
          changeB: eloChanges.changeB,
        }
      });
      toast.success(`Logged vote locally for ${votedFor === 'A' ? trA.title : trB.title}!`);
    }
  };

  // Advancing Offline Solo step
  const handleNextTournamentStep = () => {
    if (!activeTournament || !currentActiveMatch || !voteOverlayResult) return;
    const { a: trA, b: trB } = matchTracks;
    if (!trA || !trB) return;

    const winnerId = voteOverlayResult.winnerId;
    const outcomeStr: 'A' | 'B' = voteOverlayResult.winnerId === trA.id ? 'A' : 'B';

    // Commit global track rating adjustments immediately as this is our direct choice
    onVoteInTournament(trA.id, trB.id, outcomeStr, voteOverlayResult.changes);

    // Clone matches + historyLog — see handleSettleOnlineMatch for the
    // rationale (avoid mutating the prop's arrays).
    const updatedTourney = {
      ...activeTournament,
      matches: activeTournament.matches.map(m =>
        m.id === currentActiveMatch.id ? { ...m, winnerId, voted: true } : m
      ),
      historyLog: [
        ...activeTournament.historyLog,
        {
          matchId: currentActiveMatch.id,
          trackA: trA.title,
          trackB: trB.title,
          winner: winnerId === trA.id ? trA.title : trB.title,
          eloChanges: {
            aBefore: trA.elo,
            aAfter: voteOverlayResult.changes.aAfter,
            bBefore: trB.elo,
            bAfter: voteOverlayResult.changes.bAfter,
          }
        },
      ],
    };

    advanceTournamentIndices(updatedTourney, winnerId);
  };

  const handleRevealOnlineMatch = () => {
    // Pacing controls removed per spec — online matches always auto-settle when
    // the timer expires. This function is retained as a no-op for backward
    // compatibility with any pre-existing tournaments that may still carry
    // a stale `pacingMode === 'manual'` flag in Firestore — calling it has no effect.
    return;
  };

  // Real-time Cloud automatic/interactive settlement of an ended online match
  const handleSettleOnlineMatch = () => {
    if (!activeTournament || !currentActiveMatch || !activeTournament.isOnline) return;
    const { a: trA, b: trB } = matchTracks;
    if (!trA || !trB) return;

    const votesA = currentActiveMatch.votes ? Object.values(currentActiveMatch.votes).filter(v => v === 'A').length : (currentActiveMatch.votesA || 0);
    const votesB = currentActiveMatch.votes ? Object.values(currentActiveMatch.votes).filter(v => v === 'B').length : (currentActiveMatch.votesB || 0);

    // Determine aggregate outcome
    let votedOutcome: 'A' | 'B' = 'A';
    if (votesB > votesA) {
      votedOutcome = 'B';
    } else if (votesA === votesB) {
      votedOutcome = trA.elo >= trB.elo ? 'A' : 'B'; // Seeding tiebreaker (higher seed wins)
    }

    const winnerId = votedOutcome === 'A' ? trA.id : trB.id;

    // ELO rating adjustments calculation based on community consensus outcome!
    // Tournaments DO affect global ELO rankings cleanly
    const eloChanges = calculateNewRatings(trA.elo, trB.elo, votedOutcome, 32, voterCoefficient);
    const trackingChanges = {
      aBefore: trA.elo,
      aAfter: eloChanges.newRatingA,
      bBefore: trB.elo,
      bAfter: eloChanges.newRatingB,
      changeA: eloChanges.changeA,
      changeB: eloChanges.changeB,
    };

    // Commit Elo adjustment live to the Tracks database!
    onVoteInTournament(trA.id, trB.id, votedOutcome, trackingChanges);

    // IMPORTANT: clone both the matches array AND the historyLog array.
    // `{ ...activeTournament }` alone is a shallow copy — both arrays
    // below would be the SAME REFERENCE as the prop, and the mutations
    // would silently corrupt the parent's state (winner-screen flicker,
    // history log double-counting on next poll, etc.).
    const updatedTourney = {
      ...activeTournament,
      matches: activeTournament.matches.map(m =>
        m.id === currentActiveMatch.id ? { ...m, winnerId, voted: true } : m
      ),
      historyLog: [
        ...activeTournament.historyLog,
        {
          matchId: currentActiveMatch.id,
          trackA: trA.title,
          trackB: trB.title,
          winner: votedOutcome === 'A' ? trA.title : trB.title,
          eloChanges: {
            aBefore: trA.elo,
            aAfter: eloChanges.newRatingA,
            bBefore: trB.elo,
            bAfter: eloChanges.newRatingB,
          }
        },
      ],
    };

    // Reset online match timer for next level pairing countdown
    updatedTourney.matchEndTime = Date.now() + (activeTournament.votingDuration || 60) * 1000;

    advanceTournamentIndices(updatedTourney, winnerId);
    toast.success(`Online Settle completed: "${winnerId === trA.id ? trA.title : trB.title}" won the vote!`);
  };

  useEffect(() => {
    // Online tournaments ALWAYS auto-advance when the timer hits 0 — pacing
    // controls removed per spec. The host's `createdBy === voterId` check
    // ensures only the host's tab triggers the settle (avoids duplicate writes
    // when multiple viewers are watching the same lobby).
    if (activeTournament && activeTournament.isOnline && activeTournament.createdBy === voterId) {
      if (secondsLeft === 0 && currentActiveMatch && !currentActiveMatch.voted) {
        handleSettleOnlineMatch();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, activeTournament?.id, currentActiveMatch?.id, currentActiveMatch?.voted]);

  // Shared progression index helper
  const advanceTournamentIndices = (updatedTourney: Tournament, lastWinnerId: string) => {
    const totalRounds = Math.log2(updatedTourney.size);
    const isFinals = updatedTourney.currentRound === (totalRounds - 1);

    if (isFinals) {
      updatedTourney.winnerId = lastWinnerId;
      updatedTourney.status = 'completed';
    } else {
      // Find where to propagate winner in next round index
      const nextRoundIndex = updatedTourney.currentRound + 1;
      const nextMatchIndex = Math.floor(updatedTourney.currentMatchIndex / 2);
      const slot = updatedTourney.currentMatchIndex % 2 === 0 ? 'trackAId' : 'trackBId';

      const nextMatchSearchIndex = updatedTourney.matches.findIndex(
        m => m.round === nextRoundIndex && m.matchIndex === nextMatchIndex
      );

      if (nextMatchSearchIndex !== -1) {
        updatedTourney.matches[nextMatchSearchIndex][slot] = lastWinnerId;
      }

      // Progress active match tracker indexes
      const matchesInThisRound = updatedTourney.size / Math.pow(2, updatedTourney.currentRound + 1);
      if (updatedTourney.currentMatchIndex + 1 < matchesInThisRound) {
        updatedTourney.currentMatchIndex += 1;
      } else {
        // Round completion - progress to next level
        updatedTourney.currentRound += 1;
        updatedTourney.currentMatchIndex = 0;
      }
    }

    if (updatedTourney.isOnline) {
      onUpdateFullTournament(updatedTourney);
    } else {
      onUpdateLocalTournament(updatedTourney);
    }

    setHasVotedInCurrentMatch(false);
    setSelectedCandidate(null);
    setVoteOverlayResult(null);
  };

  const handleLeaveViewedTournament = () => {
    onSelectOnlineTournamentId(null);
    toast.info("Returned to Championship Lobby.");
  };

  const handleRemoveLocalForfeit = () => {
    onUpdateLocalTournament(null);
    toast.success("Cleared local solo bracket progress.");
  };

  // Helper mappers for UI rounds display
  const roundNames = useMemo(() => {
    if (!activeTournament) return {};
    const size = activeTournament.size;
    if (size === 4) {
      return { 0: 'Semifinals', 1: 'Grand Finals' };
    } else if (size === 8) {
      return { 0: 'Quarterfinals', 1: 'Semifinals', 2: 'Grand Finals' };
    } else if (size === 16) {
      return { 0: 'Round of 16', 1: 'Quarterfinals', 2: 'Semifinals', 3: 'Grand Finals' };
    } else {
      // size === 32
      return { 0: 'Round of 32', 1: 'Round of 16', 2: 'Quarterfinals', 3: 'Semifinals', 4: 'Grand Finals' };
    }
  }, [activeTournament]);

  const matchesByRound = useMemo(() => {
    if (!activeTournament) return [];
    const totalRounds = Math.log2(activeTournament.size);
    const roundsArr = [];
    for (let r = 0; r < totalRounds; r++) {
      const matchLimit = activeTournament.size / Math.pow(2, r + 1);
      const roundMatches = activeTournament.matches.filter(m => m.round === r).slice(0, matchLimit);
      roundsArr.push({
        num: r,
        name: roundNames[r] || `Round ${r + 1}`,
        matches: roundMatches,
      });
    }
    return roundsArr;
  }, [activeTournament, roundNames]);

  // Online capacity constraints limit (Max 5 running online tournaments)
  const currentOnlineBrackets = useMemo(() => {
    return availableTournaments.filter(t => t.isOnline && t.status === 'active');
  }, [availableTournaments]);

  const canHostNewOnline = currentOnlineBrackets.length < 5;

  // ── OBS Browser Source overlay render ──────────────────────────────────
  // When `?obs=1` is in the URL, this is the ONLY thing we render — no nav,
  // no setup panels, no inputs. Just broadcast-safe elements composited on a
  // transparent body background (forced via the useEffect above).
  //
  // Layout (1280×720 reference):
  //   - Top: huge countdown timer (red when ≤10s) + "VOTE NOW" prompt
  //   - Middle: Track A (left, cyan accent) vs Track B (right, rose accent) with VS badge
  //   - Bottom: tug-of-war vote bar with live percentages
  //   - Bottom strip: last 5 chat messages (real Twitch IRC)
  //   - When champion is crowned: full-takeover winner banner
  if (isObsOverlayMode) {
    // No active tournament in overlay mode — show a "waiting" state so OBS
    // doesn't render a blank page when the lobby hasn't started yet.
    if (!activeTournament) {
      return (
        <div style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono), monospace',
          color: '#FF3D2E',
          fontSize: '14px',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          opacity: 0.6,
        }}>
          ⏳ Waiting for tournament to start…
        </div>
      );
    }

    // Champion crowned — full-takeover banner
    if (activeTournament.status === 'completed' && activeTournament.winnerId) {
      const championTrack = tracks.find(t => t.id === activeTournament.winnerId);
      return (
        <div style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          color: '#ffb800',
          fontFamily: 'var(--font-display), sans-serif',
        }}>
          <div style={{ fontSize: '48px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.04em', textAlign: 'center', textShadow: '0 0 40px rgba(255, 211, 77,0.6)' }}>
            🏆 CHAMPION 🏆
          </div>
          {championTrack && (
            <>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', textAlign: 'center', maxWidth: '1100px' }}>
                {championTrack.title}
              </div>
              <div style={{ fontSize: '18px', color: '#9C9078', fontStyle: 'italic' }}>
                by {championTrack.artist}
              </div>
              <div style={{ fontSize: '14px', color: '#FF3D2E', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                {championTrack.animeName}
              </div>
            </>
          )}
        </div>
      );
    }

    const trA = matchTracks.a;
    const trB = matchTracks.b;
    const totalVotes = aVotes + bVotes;
    const pctA = totalVotes === 0 ? 50 : Math.round((aVotes / totalVotes) * 100);
    const pctB = totalVotes === 0 ? 50 : 100 - pctA;
    const isUrgent = secondsLeft <= 10 && secondsLeft > 0;
    const isClosed = secondsLeft === 0;

    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        padding: '32px 48px',
        color: '#fff',
        fontFamily: 'var(--font-sans), sans-serif',
      }}>
        {/* Top: tournament name + huge countdown timer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#FF3D2E', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}>
              {activeTournament.isOnline ? '● LIVE COMMUNITY FIGHT' : 'OFFLINE BRACKET'}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, textTransform: 'uppercase', marginTop: '4px', color: '#F4ECDB' }}>
              {activeTournament.name}
            </div>
            <div style={{ fontSize: '12px', color: '#9C9078', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '2px' }}>
              {roundNames[activeTournament.currentRound]} · Match {activeTournament.currentMatchIndex + 1}
            </div>
          </div>
          {activeTournament.isOnline && (
            <div style={{
              fontSize: '88px',
              fontWeight: 900,
              fontFamily: 'var(--font-display), sans-serif',
              color: isClosed ? '#C81E55' : isUrgent ? '#C81E55' : '#F4ECDB',
              lineHeight: 1,
              textShadow: isUrgent || isClosed ? '0 0 30px rgba(200, 30, 85,0.6)' : 'none',
              transform: isUrgent ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform 0.2s ease-out',
            }}>
              {Math.floor(secondsLeft / 60).toString().padStart(2, '0')}:{(secondsLeft % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Middle: Track A vs Track B */}
        {trA && trB ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flex: 1 }}>
            {/* Track A — cyan accent */}
            <div style={{
              flex: 1,
              padding: '20px 24px',
              border: `2px solid ${isMatchRevealed && currentActiveMatch?.winnerId === trA.id ? '#3DDC84' : '#FF3D2E'}`,
              borderLeftWidth: '6px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(255, 61, 46,0.08), transparent)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              <div style={{ fontSize: '11px', color: '#FF3D2E', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}>
                ◂ A — Vote "1" in chat
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#F4ECDB', textTransform: 'uppercase', lineHeight: 1.1 }}>
                {trA.title}
              </div>
              <div style={{ fontSize: '14px', color: '#9C9078', fontStyle: 'italic' }}>
                by {trA.artist}
              </div>
              <div style={{ fontSize: '12px', color: '#FF3D2E', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {trA.animeName} · {trA.type}
              </div>
            </div>

            {/* VS badge */}
            <div style={{
              fontSize: '32px',
              fontWeight: 900,
              color: '#ffb800',
              fontFamily: 'var(--font-display), sans-serif',
              textShadow: '0 0 20px rgba(255, 211, 77,0.5)',
              padding: '0 8px',
            }}>
              VS
            </div>

            {/* Track B — rose accent */}
            <div style={{
              flex: 1,
              padding: '20px 24px',
              border: `2px solid ${isMatchRevealed && currentActiveMatch?.winnerId === trB.id ? '#3DDC84' : '#3FA9F5'}`,
              borderRightWidth: '6px',
              borderRadius: '12px',
              background: 'linear-gradient(225deg, rgba(63, 169, 245,0.08), transparent)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              textAlign: 'right',
              alignItems: 'flex-end',
            }}>
              <div style={{ fontSize: '11px', color: '#3FA9F5', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}>
                Vote "2" in chat — B ▸
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#F4ECDB', textTransform: 'uppercase', lineHeight: 1.1 }}>
                {trB.title}
              </div>
              <div style={{ fontSize: '14px', color: '#9C9078', fontStyle: 'italic' }}>
                by {trB.artist}
              </div>
              <div style={{ fontSize: '12px', color: '#3FA9F5', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {trB.animeName} · {trB.type}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9C9078', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            ⏳ Loading next matchup…
          </div>
        )}

        {/* Tug-of-war vote bar */}
        {trA && trB && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
              <span style={{ color: '#FF3D2E' }}>A — {aVotes} vote{aVotes === 1 ? '' : 's'} ({pctA}%)</span>
              <span style={{ color: '#3FA9F5' }}>B — {bVotes} vote{bVotes === 1 ? '' : 's'} ({pctB}%)</span>
            </div>
            <div style={{ height: '24px', borderRadius: '12px', background: '#3FA9F5', overflow: 'hidden', display: 'flex', border: '1px solid rgba(244, 236, 219,0.1)' }}>
              <div style={{
                width: `${pctA}%`,
                background: 'linear-gradient(90deg, #FF3D2E, #D0220F)',
                transition: 'width 0.5s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                paddingLeft: '12px',
                fontSize: '11px',
                fontWeight: 800,
                color: '#100C0A',
                fontFamily: 'var(--font-mono), monospace',
              }}>
                {pctA > 15 ? `${pctA}%` : ''}
              </div>
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: '12px',
                fontSize: '11px',
                fontWeight: 800,
                color: '#100C0A',
                fontFamily: 'var(--font-mono), monospace',
              }}>
                {pctB > 15 ? `${pctB}%` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Bottom: chat ticker (last 5 messages) */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          maxHeight: '120px',
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: '10px', color: '#9C9078', fontFamily: 'var(--font-mono), monospace', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}>
            {isTwitchConnected ? `● Twitch Chat #${twitchChannel}` : 'Chat offline — connect via Streamer Hub'}
          </div>
          {chatMessagesLog.slice(0, 5).map(msg => {
            const txt = msg.text.toLowerCase();
            const isVoteA = txt === '1' || txt === '!1' || txt === 'a' || txt === '!vote a' || txt === '!vote 1';
            const isVoteB = txt === '2' || txt === '!2' || txt === 'b' || txt === '!vote b' || txt === '!vote 2';
            const color = isVoteA ? '#FF3D2E' : isVoteB ? '#3FA9F5' : '#9C9078';
            return (
              <div key={msg.id} style={{ fontSize: '12px', fontFamily: 'var(--font-mono), monospace', color, display: 'flex', gap: '8px' }}>
                <span style={{ color: '#C9BC9C', fontWeight: 700, minWidth: '120px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.user}:</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!activeTournament ? (
        /* LOBBY & GENERATION MAIN VIEWPORT */
        <div className="max-w-4xl mx-auto space-y-10">
          
          {/* Page Headers */}
          <div className="text-center space-y-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-gold/10 text-gold-bright font-mono text-xs font-black uppercase tracking-widest border border-gold/20">
              <Trophy className="w-4 h-4" /> TOURNAMENT STAGE
            </span>
            <h2 className="font-display font-black text-3xl lg:text-4xl text-white uppercase tracking-tighter">
              Anime Theme Battles & Brackets
            </h2>
            <p className="text-zinc-400 text-sm max-w-xl mx-auto leading-relaxed">
              Play offline brackets at your own pace, or spawn a live cloud bracket interval where hundreds of global Otakus vote concurrently in real-time!
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            <div className="lg:col-span-7 space-y-6 text-left">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-gold-bright" />
                <h3 className="font-display font-black text-sm text-zinc-400 uppercase tracking-wider">
                  🔥 Live Running Online Brackets
                </h3>
                <span className="ml-auto font-mono text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-500 px-2 py-0.5 rounded-sm">
                  {currentOnlineBrackets.length} / 5 CLOUD SLOTS
                </span>
              </div>

              {currentOnlineBrackets.length === 0 ? (
                <div className="p-10 border border-dashed border-zinc-900 bg-zinc-950/25 rounded-2xl text-center flex flex-col items-center justify-center space-y-3 select-none">
                  <Compass className="w-8 h-8 text-zinc-800 animate-spin" style={{ animationDuration: '8s' }} />
                  <p className="text-zinc-400 font-sans text-sm font-semibold">No live community battles right now</p>
                  <p className="text-zinc-500 font-mono text-[11px] uppercase">Build a custom bracket below and toggle "Online Mode" to host one.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {currentOnlineBrackets.map((ct) => {
                    const activeMatch = ct.matches.find(m => m.round === ct.currentRound && m.matchIndex === ct.currentMatchIndex);
                    const secondsRemaining = ct.matchEndTime ? Math.max(0, Math.ceil((ct.matchEndTime - currentTime) / 1000)) : 0;
                    
                    return (
                      <div 
                        key={ct.id} 
                        className="bg-zinc-950/60 hover:bg-zinc-950 border border-zinc-900 hover:border-brand-primary/40 rounded-2xl p-5 relative overflow-hidden transition-all group flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-mono font-black text-moss bg-moss/10 border border-moss/20 px-2 py-0.5 rounded-md uppercase tracking-widest">
                              LIVE COMMUNITY PLAY
                            </span>
                            {secondsRemaining > 0 ? (
                              <span className="text-[11px] font-mono text-gold-bright flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> {Math.floor(secondsRemaining / 60)}:{(secondsRemaining % 60).toString().padStart(2, '0')}
                              </span>
                            ) : (
                              <span className="text-[11px] font-mono text-vermillion flex items-center gap-1 font-bold">
                                TIME EXPIRED
                              </span>
                            )}
                          </div>

                          <div>
                            <h4 className="font-display font-black text-white text-base leading-tight uppercase line-clamp-1 group-hover:text-brand-primary transition-colors">
                              {ct.name}
                            </h4>
                            <p className="text-zinc-500 text-[11px] font-mono uppercase mt-0.5">
                              Hosted by: <span className="text-zinc-400 font-bold">{ct.createdByUsername || 'Guest'}</span> • Category: <span className="text-gold-bright font-black">{ct.typeFilter}</span>
                            </p>
                          </div>

                          {activeMatch && (
                            <div className="bg-[#0b0b0e] border border-zinc-900/60 rounded-lg p-3 text-xs flex justify-between items-center text-zinc-400 uppercase font-mono">
                              <span className="font-bold max-w-[140px] truncate" title={tracks.find(t => t.id === activeMatch.trackAId)?.title}>
                                {tracks.find(t => t.id === activeMatch.trackAId)?.title || 'TBD'}
                              </span>
                              <span className="text-[11px] text-brand-primary font-black shrink-0 px-2.5">VS</span>
                              <span className="font-bold max-w-[140px] truncate block text-right" title={tracks.find(t => t.id === activeMatch.trackBId)?.title}>
                                {tracks.find(t => t.id === activeMatch.trackBId)?.title || 'TBD'}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-zinc-900/40">
                          <span className="text-[11px] font-mono text-zinc-500 uppercase">
                            {(() => {
                              const names: Record<number, string[]> = {
                                4: ['Semifinals', 'Grand Finals'],
                                8: ['Quarterfinals', 'Semifinals', 'Grand Finals'],
                                16: ['Round of 16', 'Quarterfinals', 'Semifinals', 'Grand Finals'],
                              };
                              const r = (names[ct.size] || [])[ct.currentRound] || `Round ${ct.currentRound + 1}`;
                              return <span>Size: {ct.size} themes • Round: {r}</span>;
                            })()}
                          </span>
                          <button
                            onClick={() => { playTactileSound('success'); onSelectOnlineTournamentId(ct.id); }}
                            className="btn-tactile-primary !py-1.5 !px-4 !text-[11px]"
                          >
                            <span>Vote Live</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Offline Solo ongoing panel */}
              {localTournament && (
                <div className="p-5 bg-[#0e0e11] border border-gold/25 rounded-2xl space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <span className="text-[11px] font-mono font-black text-gold bg-gold/10 px-2 py-0.5 rounded border border-gold/20 uppercase tracking-widest">
                        CONTINUE OFFLINE GRAND PRIX
                      </span>
                      <h4 className="font-display font-black text-white text-base uppercase mt-1 leading-snug">
                        {localTournament.name}
                      </h4>
                      <p className="text-zinc-500 text-[11px] font-mono uppercase">
                        Current match {localTournament.currentMatchIndex + 1} of Round {localTournament.currentRound + 1}
                      </p>
                    </div>
                    <button
                      onClick={handleRemoveLocalForfeit}
                      className="text-zinc-500 hover:text-vermillion font-mono text-[11px] font-bold uppercase py-1 px-2 border border-zinc-900 rounded hover:border-rose-deep transition-colors cursor-pointer"
                      title="Forfeit your current bracket progression"
                    >
                      Reset Bracket
                    </button>
                  </div>
                  <button
                    onClick={() => { playTactileSound('success'); onSelectOnlineTournamentId(null); }} // Unsets online so local loads
                    className="btn-tactile-amber w-full py-3 text-xs"
                  >
                    <span>Keep Playing Bracket Solo</span>
                    <ArrowRight className="w-4 h-4 text-zinc-950" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Hand: Generator setup config panels */}
            <div className="lg:col-span-5 text-left">
              <div className="bg-panel-bg border border-panel-border rounded-2xl p-6 shadow-2xl space-y-6">
                <div className="flex items-center gap-2 pb-3.5 border-b border-zinc-900/80">
                  <Trophy className="w-5 h-5 text-brand-primary" />
                  <h3 className="font-display font-black text-sm text-white uppercase tracking-wider">
                    CHAMPIONSHIP BRACKET BUILDER
                  </h3>
                  <div className="ml-auto text-[11px] font-mono text-zinc-500 font-bold">
                    STEP {setupStep} OF 3
                  </div>
                </div>

                <div className="space-y-4 font-sans relative pb-2">
                  
                  {setupStep === 1 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                      {/* Optional Handcrafted Builder redirection */}
                      {onRequestCustomBuilder && (
                        <div className="p-3.5 rounded-xl border border-dashed border-brand-primary/20 bg-brand-primary/5 flex flex-col gap-2 text-[11px]">
                          <span className="text-zinc-400 font-sans leading-relaxed">
                            Want to pick specific songs manually and fully customize a tournament list instead of auto-seeding?
                          </span>
                          <button
                            type="button"
                            onClick={onRequestCustomBuilder}
                            className="text-left text-brand-primary hover:text-brand-primary/80 font-extrabold uppercase font-mono tracking-wider cursor-pointer flex items-center gap-1 mt-0.5"
                          >
                            <span>Switch to Custom Builder</span> &rarr;
                          </button>
                        </div>
                      )}

                      {/* Tournament mode */}
                      <div className="space-y-2">
                        <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">LOBBY TYPE</label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              playTactileSound('success');
                              setIsOnline(false);
                            }}
                            className={`py-3.5 px-4 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1 active:scale-[0.98] ${
                              !isOnline
                                ? 'bg-gold/10 border-gold/50 text-white font-extrabold shadow-lg ring-1 ring-gold/30'
                                : 'border-zinc-900 bg-zinc-950/60 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300'
                            }`}
                          >
                            <User className="w-4 h-4 mb-0.5" />
                            <span className="font-bold text-[11px] uppercase tracking-wider">Offline Solo</span>
                            <span className="text-[11px] opacity-75 leading-none mt-0.5 block">Self-Paced Play</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              playTactileSound('primary');
                              setIsOnline(true);
                            }}
                            className={`py-3.5 px-4 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1 active:scale-[0.98] ${
                              isOnline
                                ? 'bg-brand-primary/10 border-brand-primary/50 text-white font-extrabold shadow-lg ring-1 ring-brand-primary/30'
                                : 'border-zinc-900 bg-zinc-950/60 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300'
                            }`}
                          >
                            <Users className="w-4 h-4 mb-0.5" />
                            <span className="font-bold text-[11px] uppercase tracking-wider flex items-center gap-1">
                              <span>Online Battle</span>
                            </span>
                            <span className="text-[11px] opacity-75 mt-0.5 block leading-tight">Live synced lobby</span>
                          </button>
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          playTactileSound('success');
                          setTimeout(() => setSetupStep(2), 150);
                        }}
                        className="btn-tactile-primary w-full py-4 text-xs"
                      >
                        Next Step
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {setupStep === 2 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">

                      {/* Tournament Title — moved here from step 1 so step 1 is mode-only */}
                      <div className="space-y-2 col-span-2">
                        <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">TOURNAMENT TITLE</label>
                        <input
                          type="text"
                          placeholder="e.g. Legendary Themes Bracket"
                          value={tourneyName}
                          onChange={e => setTourneyName(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-900 focus:border-brand-primary focus:outline-none rounded-xl px-4 py-3 text-xs text-zinc-300 transition-colors"
                        />
                      </div>

                      {/* Size */}
                      <div className="space-y-2">
                        <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">BRACKET SIZE</label>
                        <div className="grid grid-cols-4 gap-2 bg-zinc-950 p-1 border border-zinc-900 rounded-xl">
                          {([4, 8, 16, 32] as const).map(size => (
                            <button
                              key={size}
                              type="button"
                              onClick={() => {
                                playTactileSound('success');
                                setTourneySize(size);
                              }}
                              className={`py-2 px-1 text-[11px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all active:scale-[0.97] ${
                                tourneySize === size
                                  ? 'bg-zinc-100 text-zinc-950 font-extrabold shadow-sm'
                                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                              }`}
                            >
                              {size} Themes
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Category */}
                      <div className="space-y-2">
                        <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">SONG CATEGORY</label>
                        <div className="flex flex-wrap gap-2 bg-zinc-950 p-2 border border-zinc-900 rounded-xl">
                          {(['OP', 'ED', 'OST'] as string[]).map(f => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => {
                                playTactileSound('success');
                                setTourneyFilter(f);
                              }}
                              className={`flex-1 py-2 px-3 text-[11px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all border active:scale-[0.97] ${
                                tourneyFilter === f
                                  ? 'bg-zinc-100 border-zinc-200 text-zinc-950 font-extrabold shadow-sm'
                                  : 'bg-black/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-90 w-fit border-zinc-900'
                              }`}
                            >
                              {f === 'OP' ? '✨ Openings (OPs)' : f === 'ED' ? '🍃 Endings (EDs)' : '🎻 Soundtracks'}
                            </button>
                          ))}
                          
                          {currentUser?.customLists?.filter((l: any) => l.trackIds.length >= 4).map((list: any) => (
                             <button
                               key={list.id}
                               type="button"
                               onClick={() => {
                                 playTactileSound('rose');
                                 setTourneyFilter(`custom_list_${list.id}`);
                                 setTourneyName(list.name + " Tournament");
                                }}
                               className={`py-2 px-3 text-[11px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all border active:scale-[0.97] ${
                                 tourneyFilter === `custom_list_${list.id}`
                                   ? 'bg-brand-primary/10 border-brand-primary/50 text-white font-extrabold shadow-lg ring-1 ring-brand-primary/30'
                                   : 'bg-black/40 text-brand-primary/80 hover:text-brand-primary border border-brand-primary/30'
                               }`}
                             >
                               ★ {list.name}
                             </button>
                          ))}
                        </div>
                        {currentUser?.customLists?.length === 0 && (
                          <p className="text-[11px] text-zinc-400 mt-1 font-mono">Create lists in your profile to run custom tournaments.</p>
                        )}
                      </div>
                      
                      {/* Seeding & Saved Custom Tourneys Integration */}
                      <div className="space-y-2">
                        <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">PAIRING METHOD</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              playTactileSound('success');
                              setSelectionMethod('seeded');
                              setSelectedSavedTourney(null);
                            }}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all active:scale-[0.98] ${
                              selectionMethod === 'seeded'
                                ? 'bg-gold/10 border-gold/50 text-white font-extrabold shadow-lg ring-1 ring-gold/30'
                                : 'border-zinc-900 bg-zinc-950/65 text-zinc-500 hover:border-zinc-800'
                            }`}
                          >
                            <div className="font-bold text-[11px] uppercase tracking-wider">📈 Rank Seeded</div>
                            <span className="text-[11px] opacity-75 mt-0.5 block leading-tight">Pairs higher rated songs with lower rated ones</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              playTactileSound('success');
                              setSelectionMethod('random');
                              setSelectedSavedTourney(null);
                            }}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all active:scale-[0.98] ${
                              selectionMethod === 'random'
                                ? 'bg-brand-primary/10 border-brand-primary/50 text-white font-extrabold shadow-lg ring-1 ring-brand-primary/30'
                                : 'border-zinc-900 bg-zinc-950/65 text-zinc-500 hover:border-zinc-800'
                            }`}
                          >
                            <div className="font-bold text-[11px] uppercase tracking-wider">🎲 Blind Shuffle</div>
                            <span className="text-[11px] opacity-75 mt-0.5 block leading-tight">Shuffles matches fully at random</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              playTactileSound('success');
                              setSelectionMethod('custom');
                            }}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all active:scale-[0.98] ${
                              selectionMethod === 'custom'
                                ? 'bg-brand-primary/10 border-brand-primary/50 text-white font-extrabold shadow-lg ring-1 ring-brand-primary/30'
                                : 'border-zinc-900 bg-zinc-950/65 text-zinc-500 hover:border-zinc-800'
                            }`}
                          >
                            <div className="font-bold text-[11px] uppercase tracking-wider">🛠️ Custom Saved Tournament</div>
                            <span className="text-[11px] opacity-75 mt-0.5 block leading-tight">Run custom tournaments & brackets you saved</span>
                          </button>
                        </div>
                      </div>

                   {/* Saved custom tournament selector list, displayed only when Saved Tourneys is active selection click */}
                   {selectionMethod === 'custom' && (
                     <motion.div 
                       initial={{ opacity: 0, y: -5 }}
                       animate={{ opacity: 1, y: 0 }}
                       className="space-y-3 bg-zinc-950 p-4 border border-zinc-900 rounded-xl"
                     >
                       <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">SELECT SAVED BRACKET</label>
                       
                       {currentUser?.customTournaments && currentUser.customTournaments.length > 0 ? (
                         <div className="flex flex-wrap gap-2">
                           {currentUser.customTournaments.map((ct: any) => (
                             <button
                               key={ct.id}
                               type="button"
                               onClick={() => {
                                 setSelectedSavedTourney(ct);
                                 setTourneyName(ct.name);
                                 setTourneySize(ct.size);
                               }}
                               className={`py-2 px-3 text-[11px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all border ${
                                 selectedSavedTourney?.id === ct.id
                                   ? 'bg-zinc-100 text-zinc-950 font-extrabold border-transparent'
                                   : 'bg-black/40 text-zinc-400 hover:text-zinc-200 border-zinc-900'
                               }`}
                             >
                               📁 {ct.name} ({ct.size} Songs)
                             </button>
                           ))}
                         </div>
                       ) : (
                         <div className="text-center py-4 px-3 bg-black/40 border border-zinc-900 rounded-lg">
                           <p className="text-xs text-zinc-400 font-bold">No saved brackets found on your profile yet!</p>
                           <p className="text-[11px] text-zinc-500 mt-1 font-sans">
                             Create custom brackets by clicking the "Create Custom Tournament" button above, load songs, and save them. They will appear right here!
                           </p>
                         </div>
                       )}

                       {selectedSavedTourney && (
                         <div className="flex items-center gap-2 bg-neutral-900/40 p-2 border border-neutral-800 text-[11px] font-mono text-neutral-300">
                           <span>Loaded: <strong className="text-white">{selectedSavedTourney.name}</strong> ({selectedSavedTourney.size} songs)</span>
                           <button
                             type="button"
                             onClick={() => setSelectedSavedTourney(null)}
                             className="ml-auto text-vermillion hover:text-vermillion-tint underline uppercase font-bold text-[11px] cursor-pointer"
                           >
                             Unload
                           </button>
                         </div>
                       )}
                     </motion.div>
                   )}

                      <div className="flex gap-3 mt-4">
                        <button 
                          onClick={() => {
                            playTactileSound('rose');
                            setTimeout(() => setSetupStep(1), 150);
                          }}
                          className="btn-tactile-zinc w-1/3 py-3"
                        >
                          Back
                        </button>
                        <button 
                          onClick={() => {
                            playTactileSound('success');
                            setTimeout(() => setSetupStep(3), 150);
                          }}
                          className="btn-tactile-primary w-2/3 py-3"
                        >
                          Next Step
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {setupStep === 3 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                      {/* Offline review panel — step 3 is online-only-options by spec,
                          so when the user picked Solo we show a summary + the
                          Generate button directly here (no extra config needed). */}
                      {!isOnline && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-5 rounded-2xl bg-gold/5 border border-gold/20 space-y-3"
                        >
                          <span className="text-[11px] font-mono font-black text-gold-bright uppercase tracking-widest">Ready to Generate</span>
                          <h4 className="font-display font-black text-white text-base uppercase leading-snug">{tourneyName.trim() || 'Untitled Bracket'}</h4>
                          <p className="text-[11px] text-zinc-400 font-mono uppercase">
                            {tourneySize} themes • {selectionMethod === 'seeded' ? 'Rank-seeded pairings' : selectionMethod === 'random' ? 'Random shuffle' : `Custom template${selectedSavedTourney ? ': ' + selectedSavedTourney.name : ' (none picked)'}`}
                          </p>
                          <p className="text-[11px] text-zinc-500 leading-relaxed">
                            You're set! Hit <strong className="text-gold-bright">Generate Bracket</strong> below to start your offline solo championship.
                          </p>
                        </motion.div>
                      )}

                   {/* Voting timer intervals for Online community modes */}
                   {isOnline && (
                     <motion.div 
                       initial={{ opacity: 0, height: 0 }}
                       animate={{ opacity: 1, height: 'auto' }}
                       className="space-y-4 overflow-hidden"
                     >
                       <div>
                         <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">VOTING DURATION</label>
                         <div className="grid grid-cols-4 gap-2 bg-zinc-950 p-1 border border-zinc-900 rounded-xl">
                           {([30, 60, 120, 300] as const).map(sec => (
                             <button
                               key={sec}
                               type="button"
                               onClick={() => { playTactileSound('success'); setVotingDuration(sec); }}
                               className={`py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer transition-all border ${
                                 votingDuration === sec
                                   ? 'bg-zinc-100 text-zinc-950 font-extrabold shadow-sm active:scale-[0.97]'
                                   : 'text-zinc-500 hover:text-zinc-400 border-transparent'
                               }`}
                             >
                               {sec >= 60 ? `${sec / 60} Min` : `${sec}s`}
                             </button>
                           ))}
                         </div>
                       </div>

                       {/* Broadcaster Host Controls — only Lobby Privacy remains.
                           Pacing controls (Auto/Manual) removed per spec; online
                           tournaments always auto-advance on timer expiry. */}
                       <div>
                         <label className="text-[11px] tracking-wider mb-2 font-mono font-bold uppercase text-zinc-500 block">LOBBY PRIVACY</label>
                         <div className="flex bg-zinc-950 p-1 border border-zinc-900 rounded-xl gap-1">
                              <button
                                 type="button"
                                 onClick={() => { playTactileSound('success'); setLobbyPrivacy('public'); }}
                                 className={`flex-1 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer transition-all border ${lobbyPrivacy === 'public' ? 'bg-zinc-100 text-zinc-950 font-extrabold shadow-sm active:scale-[0.97]' : 'text-zinc-500 hover:text-zinc-400 border-transparent'}`}
                              >
                                Public List
                              </button>
                              <button
                                 type="button"
                                 onClick={() => { playTactileSound('success'); setLobbyPrivacy('private'); }}
                                 className={`flex-1 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer transition-all border ${lobbyPrivacy === 'private' ? 'bg-vermillion/10 text-vermillion border-vermillion/30' : 'text-zinc-500 hover:text-zinc-400 border-transparent'}`}
                              >
                                Private (Key)
                              </button>
                         </div>
                       </div>

                       {lobbyPrivacy === 'private' && (
                         <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                            <label className="text-vermillion text-[11px] font-mono font-extrabold uppercase tracking-widest block mb-2">LOBBY PASSWORD</label>
                            <input
                              type="text"
                              value={lobbyPassword}
                              onChange={(e) => setLobbyPassword(e.target.value)}
                              placeholder="Enter a secret key..."
                              className="w-full bg-zinc-950 border border-rose-deep/50 text-white rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-vermillion/50 transition-colors"
                            />
                         </motion.div>
                       )}

                     </motion.div>
                   )}

                   {/* Warning panel: Cloud limit warning constraints */}
                   {isOnline && !canHostNewOnline && (
                     <div className="p-4 bg-rose-deep/20 border border-rose-deep/40 rounded-xl flex gap-3 text-xs text-vermillion items-start">
                       <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                       <div>
                         <p className="font-bold">Database limit constraints warning</p>
                         <p className="text-[11px] opacity-80 leading-snug mt-1">
                           Maximum of 5 active concurrent online brackets has been reached on this preview server. Try playing solo, or join one of the running tournaments on the lobby directory.
                         </p>
                       </div>
                     </div>
                   )}

                   {/* Generator Execution CTA */}
                   <div className="flex gap-3 mt-4">
                     <button 
                       onClick={() => {
                         playTactileSound('rose');
                         setSetupStep(2);
                       }}
                       className="btn-tactile-zinc w-1/3 py-4"
                     >
                       Back
                     </button>
                     <button
                       onClick={() => {
                         if (!isOnline || canHostNewOnline) playLevelUpFanfare();
                         handleGenerateTournament();
                       }}
                       disabled={isOnline && !canHostNewOnline}
                       className={`w-2/3 py-4 ${
                         isOnline && !canHostNewOnline
                           ? 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed rounded-xl font-black uppercase tracking-wider items-center justify-center flex'
                           : 'btn-tactile-amber'
                       }`}
                     >
                       <Trophy className="w-4 h-4 fill-current shrink-0" />
                       <span>Generate Bracket</span>
                     </button>
                   </div>
                  </motion.div>
                 )}
                  
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : activeTournament.status === 'completed' ? (
        /* WINNER CELEBRATION SCREEN */
        <div className="max-w-5xl mx-auto w-full space-y-12 py-10 relative">
          {/* Ambient champion particles (floating gold stars) */}
          <AmbientParticles variant="champion" />
          {/* Live vote ticker marquee */}
          {activeTournament.historyLog.length > 0 && (
            <div className="glass-panel py-2 px-4 flex items-center gap-3 overflow-hidden">
              <span className="text-[10px] font-mono font-black text-gold-bright uppercase tracking-widest shrink-0">🏆 Recap:</span>
              <Marquee speed={30} gradient={false} className="flex-1">
                {activeTournament.historyLog.slice(-8).reverse().map((log, i) => (
                  <span key={i} className="text-[11px] font-mono text-zinc-400 mx-4 whitespace-nowrap">
                    <span className="text-white font-bold">{log.winner}</span> defeated <span className="text-zinc-500">{log.winner === log.trackA ? log.trackB : log.trackA}</span>
                  </span>
                ))}
              </Marquee>
            </div>
          )}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`glass-modal border rounded-3xl p-8 md:p-12 relative overflow-hidden shadow-2xl space-y-8 md:space-y-12 ${
              activeTournament.isOnline ? 'border-brand-primary glow-cherry-lg' : 'border-gold/50'
            }`}
          >
            {/* Top edge glows */}
            <div className={`absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r ${
              activeTournament.isOnline 
                ? 'from-brand-primary via-brand-secondary to-brand-primary' 
                : 'from-gold-bright via-burnt to-gold-bright'
            }`} />
            
            <div className="flex flex-col lg:flex-row gap-8 items-stretch relative z-10 w-full">
              {/* Left Column: Champion Showcase */}
              <div className="flex-1 w-full flex flex-col items-center justify-center border-r border-zinc-900/50 pr-0 lg:pr-8 pb-8 lg:pb-0 border-b lg:border-b-0">
                <div className="champion-card border border-zinc-900 bg-[#0d0a08]/80 p-8 rounded-3xl w-full max-w-sm space-y-4 text-center shadow-2xl backdrop-blur-md relative mx-auto overflow-visible">
                  {/* Sweep gradient */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-gold/5 via-transparent to-gold/5 pointer-events-none rounded-3xl" />
                  
                  {/* Clean responsive layout for floating crown + circular theme image */}
                  <div className="relative my-6 select-none flex justify-center">
                    {/* Glowing yellow background halo behind track circular cover */}
                    <div className="absolute inset-0 bg-gold/10 rounded-full blur-2xl opacity-75 pointer-events-none" />

                    {/* Centered straight floating golden Crown above track circle (No tilt, larger) */}
                    <motion.div
                      animate={{ y: [0, -8, 0] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      className="champion-crown absolute -top-14 z-20"
                    >
                      <Crown className="w-20 h-20 text-gold-bright fill-gold-bright stroke-[1.5]" />
                    </motion.div>

                    {/* Circular Track Cover ("circle of track thing") */}
                    <div 
                      className="w-36 h-36 md:w-52 md:h-52 rounded-full border-[6px] border-gold-bright mx-auto overflow-hidden relative z-10 shadow-3xl"
                      style={{ filter: "drop-shadow(0 0 20px rgba(255, 211, 77,0.6))" }}
                    >
                      <img src={tracks.find(t => t.id === activeTournament.winnerId)?.customImageUrl || `https://img.youtube.com/vi/${tracks.find(t => t.id === activeTournament.winnerId)?.youtubeId}/hqdefault.jpg`} className="w-full h-full object-cover" crossOrigin="anonymous" alt="Champion Cover" />
                    </div>
                  </div>

                  <h3 className="relative z-10 font-display font-black text-xl md:text-2xl text-white uppercase tracking-tight leading-none px-4">
                    "{tracks.find(t => t.id === activeTournament.winnerId)?.title}"
                  </h3>
                  <p className="relative z-10 text-neutral-300 font-medium text-xs md:text-sm italic">
                    by {tracks.find(t => t.id === activeTournament.winnerId)?.artist}
                  </p>
                  <p className="relative z-10 text-zinc-500 text-[11px] md:text-xs font-mono uppercase tracking-wider bg-black/40 py-1.5 px-3 rounded-lg inline-block text-gold mt-2 border border-gold/10">
                    <Tv className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    {tracks.find(t => t.id === activeTournament.winnerId)?.animeName}
                  </p>

                  {/* Relocated Top Header -> Moved to bottom of Champion section */}
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.6 }}
                    className="pt-4 border-t border-zinc-900/40 text-center space-y-1 block mt-4"
                  >
                    <p className="text-gold font-mono text-[11px] md:text-[11px] uppercase tracking-widest font-black">
                      Tournament Championship Complete
                    </p>
                    <h2 className="champion-title font-display font-black text-2xl md:text-3xl uppercase tracking-tighter">
                      THE CHAMPION
                    </h2>
                  </motion.div>
                </div>
              </div>

              {/* Right Column: Recap & ELO Impact Analytics */}
              <div className="flex-1 w-full flex flex-col justify-center">
                {/* Sleek divider bar to clearly demarcate stats */}
                <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-zinc-800 to-transparent mb-6 block lg:hidden" />
                
                <h4 className="font-mono font-black text-[11px] md:text-[13px] tracking-widest uppercase text-zinc-400 mb-6 pb-3 border-b border-zinc-900/60 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-gold-bright" />
                  Tournament Recap Analytics
                </h4>

                {(() => {
                  let giantSlayer: { track: string; diff: number; defeated: string } | null = null;
                  let maxUpsetDiff = -1;
                  
                  let nailBiter: { trackA: string; trackB: string; vDiff: number; tV: number; percent: number } | null = null;
                  let minVoteDiff = 999999;
                  let totalNailVotes = 0;

                  activeTournament.historyLog.forEach(log => {
                     // Check Giant Slayer (Winner had lower ELO)
                     const aWon = log.winner === log.trackA;
                     const winnerElo = aWon ? log.eloChanges.aBefore : log.eloChanges.bBefore;
                     const loserElo = aWon ? log.eloChanges.bBefore : log.eloChanges.aBefore;
                     const diff = loserElo - winnerElo;
                     if (diff > maxUpsetDiff && diff > 0) {
                        maxUpsetDiff = diff;
                        giantSlayer = { track: log.winner, diff: Math.round(diff), defeated: aWon ? log.trackB : log.trackA };
                     }

                     // Check Nail Biter (Online only uses votes)
                     if (activeTournament.isOnline) {
                       const m = activeTournament.matches.find((mm) => mm.id === log.matchId);
                       if (m && m.voted) {
                         const vA = m.votesA || 0;
                         const vB = m.votesB || 0;
                         const tV = vA + vB;
                         if (tV > 0) {
                           const vDiff = Math.abs(vA - vB);
                           if (vDiff < minVoteDiff) {
                             minVoteDiff = vDiff;
                             totalNailVotes = tV;
                             nailBiter = { trackA: log.trackA, trackB: log.trackB, vDiff, tV, percent: Math.round(Math.max(vA, vB) / tV * 100) };
                           }
                         }
                       }
                     }
                  });

                  const champFinalElo = Math.round(tracks.find(t => t.id === activeTournament.winnerId)?.elo || 0);

                  return (
                    <div className="space-y-4">
                      {/* ELO Summary */}
                      <div className="p-5 rounded-2xl bg-neutral-950/80 border border-moss/20 backdrop-blur-md relative overflow-hidden flex items-stretch gap-4 hover:border-moss/40 transition-all group shadow-lg">
                        {/* Soft ambient inner glow */}
                        <div className="absolute top-0 left-0 w-24 h-24 bg-moss/10 rounded-full blur-2xl pointer-events-none" />
                        <div className="relative z-10 bg-moss/10 p-3 rounded-xl text-moss border border-moss/20 shadow-lg flex items-center justify-center transition-all shrink-0 self-center">
                          <TrendingUp className="w-6 h-6" />
                        </div>
                        <div className="relative z-10 text-left flex flex-col justify-center">
                          <div className="text-[11px] font-black uppercase text-moss font-mono tracking-widest">Global Registry Sync</div>
                          <p className="text-sm md:text-[15px] text-zinc-300 mt-1.5 leading-snug font-medium">
                            This tournament permanently boosted the champion to a global rating of <AnimatedCounter value={champFinalElo} direction="up" className="text-white font-black underline decoration-moss decoration-wavy underline-offset-4 bg-moss/10 px-1 rounded inline-block mx-1" />. The Global Registry has officially updated!
                          </p>
                        </div>
                      </div>

                      {/* Giant Slayer */}
                      {giantSlayer && (
                        <div className="p-5 rounded-2xl bg-neutral-950/80 border border-gold/20 backdrop-blur-md relative overflow-hidden flex items-stretch gap-4 hover:border-gold/40 transition-all group shadow-lg">
                          {/* Soft ambient inner glow */}
                          <div className="absolute top-0 left-0 w-24 h-24 bg-gold/10 rounded-full blur-2xl pointer-events-none" />
                          <div className="relative z-10 bg-gold/10 p-3 rounded-xl text-gold border border-gold/20 shadow-lg flex items-center justify-center transition-all shrink-0 self-center">
                            <Flame className="w-6 h-6" />
                          </div>
                          <div className="relative z-10 text-left flex flex-col justify-center">
                            <div className="text-[11px] font-black uppercase text-gold font-mono tracking-widest">The Giant Slayer</div>
                            <p className="text-sm md:text-[15px] text-zinc-300 mt-1.5 leading-snug font-medium">
                              <strong className="text-white font-black px-1">"{giantSlayer.track}"</strong> caused the biggest bracket upset, defeating <span className="text-zinc-500 italic">"{giantSlayer.defeated}"</span> despite entering with a <strong className="text-gold-bright">{giantSlayer.diff}-point rating deficit</strong>!
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Nail Biter */}
                      {nailBiter && nailBiter.tV > 0 && (
                        <div className="p-5 rounded-2xl bg-neutral-950/80 border border-vermillion/20 backdrop-blur-md relative overflow-hidden flex items-stretch gap-4 hover:border-vermillion/40 transition-all group shadow-lg">
                          {/* Soft ambient inner glow */}
                          <div className="absolute top-0 left-0 w-24 h-24 bg-vermillion/10 rounded-full blur-2xl pointer-events-none" />
                          <div className="relative z-10 bg-vermillion/10 p-3 rounded-xl text-vermillion border border-vermillion/20 shadow-lg flex items-center justify-center transition-all shrink-0 self-center">
                            <ScanEye className="w-6 h-6" />
                          </div>
                          <div className="relative z-10 text-left flex flex-col justify-center">
                            <div className="text-[11px] font-black uppercase text-vermillion font-mono tracking-widest">The Nail-Biter Match</div>
                            <p className="text-sm md:text-[15px] text-zinc-300 mt-1.5 leading-snug font-medium">
                              <strong className="text-white font-black">"{nailBiter.trackA}"</strong> vs <strong className="text-white font-black">"{nailBiter.trackB}"</strong> was decided by just <strong className="text-vermillion">{nailBiter.vDiff} votes</strong> ({nailBiter.percent}% split across {nailBiter.tV} total cast).
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Structured Premium Layout Actions Hierarchy */}
            {activeTournament.winnerId && (() => {
              const championTrack = tracks.find(t => t.id === activeTournament.winnerId);
              return (
                <div className="max-w-md mx-auto w-full space-y-4 pt-6 mt-6 border-t border-zinc-900/60">
                  {/* Primary Call To Action */}
                  {championTrack && (
                    <button
                      onClick={() => {
                        playTactileSound('success');
                        onPlay(championTrack);
                      }}
                      className="btn-tactile-yellow w-full py-4 text-sm"
                    >
                      <Music className="w-4 h-4 text-neutral-900" />
                      Play Victory Theme
                    </button>
                  )}

                  {/* Secondary Actions (Share & Export Snapshot Horizontally) */}
                  <div className="grid grid-cols-2 gap-4">
                    <UnifiedShare 
                      title="ANISYNC Champion"
                      text={`I just crowned "${tracks.find(t => t.id === activeTournament.winnerId)?.title}" by ${tracks.find(t => t.id === activeTournament.winnerId)?.artist} the champion of the ANISYNC 1v1 Arena! 🏆🎵\n\nCheckout the hottest Anime themes at ANISYNC:`}
                      className="btn-tactile-primary w-full py-4 text-xs"
                    />
                    <button
                      onClick={() => {
                        playTactileSound('rose');
                        handleShareBracket();
                      }}
                      disabled={isCapturing}
                      className="btn-tactile-zinc w-full py-4 text-xs disabled:opacity-50"
                    >
                      {isCapturing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                      <span>Export Snapshot</span>
                    </button>
                  </div>

                  {/* Visual Share Card — generates a downloadable PNG of the champion track */}
                  {championTrack && (
                    <>
                      <button
                        onClick={() => {
                          playTactileSound('success');
                          setShowChampionShareCard(true);
                        }}
                        className="btn-tactile-success w-full py-4 text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Champion Card
                      </button>
                      <ShareCard
                        track={championTrack}
                        isOpen={showChampionShareCard}
                        onClose={() => setShowChampionShareCard(false)}
                        title="CHAMPION"
                        accentColor="#ffb800"
                      />
                    </>
                  )}

                  <button
                    onClick={() => {
                      playTactileSound('rose');
                      if (activeTournament.isOnline) {
                        onSelectOnlineTournamentId(null);
                      } else {
                        onUpdateLocalTournament(null);
                      }
                    }}
                    className="btn-tactile-zinc w-full py-4 text-xs font-mono tracking-widest uppercase"
                  >
                    Start New Campaign
                  </button>
                </div>
              );
            })()}
          </motion.div>

          {/* Final filled-in Visual Bracket Board for reviewing and sharing */}
          <div id="bracket-screenshot-area" className="relative bg-[#0d0f17] border border-zinc-900 rounded-3xl p-6 shadow-2xl text-left space-y-4 overflow-hidden group">
            {/* Scroll Indicator Overlay */}
            <div data-html2canvas-ignore="true" className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#0e0e11]/50 to-transparent pointer-events-none z-10 flex items-center justify-end pr-4 opacity-100 transition-opacity duration-500">
              <ChevronRight className="w-8 h-8 text-brand-primary opacity-70" />
            </div>

            <h4 data-html2canvas-ignore="true" className="font-display font-black text-xs text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 select-none relative z-20">
              <Layers className="w-4 h-4 text-gold-bright" /> Final Visual Bracket Board {isCapturing && "- Capture generated by Anime Arena"}
            </h4>

            {/* Round labels */}
            <div data-html2canvas-ignore="true" className="flex gap-2 sm:gap-4 mb-2 overflow-x-auto scrollbar-hide">
              {Object.entries(roundNames).map(([roundIdx, name]) => (
                <div key={roundIdx} className="shrink-0 px-3 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800">
                  <span className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500">{name}</span>
                </div>
              ))}
            </div>

            <BracketTreeView
               tournament={activeTournament}
               tracks={tracks}
               matchesByRound={matchesByRound}
               onPlayTrack={onPlay}
               globalPlayingTrack={globalPlayingTrack}
            />
          </div>
        </div>
      ) : (
        /* ACTIVE CHAMPIONSHIP BRACKET PROGRESSION VIEW */
        <div className="space-y-8 relative">
          
          {/* Guest simulation notice banner */}
          {!currentUser && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel border-l-4 border-l-gold bg-gold/5 px-4 py-3 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm max-w-5xl mx-auto"
            >
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gold/10 text-gold shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </span>
                <div>
                  <p className="text-gold-bright font-bold font-display uppercase tracking-tight text-xs">⚠️ Guest Tournament Play Mode</p>
                  <p className="text-zinc-300 text-[11px] mt-0.5 leading-relaxed">
                    You are playing as a guest. Bracket votes are fully operational and simulate local ELO updates on your screen, but they <span className="text-gold-bright font-bold underline">will not modify</span> global public databases.
                  </p>
                </div>
              </div>
              <span className="shrink-0 px-2.5 py-1 text-[11px] font-mono font-black uppercase text-gold bg-gold/10 border border-gold/25 rounded-md">
                Local Guest Sandbox
              </span>
            </motion.div>
          )}

          {/* VS Splash removed — TournamentMatchDuel has a persistent pop-in VS badge */}

          {/* High-Performance Compose-Safe Floating Emoji Layer */}
          <FloatingEmojiEngine />
          
          {/* Active Navigation Header Panel */}
          {!cleanBroadcastMode && (() => {
            const totalMatchesCount = activeTournament.matches.length;
            const completedMatchesCount = activeTournament.matches.filter(m => m.voted).length;
            const matchProgressPct = Math.min(100, Math.round((completedMatchesCount / totalMatchesCount) * 100));

            return (
              <div className="flex flex-col lg:flex-row items-center justify-between gap-4 p-5 bg-[#0e0e11] border border-zinc-900 rounded-2xl shadow-xl text-left relative overflow-hidden">
                {/* Juicy Progress Bar Background */}
                <div className="absolute top-0 left-0 h-1 bg-zinc-900 w-full">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${matchProgressPct}%` }}
                    transition={{ type: "spring", bounce: 0.2, duration: 1 }}
                    className="h-full bg-brand-secondary shadow-[0_0_10px_rgba(61, 220, 132,0.8)]" 
                  />
                </div>
                
                <div className="space-y-1.5 text-center lg:text-left pt-1">
                  <span className="text-[11px] font-mono tracking-widest text-brand-primary uppercase font-black block leading-none flex items-center gap-1 justify-center lg:justify-start">
                    <Users className="w-3.5 h-3.5" />
                    {activeTournament.isOnline 
                      ? `LIVE COMMUNITY FIGHT: ${activeTournament.name}` 
                      : `OFFLINE SOLO BRACKET: ${activeTournament.name}`}
                  </span>
                  <h3 className="font-display font-black text-lg lg:text-xl text-white uppercase tracking-wide">
                    Round of Seeding: {roundNames[activeTournament.currentRound]} (Match {activeTournament.currentMatchIndex + 1})
                  </h3>
                </div>
                
                <div className="flex items-center flex-wrap justify-center lg:justify-end gap-2.5 max-w-full">
                 {/* OBS & Streamer Tools — modern OBS Browser Source workflow */}
                 <div className="flex bg-zinc-950 p-1 border border-zinc-900 rounded-xl mr-2">
                   <button
                     onClick={async () => {
                       playTactileSound('primary');
                       const obsUrl = `${window.location.origin}${window.location.pathname}?obs=1${activeTournament?.isOnline ? `&tid=${activeTournament.id}` : ''}`;
                       try {
                         await navigator.clipboard.writeText(obsUrl);
                         toast.success('OBS Browser Source URL copied! Paste into OBS → Sources → Add → Browser.');
                       } catch {
                         toast.info(`OBS URL: ${obsUrl}`);
                       }
                     }}
                     className="px-3 py-1.5 text-[11px] font-black uppercase text-brand-primary bg-brand-primary/15 border border-brand-primary/40 rounded hover:bg-brand-primary/25 transition-all flex items-center gap-1"
                     title="Copy OBS Browser Source URL to paste into OBS Studio"
                   >
                     <Monitor className="w-2.5 h-2.5" />
                     <span>Copy OBS URL</span>
                   </button>
                   <button
                     onClick={() => {
                       playTactileSound('zinc');
                       setCleanBroadcastMode(true);
                     }}
                     className="px-3 py-1.5 text-[11px] font-black uppercase text-zinc-500 hover:text-white transition-all rounded"
                     title="In-app clean broadcast view (hides UI chrome) — for screen-capture streamers who don't want to use a Browser Source"
                   >
                     Clean View
                   </button>
                   <button
                     onClick={() => {
                       playTactileSound('primary');
                       setIsStreamerDashboardOpen(!isStreamerDashboardOpen);
                     }}
                     className={`px-3 py-1.5 text-[11px] font-black uppercase transition-all rounded flex items-center gap-1 ${
                       isStreamerDashboardOpen
                         ? 'bg-brand-primary/20 text-brand-primary font-extrabold'
                         : 'text-zinc-500 hover:text-white'
                     }`}
                     title="Open Twitch Chat Listener & Streamer Control Panel"
                   >
                     <Radio className="w-2.5 h-2.5 text-brand-primary" />
                     <span>Streamer Hub</span>
                   </button>
                 </div>

                 {activeTournament.isOnline && (
                   <button
                     onClick={handleLeaveViewedTournament}
                     className="px-4 py-2 border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 font-semibold rounded-xl text-xs cursor-pointer transition-all flex items-center gap-1"
                   >
                     <LogOut className="w-3.5 h-3.5" />
                     <span>Lobby Directory</span>
                   </button>
                 )}

                 {!showForfeitConfirm ? (
                   <button
                     onClick={() => setShowForfeitConfirm(true)}
                     className="btn-tactile-zinc !py-2 !px-4 !text-[11px]"
                   >
                     Forfeit Bracket
                   </button>
                 ) : (
                   <div className="flex items-center gap-2 bg-rose-deep/20 border border-rose-deep/40 p-1.5 rounded-xl">
                     {activeTournament.isOnline && currentUser && (activeTournament.createdBy === currentUser.id || currentUser.role === 'admin') ? (
                       <span className="text-vermillion text-[11px] font-mono font-black uppercase tracking-wider pl-1.5">Delete Lobby?</span>
                     ) : (
                       <span className="text-vermillion text-[11px] font-mono font-black uppercase tracking-wider pl-1.5">Forfeit?</span>
                     )}
                     <button
                       onClick={() => {
                         playTactileSound('rose');
                         setShowForfeitConfirm(false);
                         if (activeTournament.isOnline) {
                           const isOwner = currentUser && (activeTournament.createdBy === currentUser.id || currentUser.role === 'admin');
                           if (isOwner && onDeleteOnlineTournament) {
                             onDeleteOnlineTournament(activeTournament.id);
                           } else {
                             onUpdateFullTournament({ ...activeTournament, status: 'completed' });
                           }
                           onSelectOnlineTournamentId(null);
                         } else {
                           onUpdateLocalTournament(null);
                         }
                       }}
                       className="btn-tactile-rose !py-1 !px-3 font-black rounded-lg text-[11px]"
                     >
                       Yes
                     </button>
                     <button
                       type="button"
                       onClick={() => setShowForfeitConfirm(false)}
                       className="btn-tactile-zinc !py-1 !px-3 font-black rounded-lg text-[11px]"
                     >
                       No
                     </button>
                   </div>
                 )}
              </div>
            </div>
           ); })()}

          {/* Streamer Hub Integration Control Deck Dashboard Panel */}
          {isStreamerDashboardOpen && !cleanBroadcastMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-5 bg-[#100C0A] border border-brand-primary/30 bg-gradient-to-br from-[#100C0A] via-[#0a0f14] to-[#040608] rounded-2xl shadow-2xl relative overflow-visible text-left space-y-4 mb-4"
            >
              <div className="absolute top-0 right-0 p-8 w-64 h-64 bg-brand-primary/5 rounded-full blur-3xl pointer-events-none" />
              <div className="flex items-center gap-2 border-b border-brand-primary/20 pb-3">
                <Radio className="w-5 h-5 text-brand-primary shrink-0" />
                <div>
                  <h4 className="font-display font-black text-xs text-white uppercase tracking-widest">Broadcaster Interactive Stream Control Hub</h4>
                  <p className="text-[11px] text-zinc-500 font-sans uppercase">Directly integrate your streaming chats with real-time poll scoring & tug of war pull triggers</p>
                </div>
              </div>

              {/* OBS Browser Source URL — the streamer's primary workflow.
                  Paste into OBS Studio: Sources → Add → Browser → URL.
                  Body background is transparent in overlay mode, so OBS composites
                  it directly over the stream without chroma keying. */}
              <div className="p-4 bg-brand-primary/5 border border-brand-primary/30 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-brand-primary" />
                  <span className="text-[11px] font-mono text-brand-primary font-black uppercase tracking-widest">OBS Browser Source URL</span>
                </div>
                <p className="text-[11px] text-zinc-400 font-sans leading-normal">
                  Copy this URL into OBS Studio → Sources → Add → Browser. Set width 1280 & height 720 (or 1920×1080). Body is transparent — no green-screen needed. Toggle <code className="text-brand-primary">Shutdown when not visible</code> & <code className="text-brand-primary">Refresh when scene becomes active</code> for best results.
                </p>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-brand-primary bg-black/40 border border-brand-primary/20 rounded px-2 py-1.5">{`${typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''}?obs=1${activeTournament?.isOnline ? `&tid=${activeTournament.id}` : ''}`}</code>
                  <button
                    onClick={async () => {
                      playTactileSound('primary');
                      const obsUrl = `${window.location.origin}${window.location.pathname}?obs=1${activeTournament?.isOnline ? `&tid=${activeTournament.id}` : ''}`;
                      try {
                        await navigator.clipboard.writeText(obsUrl);
                        toast.success('OBS URL copied! Paste into OBS → Sources → Add → Browser.');
                      } catch {
                        toast.info(`OBS URL: ${obsUrl}`);
                      }
                    }}
                    className="px-3 py-1.5 text-[11px] font-mono font-black uppercase tracking-wider rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-zinc-950 border-transparent transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    <Clipboard className="w-3 h-3" />
                    <span>Copy URL</span>
                  </button>
                  <a
                    href={`${typeof window !== 'undefined' ? `?obs=1${activeTournament?.isOnline ? `&tid=${activeTournament.id}` : ''}` : '#'}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-[11px] font-mono font-black uppercase tracking-wider rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                    title="Preview the OBS overlay in a new tab to verify it looks right before pasting into OBS"
                  >
                    <LinkOut className="w-3 h-3" />
                    <span>Preview</span>
                  </a>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider pt-1 border-t border-zinc-900/60 mt-2">
                  <span className="text-zinc-400">Setup hints:</span> 1) Add → Browser &nbsp;·&nbsp; 2) Paste URL &nbsp;·&nbsp; 3) 1280×720 &nbsp;·&nbsp; 4) Check “Shutdown when not visible” &nbsp;·&nbsp; 5) Check “Refresh browser when scene becomes active”
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Panel 1: Twitch Chat Live Poller */}
                <div className="p-4 bg-zinc-950/65 border border-zinc-900 rounded-xl space-y-3 relative flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-mono text-brand-primary font-black uppercase tracking-widest block font-extrabold pb-0.5">Twitch Chat Listener</span>
                    <p className="text-[11px] text-zinc-400 font-sans leading-normal mb-2">Connect to any public chat in read-only mode to scan for <code className="text-[#FF3D2E]">"1"</code> or <code className="text-[#3FA9F5]">"2"</code> votes.</p>
                    
                    <div className="p-2 mb-2 bg-brand-primary/5 border border-brand-primary/20 rounded text-[11px] text-brand-primary/80 font-sans leading-snug">
                      🔒 <strong className="font-extrabold text-white">100% Safe Connection:</strong> Uses Twitch's anonymous IRC protocol. No password, login, or OAuth scope is requested or accessible.
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] font-mono text-zinc-500 uppercase font-black tracking-wider block">No Streamer Chat Setup? Test a high-activity live channel:</span>
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {['shroud', 'riotgames', 'lck', 'ninja'].map(ch => (
                          <button
                            key={ch}
                            type="button"
                            disabled={isTwitchConnected}
                            onClick={() => {
                              playTactileSound('zinc');
                              setTwitchChannel(ch);
                            }}
                            className="px-1.5 py-0.5 text-[11px] font-mono bg-brand-primary/10 border border-brand-primary/30 hover:border-brand-primary hover:bg-brand-primary/20 text-brand-primary/80 rounded disabled:opacity-30 transition-all cursor-pointer"
                          >
                            #{ch}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5 pt-1 border-t border-zinc-900/60 mt-1">
                    <label className="text-[11px] font-mono text-zinc-500 block uppercase font-bold">Twitch Channel:</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. shroud, ninja"
                        value={twitchChannel}
                        onChange={(e) => setTwitchChannel(e.target.value.toLowerCase().trim())}
                        disabled={isTwitchConnected}
                        className="flex-1 bg-black/60 text-xs text-white border border-zinc-800 focus:border-brand-primary rounded-lg px-3 py-1.5 focus:outline-none placeholder-zinc-700 font-mono disabled:opacity-50"
                      />
                      <button
                        onClick={() => {
                          playTactileSound('primary');
                          if (!twitchChannel) {
                            toast.error("Please provide a Twitch channel handle!");
                            return;
                          }
                          setIsTwitchConnected(!isTwitchConnected);
                        }}
                        className={`px-3 py-1 text-[11px] font-mono font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                          isTwitchConnected 
                            ? 'bg-vermillion/15 text-vermillion border-vermillion/35 hover:bg-vermillion/25' 
                            : 'bg-brand-primary hover:bg-brand-primary/90 text-zinc-950 border-transparent'
                        }`}
                      >
                        {isTwitchConnected ? 'Quit' : 'Join'}
                      </button>
                    </div>
                  </div>

                  {isTwitchConnected && (
                    <div className="flex items-center gap-1.5 p-2 bg-brand-primary/10 border border-brand-primary/30 rounded-lg text-[11px] font-mono font-bold text-brand-primary/80 uppercase">
                      <span className="w-2 h-2 bg-brand-primary rounded-full shrink-0" />
                      <span>Listening Live to #{twitchChannel}</span>
                    </div>
                  )}
                </div>

                {/* Panel 2: Live incoming activity logs ticker (real Twitch chat) */}
                <div className="p-4 bg-zinc-950/60 border border-zinc-900 rounded-xl flex flex-col h-[180px]">
                  <span className="text-[11px] font-mono text-zinc-400 font-black uppercase tracking-widest block border-b border-zinc-900 pb-1.5 shrink-0 select-none font-extrabold flex items-center justify-between">
                    <span>Broadcast Event Ticker</span>
                    <span className="text-[11px] uppercase font-bold text-zinc-500">Auto-eval</span>
                  </span>
                  
                  <div className="flex-1 overflow-y-auto font-mono text-[11px] py-1.5 space-y-1">
                    {chatMessagesLog.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center select-none pt-4">
                        <span>Waiting for activity...</span>
                        <span>Votes parse automatically</span>
                      </div>
                    ) : (
                      chatMessagesLog.map(msg => {
                        const isVote1 = msg.text.toLowerCase() === '1' || msg.text.toLowerCase() === '!1' || msg.text.toLowerCase() === 'a' || msg.text.toLowerCase().includes('option a') || msg.text.toLowerCase().includes('contender a');
                        const isVote2 = msg.text.toLowerCase() === '2' || msg.text.toLowerCase() === '!2' || msg.text.toLowerCase() === 'b' || msg.text.toLowerCase().includes('option b') || msg.text.toLowerCase().includes('contender b');
                        const badgeColor = isVote1 ? 'text-[#FF3D2E]' : isVote2 ? 'text-[#3FA9F5]' : 'text-zinc-500';
                        return (
                          <div key={msg.id} className="flex items-start gap-1 p-1 bg-black/10 rounded border border-zinc-900/40 animate-fade-in">
                            <span className="text-zinc-500 shrink-0 select-none">&gt;</span>
                            <span className="font-extrabold text-zinc-300 truncate max-w-[85px] shrink-0">{msg.user}:</span>
                            <span className={`break-all ${badgeColor} truncate`}>{msg.text}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Floating Exit OBS button if in clean broadcast mode */}
          {cleanBroadcastMode && (
             <div className="fixed top-4 left-4 z-[10000]">
               <button
                 onClick={() => setCleanBroadcastMode(false)}
                 className="px-4 py-2 bg-zinc-900/80 text-white border border-zinc-700 text-[11px] font-black uppercase tracking-widest rounded-xl hover:bg-zinc-800 transition-colors backdrop-blur-md shadow-2xl"
               >
                 Exit OBS Mode
               </button>
             </div>
          )}

          {/* Active matchup duel component */}
          <div className="bg-panel-bg border border-panel-border rounded-2xl p-6 shadow-2xl space-y-6 text-left">
            
            {/* Row with Title, timer icons and lobbies status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-y-2 pb-4 border-b border-zinc-900/80">
              <div className="space-y-0.5">
                <h4 className="font-display font-black text-white text-sm uppercase tracking-widest flex items-center gap-1.5 select-none font-sans">
                  <Flame className="w-5 h-5 text-brand-secondary" /> DUEL MATCHUP STAGE
                </h4>
                <p className="text-[#FF3D2E] text-[11px] font-mono uppercase tracking-[0.12em] font-black">
                  ⚡ Single-click card to play/preview video | Double-click card to vote
                </p>
              </div>
              
              {activeTournament.isOnline && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-secondary/15 border border-brand-secondary/35 text-brand-secondary select-none">
                  {!isMatchRevealed ? (
                    <>
                      <Clock className="w-4 h-4 text-brand-primary animate-spin" style={{ animationDuration: '6s' }} />
                      <span className="font-mono text-xs font-black tracking-widest">
                        VOTING CLOSES: {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-xs font-black tracking-widest text-vermillion">
                      ⏰ VOTING CLOSED — SETTLING...
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Live vote ticker — esports broadcast style */}
            {activeTournament.isOnline && matchTracks.a && matchTracks.b && (aVotes > 0 || bVotes > 0) && (() => {
              const total = aVotes + bVotes;
              const pctA = total === 0 ? 50 : Math.round((aVotes / total) * 100);
              const pctB = total === 0 ? 50 : 100 - pctA;
              return (
              <div className="glass-panel py-1.5 px-3 flex items-center gap-2 overflow-hidden">
                <span className="text-[9px] font-mono font-black text-[#FF3D2E] uppercase tracking-widest shrink-0">LIVE</span>
                <Marquee speed={40} gradient={false} className="flex-1">
                  <span className="text-[10px] font-mono text-zinc-400 mx-6 whitespace-nowrap">
                    {"🎵 "}<span className="text-[#FF3D2E] font-bold">{matchTracks.a.title}</span> {aVotes} votes ({pctA}%) — vs — <span className="text-[#3FA9F5] font-bold">{matchTracks.b.title}</span> {bVotes} votes ({pctB}%) {"🎵"}
                  </span>
                </Marquee>
              </div>
              );
            })()}

            {/* 1v1 Duel — Arena-parity card stage with Tilt/glare/spotlight,
                winner-reveal layout animation, pop-in VS badge, and the
                spring tug-of-war vote bar. All the duplicated card/mouse/
                confetti logic now lives inside the Duel. */}
            {matchTracks.a && matchTracks.b && (() => {
              // Derive which side won so the Duel can drive its winner-reveal
              // layout animation. Online: match.winnerId (set by settle).
              // Offline: voteOverlayResult.winnerId (set by handleVoteTournament).
              const winnerSide: 'A' | 'B' | null = activeTournament.isOnline
                ? (currentActiveMatch?.winnerId === matchTracks.a?.id ? 'A'
                  : currentActiveMatch?.winnerId === matchTracks.b?.id ? 'B'
                  : null)
                : (voteOverlayResult?.winnerId === matchTracks.a?.id ? 'A'
                  : voteOverlayResult?.winnerId === matchTracks.b?.id ? 'B'
                  : null);

              return (
                <TournamentMatchDuel
                  trackA={matchTracks.a}
                  trackB={matchTracks.b}
                  isOnline={!!activeTournament.isOnline}
                  hasVoted={userHasVotedInActiveMatch}
                  votedSide={userVotedSide}
                  selectedCandidate={selectedCandidate}
                  revealed={isMatchRevealed}
                  winnerSide={winnerSide}
                  aVotes={aVotes}
                  bVotes={bVotes}
                  pulseSide={pulseSide}
                  pulseCount={pulseCount}
                  eloAAfter={voteOverlayResult?.changes?.aAfter}
                  eloBAfter={voteOverlayResult?.changes?.bAfter}
                  eloADelta={voteOverlayResult?.winnerId === matchTracks.a?.id ? voteOverlayResult?.changes?.changeA : undefined}
                  eloBDelta={voteOverlayResult?.winnerId === matchTracks.b?.id ? voteOverlayResult?.changes?.changeB : undefined}
                  onCardClick={handleTournamentCardClick}
                  onSwipeSelect={(side) => setSelectedCandidate(side)}
                  actionsSlotA={
                    <TrackActionsMenu
                      track={matchTracks.a}
                      isAdmin={currentUser?.role === 'admin'}
                      align="left"
                      onOpenStateChange={(isOpen) => setActiveDropdown(isOpen ? 'A' : null)}
                    />
                  }
                  actionsSlotB={
                    <TrackActionsMenu
                      track={matchTracks.b}
                      isAdmin={currentUser?.role === 'admin'}
                      align="right"
                      onOpenStateChange={(isOpen) => setActiveDropdown(isOpen ? 'B' : null)}
                    />
                  }
                />
              );
            })()}

            {/* Hype Reaction Emojis Panel */}
            {activeTournament.isOnline && (
              <div className="flex justify-center gap-6 mt-4">
                 {(['🔥', '😭', '👑', '😱'] as const).map(emoji => (
                   <button 
                     key={emoji}
                     onClick={() => handleGlobalReaction(emoji)} 
                     className="text-3xl hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer bg-zinc-900/50 hover:bg-zinc-800 p-3 rounded-md border border-zinc-800 shadow-xl"
                   >
                     {emoji}
                   </button>
                 ))}
              </div>
            )}

            {/* Tournament Track Critique Section */}
            {userHasVotedInActiveMatch && currentUser && (
              <div className="w-full max-w-2xl mx-auto mt-6 mb-2 flex flex-col items-center gap-4">
                <button
                  onClick={() => setShowCritiqueForm(!showCritiqueForm)}
                  className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider border flex items-center gap-1.5 transition-all cursor-pointer ${
                    showCritiqueForm
                      ? 'bg-gold/15 text-gold-bright border-gold/25 shadow-[0_0_12px_rgba(255, 138, 61,0.1)]'
                      : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-gold" />
                  <span>Write Soundtrack Critique</span>
                  {showCritiqueForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showCritiqueForm && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full p-5 bg-[#100C0A] border border-zinc-900 rounded-xl space-y-4 shadow-2xl backdrop-blur-md relative overflow-hidden text-left"
                  >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-primary/30 to-transparent" />
                    <div className="flex items-center gap-2 text-zinc-300">
                      <Sparkles className="w-4 h-4 text-brand-primary" />
                      <span className="text-[11px] font-mono font-black uppercase tracking-widest text-brand-primary">
                        Tournament Soundtrack Critique (Optional)
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-sans leading-normal">
                      Support your tournament choice! Rate the track and post an official critique directly to the song's **Track Profile**!
                    </p>

                {/* Choose Track */}
                <div className="space-y-1.5 border-t border-b border-zinc-900/60 py-2.5">
                  <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-black mb-1">CHOOSE GRAND PRIX CONTENDER FOR CRITIQUE:</span>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    {matchTracks.a && (
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold font-sans text-zinc-300 bg-black/40 px-3 py-1.5 border border-zinc-900 rounded-lg flex-1 hover:bg-zinc-950/60 font-semibold transition-all">
                        <input 
                          type="radio" 
                          name="tourney-critique-track" 
                          checked={reviewTrackSelection === "A"} 
                          onChange={() => setReviewTrackSelection("A")}
                          disabled={isReviewSaved}
                          className="accent-brand-primary text-brand-primary focus:ring-0 bg-zinc-900 border-zinc-700 w-3.5 h-3.5" 
                        />
                        <span className="truncate">Contender A: "{matchTracks.a.title}"</span>
                      </label>
                    )}
                    {matchTracks.b && (
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold font-sans text-zinc-300 bg-black/40 px-3 py-1.5 border border-zinc-900 rounded-lg flex-1 hover:bg-zinc-950/60 font-semibold transition-all">
                        <input 
                          type="radio" 
                          name="tourney-critique-track" 
                          checked={reviewTrackSelection === "B"} 
                          onChange={() => setReviewTrackSelection("B")}
                          disabled={isReviewSaved}
                          className="accent-brand-primary text-brand-primary focus:ring-0 bg-zinc-900 border-zinc-700 w-3.5 h-3.5" 
                        />
                        <span className="truncate">Contender B: "{matchTracks.b.title}"</span>
                      </label>
                    )}
                  </div>
                </div>

                {/* Rating 1-10 */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px] font-mono">
                    <span className="font-black text-zinc-400 uppercase tracking-wider">ASSIGN CONTENDER MUSIC SCORE:</span>
                    <span className="text-gold-bright font-extrabold flex items-center gap-1">
                      <Star className="w-3 h-3 fill-current text-gold" />
                      {reviewRating} / 10 STARS
                    </span>
                  </div>
                  <div className="flex justify-between gap-1 overflow-x-auto pb-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <button
                        key={num}
                        type="button"
                        disabled={isReviewSaved}
                        onClick={() => setReviewRating(num)}
                        className={`aspect-square min-w-[24px] h-[24px] rounded font-mono text-[11px] font-extrabold flex items-center justify-center transition-all cursor-pointer ${
                          reviewRating === num
                            ? 'bg-brand-primary text-white font-black shadow-[0_0_8px_rgba(255, 138, 61,0.4)] border-transparent'
                            : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-white border border-zinc-800'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Review Message Textarea */}
                <div className="space-y-1">
                  <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block font-black">CRITIQUE FEEDBACK COMMENTARY:</span>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Provide performance feedback, instrument choices, nostalgia tier, or why this contender advances..."
                    className="w-full h-16 bg-black/55 border border-zinc-900 focus:border-brand-primary/40 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none placeholder-zinc-700 resize-none font-sans transition-all"
                    disabled={isReviewSaved}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!reviewComment.trim()) return;
                      const selectedTrack = reviewTrackSelection === "A" ? matchTracks.a : matchTracks.b;
                      if (selectedTrack) {
                        try {
                          await addTrackReview({
                            trackId: selectedTrack.id,
                            userId: currentUser.id,
                            username: currentUser.username || currentUser.email.split('@')[0],
                            userPicture: currentUser.picture || '',
                            rating: reviewRating,
                            comment: reviewComment,
                            source: 'tournament'
                          });
                          toast.success(`Published Grand Prix critique for ${selectedTrack.title}!`);
                          setIsReviewSaved(true);
                        } catch (err: any) {
                          toast.error(`Error saving critique: ${err.message}`);
                        }
                      }
                    }}
                    disabled={isReviewSaved || !reviewComment.trim()}
                    className={`px-4 py-1.5 rounded bg-zinc-950 font-mono text-[11px] uppercase font-black tracking-widest border transition-all cursor-pointer ${
                      isReviewSaved 
                        ? 'bg-moss/10 text-moss border-moss/35' 
                        : 'text-zinc-400 hover:text-white border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {isReviewSaved ? '✓ Critique Published' : 'Publish Critique'}
                  </button>
                </div>
              </motion.div>
                )}
              </div>
            )}

            {/* Offline next-game Settle button — visible on all viewports now
                that the central VS/Settle overlay lives inside TournamentMatchDuel
                (the Duel handles its own VS badge but not the advance button). */}
            {!activeTournament.isOnline && hasVotedInCurrentMatch && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => {
                    playTactileSound('success');
                    setTimeout(() => handleNextTournamentStep(), 200);
                  }}
                  className={`${
                    userVotedSide === 'A'
                      ? 'btn-tactile-primary'
                      : userVotedSide === 'B'
                        ? 'btn-tactile-rose'
                        : 'btn-tactile-success'
                  } w-full md:w-auto mt-2`}
                >
                  <span>Settle Verdict & Next Match</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Online auto-settle indicator — host doesn't need to click anything.
                Online matches auto-advance when the timer hits 0 (handled by
                handleSettleOnlineMatch in the useEffect above). This block is
                purely a visual progress indicator for viewers. */}
            {activeTournament.isOnline && isMatchRevealed && (() => {
              const isHost = activeTournament.createdBy === voterId;
              return (
                <div className="flex flex-col items-center gap-1.5 py-4 bg-brand-secondary/5 border border-dashed border-brand-secondary/35 rounded-2xl justify-center">
                  <span className="text-[11px] font-mono font-black text-brand-secondary uppercase tracking-wider">
                    ⏳ TIMER EXPIRED — {isHost ? 'AUTO-SETTLING MATCH...' : 'HOST IS SETTLING THE MATCH...'}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Bracket Tree Visual Display board Layout */}
          <div id="bracket-screenshot-area" className="relative bg-panel-bg border border-panel-border rounded-2xl p-6 shadow-2xl text-left space-y-4 overflow-hidden group">

            {/* Scroll Indicator Overlay */}
            <div data-html2canvas-ignore="true" className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#0e0e11] via-[#0e0e11]/80 to-transparent pointer-events-none z-10 flex items-center justify-end pr-4 opacity-100 transition-opacity duration-500">
              <ChevronRight className="w-8 h-8 text-brand-primary opacity-70" />
            </div>

            <h4 data-html2canvas-ignore="true" className="font-display font-black text-xs text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 select-none relative z-20">
              <Layers className="w-4 h-4 text-gold-bright" /> Interactive Visual Bracket Board {isCapturing && "- Capture generated by Anime Arena"}
            </h4>

            {/* Round labels */}
            <div data-html2canvas-ignore="true" className="flex gap-2 sm:gap-4 mb-2 overflow-x-auto scrollbar-hide">
              {Object.entries(roundNames).map(([roundIdx, name]) => (
                <div key={roundIdx} className="shrink-0 px-3 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800">
                  <span className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500">{name}</span>
                </div>
              ))}
            </div>

            <BracketTreeView
               tournament={activeTournament}
               tracks={tracks}
               matchesByRound={matchesByRound}
               onPlayTrack={onPlay}
               globalPlayingTrack={globalPlayingTrack}
            />
          </div>

        </div>
      )}

      {/* Visual Snapshot Preview Lightbox Modal */}
      <AnimatePresence>
        {capturedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[11000] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 overflow-y-auto"
            onClick={() => setCapturedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-[#090d15] border border-zinc-900 rounded-3xl p-6 md:p-8 max-w-4xl w-full space-y-6 relative text-center shadow-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Abs Close button */}
              <button 
                onClick={() => setCapturedImage(null)}
                className="absolute top-4 right-4 p-2 bg-zinc-900 hover:bg-zinc-800 rounded-full border border-zinc-800 hover:border-zinc-700 transition-all text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-1.5 border-b border-zinc-900 pb-4">
                <span className="text-brand-secondary font-mono text-[11px] uppercase tracking-widest font-black bg-brand-secondary/10 px-2.5 py-1 rounded-md border border-brand-secondary/20 block w-fit mx-auto shadow-md">
                  Visual Capture Ready
                </span>
                <h3 className="font-display font-black text-2xl md:text-3xl text-white uppercase tracking-tight pt-1">
                  Your Bracket Blueprint
                </h3>
                <p className="text-zinc-400 text-xs max-w-lg mx-auto leading-relaxed">
                  Inside sandboxed chat previews, direct anchor saving is restricted by browser security policies. <strong className="text-gold-bright">Right-click / long-press the preview image below to save or copy your high-res bracket blueprint directly!</strong> Or open the app in a new tab to bypass limits.
                </p>
              </div>

              {/* Image Preview Window */}
              <div className="border border-zinc-900 rounded-2xl bg-black/60 overflow-hidden relative max-h-[50vh] md:max-h-[55vh] flex items-center justify-center p-3 shadow-inner">
                <img 
                  src={capturedImage} 
                  alt="Bracket Export Preview" 
                  className="max-w-full max-h-[46vh] md:max-h-[50vh] object-contain rounded-lg border border-zinc-900 shadow-2xl selection:bg-transparent"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center max-w-md mx-auto">
                <a 
                  href={capturedImage} 
                  download={`bracket-${activeTournament?.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'share'}.png`}
                  className="btn-tactile-yellow flex-1 py-3 text-xs font-mono tracking-widest uppercase flex items-center justify-center gap-1.5"
                >
                  <Download className="w-4 h-4 text-neutral-950" />
                  <span>Download Blueprint File</span>
                </a>
                <button
                  onClick={() => setCapturedImage(null)}
                  className="btn-tactile-zinc flex-1 py-3 text-xs font-mono tracking-widest uppercase"
                >
                  Close Preview
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
