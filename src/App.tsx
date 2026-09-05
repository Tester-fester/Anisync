import { apiFetch } from "./utils/apiFetch";
import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import confetti from 'canvas-confetti';
import { AnimeTrack, Tournament, TournamentMatch, HistoryItem, TrackType, UserAccount, ContributionProposal } from './types';
import { INITIAL_TRACKS } from './initialTracks';
import { SEEDED_TRACKS } from './seededTracks';
import { getMainAnimeName } from './utils/animeFranchises';

const TrackLeaderboard = lazy(() => import('./components/TrackLeaderboard'));
const ArenaMatchup = lazy(() => import('./components/ArenaMatchup'));
const TournamentBracket = lazy(() => import('./components/TournamentBracket'));
const TourneyBuilderView = lazy(() => import('./components/TourneyBuilderView'));
const AdminQueue = lazy(() => import('./components/AdminQueue'));
const AdminPokedex = lazy(() => import('./components/AdminPokedex').then(module => ({ default: module.AdminPokedex })));
const UserProfileSection = lazy(() => import('./components/UserProfileSection'));
const GlobalSearch = lazy(() => import('./components/GlobalSearch'));
const WikiPage = lazy(() => import('./components/WikiPage'));
const GlobalPlayer = lazy(() => import('./components/GlobalPlayer'));
const ClashOfTheDay = lazy(() => import('./components/ClashOfTheDay'));
import { AdBanner } from './components/AdBanner';
import { getAnimeEraAndYear } from './utils/animeEras';
import { computeVoterCoefficient } from './utils/elo';
import { 
  Trophy, 
  Flame, 
  Award, 
  Sparkles, 
  Table, 
  TrendingUp, 
  Play, 
  HelpCircle,
  Music,
  Tv,
  Info,
  User,
  CheckCircle,
  XCircle,
  X,
  Clock,
  Send,
  ExternalLink,
  Users,
  Home,
  UserCircle,
  Search,
  Disc,
  Layers,
  Film
} from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import { AnisyncLogo } from './components/AnisyncLogo';

const WelcomeOnboarding = lazy(() => import('./components/WelcomeOnboarding').then(module => ({ default: module.WelcomeOnboarding })));

// Live Firebase references
import { db, auth } from './utils/firebase';
import { doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged } from 'firebase/auth';
import { 
  seedDefaultTracksIfEmpty, 
  resetDatabaseDb, 
  subscribeTracks, 
  subscribeRecentHistory, 
  // saveMatchVote removed — Arena votes now go through queueArenaVote (batched)
  // subscribeProposals / subscribeUserProfiles / subscribeActiveTournaments /
  // subscribePokedexCollectibles removed — replaced by polling alternatives
  // in pollingSubscriptions.ts (saves ~80% of reads on slow-changing data)
  submitProposalToDb, 
  updateProposalStatusInDb, 
  addTrackToDb, 
  updateTrackYtIdInDb, 
  updateTrackAnimeNameInDb,
  updateTrackTagsInDb,
  deleteTrackFromDb,
  deleteTracksBatch,
  getUserProfile,
  saveUserProfile,
  saveTournamentState,
  deleteTournamentFromDb,
  deleteReviewFromDb,
  checkAndAwardCompletistBadge,
} from './utils/firestoreService';
import { safeGetJSON, safeSetJSON, incrementSessionCount, isNewUser } from './utils/safeLocalStorage';
import { fetchIsAdmin, isLegacyAdminEmail } from './utils/adminAuth';
import { generateId } from './utils/autoId';
import { ConfirmHost } from './utils/confirm';
import { GenericSkeleton, LeaderboardSkeleton, ArenaSkeleton } from './components/Skeleton';
import { createDebouncedProfileSaver, isQuotaExceeded, queueArenaVote, flushArenaVoteBatch } from './utils/bulkFirestore';
import { pollUserProfiles, pollActiveTournaments, pollPokedexCollectibles, pollProposals, subscribeTournament } from './utils/pollingSubscriptions';
// useGamification removed — XP/streak system no longer used
// useScreenShake removed — was only used for XP celebrations
// CelebrationOverlay removed — XP/streak celebrations no longer shown
// FloatingXpGain removed — XP UI no longer shown
// XpProgressBar removed — XP UI no longer shown
// StreakFlame removed — streak UI no longer shown
// computeXpFromVotes removed — XP calculation no longer needed
import { ErrorState } from './components/EmptyState';

import { Toaster, toast } from 'sonner';
import { playSound } from './utils/howlerAudio';

const DetailedSearchPage = lazy(() => import('./components/DetailedSearchPage'));

export default function App() {
  // Count this as a new session on every mount — used to suppress AdBanner
  // for the first 3 sessions (new-user first impression).
  useEffect(() => { incrementSessionCount(); }, []);

  // Navigation: 'leaderboard' | 'arena' | 'tournament' | 'database' | 'wrapped' | 'profile' | 'detailed_search'
  const [activeTab, setActiveTab] = useState<string>('leaderboard');

  // Unified loader that merges initial raw tracks and seeded items for a fully packed startup db
  const getInitializedTracks = (): AnimeTrack[] => {
    const list: AnimeTrack[] = [...INITIAL_TRACKS];
    SEEDED_TRACKS.forEach((item, idx) => {
      // Check if item's title & type already exist in target list to prevent any possibility of duplication
      const duplicate = list.some(existing => 
        existing.title.toLowerCase().trim() === item.title.toLowerCase().trim() &&
        existing.type === item.type
      );
      if (!duplicate) {
        list.push({
          id: `seeded_${idx}`,
          title: item.title,
          artist: item.artist,
          animeName: item.animeName,
          type: item.type,
          youtubeId: item.youtubeId,
          elo: 1200 + (idx % 11) * 3, // Staggered Elo slightly so initial list has active tier variation
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          addedByUser: false
        });
      }
    });
    return list;
  };

  // State handles syncing in real-time from Firestore database
  const [tracks, setTracks] = useState<AnimeTrack[]>([]);
  const [tracksError, setTracksError] = useState<Error | null>(null);
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([]);
  const [proposals, setProposals] = useState<ContributionProposal[]>([]);
  const [pokedexCollectibles, setPokedexCollectibles] = useState<import('./types').PokedexCollectible[]>([]);
  
  const [availableTournaments, setAvailableTournaments] = useState<Tournament[]>([]);
  const [selectedOnlineTournamentId, setSelectedOnlineTournamentId] = useState<string | null>(null);
  const [localTournament, setLocalTournament] = useState<Tournament | null>(() => {
    return safeGetJSON<Tournament | null>('anitheme_local_tournament', null);
  });

  // ── Realtime + optimistic tournament overlay ─────────────────────────
  // Online tournaments are polled every 30s for the LOBBY view (browse list
  // of all active tournaments) — see pollingSubscriptions.ts for the cost
  // rationale. BUT once a viewer selects one (or hits the OBS overlay URL
  // `?obs=1&tid=...`), they're watching a single doc and need real-time
  // updates — votes should move the tug-of-war bar the instant they land,
  // and the winner screen should flip the instant the host settles.
  //
  // We layer two things on top of the 30s poll:
  //
  //   1. `subscribedTournament` — a per-doc onSnapshot subscription that
  //      fires for ALL viewers (host + non-host) the moment ANY write
  //      hits the tournament doc (vote, settle, status flip). This is the
  //      proper real-time channel; it replaces the 30s lag for the
  //      currently-viewed tournament. Listener is opened in the useEffect
  //      below and torn down on deselect / tab close.
  //
  //   2. `optimisticTournament` — a host-only local override that mirrors
  //      the very latest mutation BEFORE the Firestore write round-trip
  //      completes (~200–500 ms). Without this the voter would see a
  //      tiny lag between their click and the onSnapshot firing back.
  //      Dropped as soon as onSnapshot catches up to the same status.
  //
  // Together these fix both reported bugs for ALL viewers:
  //   • "My vote counts but the tug-of-war bar doesn't move."
  //     → onSnapshot fires on every vote, for every viewer.
  //   • "The winner screen never shows up."
  //     → onSnapshot fires with status='completed', and survives the
  //       poll's active-only filter (it's not a poll entry, it's a
  //       single-doc subscription).
  const [optimisticTournament, setOptimisticTournament] = useState<Tournament | null>(null);
  const [subscribedTournament, setSubscribedTournament] = useState<Tournament | null>(null);

  // Derived viewed tournament (selected online or active local).
  // Priority: optimistic (instant host feedback) → realtime subscription
  // (confirmed for all viewers) → polled lobby list → local offline.
  const activeTournament = useMemo(() => {
    if (selectedOnlineTournamentId) {
      if (optimisticTournament && optimisticTournament.id === selectedOnlineTournamentId) {
        return optimisticTournament;
      }
      if (subscribedTournament && subscribedTournament.id === selectedOnlineTournamentId) {
        return subscribedTournament;
      }
      const match = availableTournaments.find(t => t.id === selectedOnlineTournamentId);
      if (match) return match;
    }
    return localTournament;
  }, [selectedOnlineTournamentId, availableTournaments, localTournament, optimisticTournament, subscribedTournament]);

  // Open a per-tournament onSnapshot subscription whenever a viewer selects
  // an online tournament. Torn down on deselect / tab close. This is the
  // real-time channel that makes votes + winner-screen flips visible to
  // every connected viewer within ~300ms instead of 30s.
  useEffect(() => {
    // Capture the id at effect-run time so a rapid switch doesn't race.
    const tid = selectedOnlineTournamentId;
    if (!tid) {
      setSubscribedTournament(null);
      return;
    }
    let cancelled = false;
    const unsubscribe = subscribeTournament(
      tid,
      (t) => {
        if (cancelled) return;
        setSubscribedTournament(t);
        // Drop the optimistic override once the server has caught up to
        // the same status — the subscription is now the freshest source
        // and we don't want a stale optimistic copy masking it.
        if (t) {
          setOptimisticTournament(prev => {
            if (!prev || prev.id !== t.id) return prev;
            if (prev.status === t.status) return null;
            return prev;
          });
        } else {
          // Doc was deleted — also drop the optimistic copy.
          setOptimisticTournament(prev => (prev && prev.id === tid ? null : prev));
        }
      },
      (err) => {
        console.error('[subscribeTournament]', err);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
      setSubscribedTournament(null);
    };
  }, [selectedOnlineTournamentId]);

  /* OBS Browser Source auto-routing — when a streamer loads
     `?obs=1&tid=<tournamentId>` in OBS Studio's Browser Source, we
     need to (a) jump straight to the tournament tab, and (b) auto-select
     the online tournament the streamer is broadcasting, so the overlay
     renders without the streamer having to click around in OBS. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('obs') === '1') {
      setActiveTab('tournament');
      const tid = url.searchParams.get('tid');
      if (tid) setSelectedOnlineTournamentId(tid);
    }
  }, []);

  // Custom arena stream override from user curation lists
  const [customArenaTracksOverride, setCustomArenaTracksOverride] = useState<string[] | null>(null);
  const [customArenaName, setCustomArenaName] = useState<string | null>(null);
  const [clashMatchup, setClashMatchup] = useState<[AnimeTrack, AnimeTrack] | null>(null);

  const [initialTourneyFilter, setInitialTourneyFilter] = useState<string | null>(null);

  // Authentication & Moderation Session State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);

  // Debounced profile saver — coalesces rapid profile edits (favorite-slot
  // swaps, badge toggles, vibe-slider drags) into a single Firestore write
  // 800ms after the last edit. Replaces the per-call saveUserProfile which
  // was firing 1 write + 1 read on every slider tick.
  const debouncedSaveProfile = useMemo(
    () => createDebouncedProfileSaver(currentUser?.id),
    [currentUser?.id]
  );
  
  const [unlockedArchiveApp, setUnlockedArchiveApp] = useState<{name: string, total: number} | null>(null);

  // Local Guest Session stats for Duolingo-styled XP rewards
  const [guestVotes, setGuestVotes] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('anisync_guest_votes');
      return saved ? parseInt(saved, 10) : 0;
    } catch (_) {
      return 0;
    }
  });

  // Favorites & saved tracks (logged-out users only — logged-in users use Firestore).
  const [favorites, setFavorites] = useState<string[]>(() => safeGetJSON<string[]>('anitheme_favorites', []));
  const [saved, setSaved] = useState<string[]>(() => safeGetJSON<string[]>('anitheme_saved', []));

  // Dynamic voting speed tracking for anti-spam systems
  const [lastVoteTimes, setLastVoteTimes] = useState<number[]>([]);
  const [tournamentVoteBatch, setTournamentVoteBatch] = useState<any[]>([]);

  const voterInfo = useMemo(() => {
    return computeVoterCoefficient(lastVoteTimes);
  }, [lastVoteTimes]);

  const registerVoteTimestamp = () => {
    const now = Date.now();
    setLastVoteTimes(prev => [...prev, now].slice(-5));
  };
  
  const flushTournamentBatch = async () => {
    if (tournamentVoteBatch.length === 0) return;
    try {
      const { saveBatchedMatchVotes } = await import('./utils/firestoreService');
      await saveBatchedMatchVotes(tournamentVoteBatch);
      setTournamentVoteBatch([]);
    } catch (e) {
      console.error("Failed to flush tournament batch to database:", e);
    }
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best effort flush on window close
      flushTournamentBatch();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tournamentVoteBatch]);

  // Community Profiles and public viewer overlays
  const [userProfiles, setUserProfiles] = useState<UserAccount[]>([]);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);

  // Global Search State
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchField, setGlobalSearchField] = useState<'all' | 'artist' | 'anime' | 'title' | 'users'>('all');
  
  // Cross-app Wiki State
  const [activeWiki, setActiveWiki] = useState<{ type: 'anime' | 'artist' | 'part' | 'track'; key: string } | null>(null);

  // Global Player State
  const [globalPlayingTrack, setGlobalPlayingTrack] = useState<AnimeTrack | null>(null);
  const [globalPlaylist, setGlobalPlaylist] = useState<AnimeTrack[]>([]);
  const [globalPlaylistIndex, setGlobalPlaylistIndex] = useState<number>(-1);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState<boolean>(false);

  // Mobile Bottom Nav Auto-hide on scroll
  const [isMobileNavVisible, setIsMobileNavVisible] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const diff = Math.abs(currentScrollY - lastScrollY);
      
      // Only transition when scrolling a sufficient amount to ignore layout shifts or micro-scrolls
      if (diff > 35) {
        if (currentScrollY > lastScrollY && currentScrollY > 60) {
          // Scrolling down
          setIsMobileNavVisible(false);
        } else {
          // Scrolling up or at top
          setIsMobileNavVisible(true);
        }
        lastScrollY = currentScrollY;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Play next track in playlist
  const playNext = useCallback(() => {
    if (globalPlaylist.length > 0 && globalPlaylistIndex !== -1) {
      if (isShuffleEnabled) {
         const nextIndex = Math.floor(Math.random() * globalPlaylist.length);
         setGlobalPlaylistIndex(nextIndex);
         setGlobalPlayingTrack(globalPlaylist[nextIndex]);
      } else {
         const nextIndex = (globalPlaylistIndex + 1) % globalPlaylist.length;
         setGlobalPlaylistIndex(nextIndex);
         setGlobalPlayingTrack(globalPlaylist[nextIndex]);
      }
    }
  }, [globalPlaylist, globalPlaylistIndex, isShuffleEnabled]);

  const playPrev = useCallback(() => {
    if (globalPlaylist.length > 0 && globalPlaylistIndex !== -1) {
      const prevIndex = (globalPlaylistIndex - 1 + globalPlaylist.length) % globalPlaylist.length;
      setGlobalPlaylistIndex(prevIndex);
      setGlobalPlayingTrack(globalPlaylist[prevIndex]);
    }
  }, [globalPlaylist, globalPlaylistIndex]);

  // Synchronize favorites/saved from currentUser (localStorage fallback is
  // handled by the useState initializer via safeGetJSON — no need to re-read
  // on every currentUser change).
  useEffect(() => {
    if (currentUser) {
      setFavorites(currentUser.favoriteTrackIds || []);
      setSaved(currentUser.savedTrackIds || []);
    }
  }, [currentUser]);

  const toggleFavorite = async (trackId: string) => {
    const isFav = favorites.includes(trackId);
    let updatedFavs: string[];
    if (isFav) {
      updatedFavs = favorites.filter(id => id !== trackId);
      toast.success("Removed from Favorites");
    } else {
      updatedFavs = [...favorites, trackId];
      toast.success("Added to Favorites!");
    }
    setFavorites(updatedFavs);

    if (currentUser) {
      const updatedProfile = { favoriteTrackIds: updatedFavs };
      setCurrentUser(prev => prev ? { ...prev, ...updatedProfile } : null);
      await saveUserProfile(currentUser.id, updatedProfile);
    } else {
      safeSetJSON('anitheme_favorites', updatedFavs);
    }
  };

  const toggleSaved = async (trackId: string) => {
    const isSaved = saved.includes(trackId);
    let updatedSaved: string[];
    if (isSaved) {
      updatedSaved = saved.filter(id => id !== trackId);
      toast.success("Removed from Saved Themes");
    } else {
      updatedSaved = [...saved, trackId];
      toast.success("Saved theme successfully!");
    }
    setSaved(updatedSaved);

    if (currentUser) {
      const updatedProfile = { savedTrackIds: updatedSaved };
      setCurrentUser(prev => prev ? { ...prev, ...updatedProfile } : null);
      await saveUserProfile(currentUser.id, updatedProfile);
    } else {
      safeSetJSON('anitheme_saved', updatedSaved);
    }
  };

  const handleUpdateTrackTags = async (trackId: string, updatedTags: string[]) => {
    await updateTrackTagsInDb(trackId, updatedTags);
    toast.success("Theme tags updated!");
  };

  // Screen shake removed — was only used for XP level-up celebrations.
  const shakeClass = '';

  // Gamification engine removed — XP, levels, streaks no longer tracked or shown.
  // The voter coefficient (anti-spam ELO weighting) still runs via elo.ts.

  // Listen for Firebase Auth state changes with persistent profile sync.
  // Admin status is read from Firebase Custom Claims (preferred) — set via
  // the Firebase Admin SDK on the server. The legacy email allow-list is kept
  // as a fallback during migration.
  useEffect(() => {
    // Handle redirect result: when signInWithRedirect is used (Firefox, mobile,
    // popup-blocked browsers), the page navigates to Google and back. This
    // call picks up the result on page load.
    getRedirectResult(auth).catch((err) => {
      console.warn('[Auth] Redirect result error:', err.message);
    });

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const adminFromClaims = await fetchIsAdmin(user);
        // Also check the legacy email allow-list synchronously — this catches
        // the case where claims haven't been granted yet but the user is on
        // the allow-list.
        const adminFromEmail = isLegacyAdminEmail(user.email);
        const isAdmin = adminFromClaims || adminFromEmail;
        try {
          const dbProfile = await getUserProfile(user.uid);
          if (dbProfile) {
            setCurrentUser({
              ...dbProfile,
              role: isAdmin ? 'admin' : dbProfile.role || 'user'
            });
          } else {
            // First time logging in: initialize document in Firestore
            const initialProfile: UserAccount = {
              id: user.uid,
              username: user.displayName || 'Otaku' + Math.floor(Math.random() * 1000),
              email: user.email || '',
              picture: user.photoURL || undefined,
              role: isAdmin ? 'admin' : 'user',
              bio: '',
              malUser: '',
                      votesCount: 0
            };
            await saveUserProfile(user.uid, initialProfile);
            setCurrentUser(initialProfile);
          }
        } catch (err) {
          console.warn("Failed to load user profile, using auth fallback:", err);
          setCurrentUser({
            id: user.uid,
            username: user.displayName || 'User',
            email: user.email || '',
            picture: user.photoURL || undefined,
            role: isAdmin ? 'admin' : 'user',
                  votesCount: 0
          });
        }
      } else {
        setCurrentUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
        setIsLoginModalOpen(false);
        toast.success("Successfully signed in with Google!");
      } catch (popupError: any) {
        // If the popup was blocked/closed (common in Firefox, Safari, mobile),
        // fall back to redirect — navigates the whole page to Google and back.
        if (
          popupError.code === 'auth/popup-closed-by-user' ||
          popupError.code === 'auth/cancelled-popup-request' ||
          popupError.code === 'auth/popup-blocked'
        ) {
          toast.info("Popup blocked — redirecting to Google...");
          await signInWithRedirect(auth, provider);
          // Page navigates away — code below never runs
        } else {
          throw popupError;
        }
      }
    } catch (err: any) {
      toast.error("Google Sign-In failed: " + err.message);
    }
  };

  // Drop the optimistic override when the user navigates away from the
  // tournament it belonged to. Without this, the override would linger
  // and (if the user re-selects a different tournament with the same id
  // by coincidence) the wrong state would show.
  useEffect(() => {
    if (!selectedOnlineTournamentId && optimisticTournament) {
      setOptimisticTournament(null);
    } else if (optimisticTournament && selectedOnlineTournamentId && optimisticTournament.id !== selectedOnlineTournamentId) {
      setOptimisticTournament(null);
    }
  }, [selectedOnlineTournamentId, optimisticTournament]);

  // Real-time Firestore synchronization and active database seeding on boot
  useEffect(() => {
    const defaultBaseline = getInitializedTracks();
    seedDefaultTracksIfEmpty(defaultBaseline).then(() => {
      console.log("Seeding routine completed check.");
    }).catch(err => {
      console.error("Failed executing initial database checks.", err);
    });

    const unsubscribeTracks = subscribeTracks((updatedTracks) => {
      setTracks(updatedTracks);
      setTracksError(null); // Clear error on successful snapshot.
    }, (err) => {
      console.error("Tracks live synchronization failed:", err);
      setTracksError(err);
    });

    const unsubscribeHistory = subscribeRecentHistory((updatedHistory) => {
      setRecentHistory(updatedHistory);
    }, (err) => {
      console.error("History logs synchronization failed:", err);
    });

    // Polling subscriptions for slow-changing data — saves ~80% of reads
    // vs onSnapshot. See pollingSubscriptions.ts for the rationale.
    const unsubscribeUsers = pollUserProfiles((updatedUsers) => {
      setUserProfiles(updatedUsers);
    });

    const unsubscribeTournaments = pollActiveTournaments((updatedTournaments) => {
      setAvailableTournaments(updatedTournaments);
      // Drop the optimistic override once the server has caught up.
      // We check both: (a) the same tournament id is in the polled list,
      // and (b) the polled status matches our optimistic status. If the
      // poll hasn't picked up our latest write yet (e.g. lag), we keep
      // the override — better to show our newer state than to revert.
      setOptimisticTournament(prev => {
        if (!prev) return null;
        const serverMatch = updatedTournaments.find(t => t.id === prev.id);
        if (!serverMatch) {
          // Tournament was dropped from the active-only poll. If we marked
          // it completed, keep the optimistic copy so the winner screen
          // stays on. Otherwise drop it — it may have been deleted.
          return prev.status === 'completed' ? prev : null;
        }
        // Server caught up — let the polled snapshot take over.
        if (serverMatch.status === prev.status) return null;
        return prev;
      });
    });

    const unsubscribeCollectibles = pollPokedexCollectibles((docs) => {
      setPokedexCollectibles(docs);
    });

    return () => {
      unsubscribeTracks();
      unsubscribeHistory();
      unsubscribeUsers();
      unsubscribeTournaments();
      unsubscribeCollectibles();
    };
  }, []);

  // Proposals queue subscription
  useEffect(() => {
    if (!currentUser) {
      setProposals([]);
      return;
    }

    // Admin fetches all, User fetches only their own
    const emailFilter = currentUser.role === 'admin' ? undefined : currentUser.email;

    const unsubscribeProposals = pollProposals(emailFilter, (updatedProposals) => {
      setProposals(updatedProposals);
    });

    return () => {
      unsubscribeProposals();
    };
  }, [currentUser?.role, currentUser?.email]);

  // Register automated UI screenshot command controls — DEV ONLY.
  // In production this would leak the entire app's state and setState functions
  // onto window, which is both a security smell and a perf issue (the effect
  // re-runs on every state change).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window !== 'undefined') {
      (window as any).__controlAppForScreenshots = {
        setActiveTab,
        setActiveWiki,
        setGlobalPlayingTrack,
        setIsLoginModalOpen,
        setViewedProfileId,
        tracks,
        getCurrentState: () => ({
          activeTab,
          activeWiki,
          globalPlayingTrack,
          isLoginModalOpen,
          viewedProfileId
        })
      };
    }
  }, [activeTab, activeWiki, globalPlayingTrack, isLoginModalOpen, viewedProfileId, tracks]);

  // Global Stat Counters — single-pass reduce instead of 3 full sorts.
  const globalStats = useMemo(() => {
    let totalRated = 0;
    let highestRating = 1200;
    let championOP: AnimeTrack | null = null;
    let championED: AnimeTrack | null = null;
    let championOST: AnimeTrack | null = null;
    for (const t of tracks) {
      if (t.matchesPlayed > 0) totalRated++;
      if (t.elo > highestRating) highestRating = t.elo;
      if (t.type === 'OP' && (!championOP || t.elo > championOP.elo)) championOP = t;
      else if (t.type === 'ED' && (!championED || t.elo > championED.elo)) championED = t;
      else if (t.type === 'OST' && (!championOST || t.elo > championOST.elo)) championOST = t;
    }
    return {
      totalRated,
      totalMatches: recentHistory.length,
      highestRating,
      championOP,
      championED,
      championOST,
    };
  }, [tracks, recentHistory]);

  // Counts used in nav badges — memoized so they don't recompute on every render.
  const pendingProposalsCount = useMemo(
    () => proposals.filter(p => p.status === 'pending').length,
    [proposals]
  );
  const myProposalsCount = useMemo(
    () => proposals.filter(p => p.submittedBy === currentUser?.email).length,
    [proposals, currentUser?.email]
  );

  // Core Mutation: Add a new theme cleanly
  const handleAddTrack = (newTrackData: Omit<AnimeTrack, 'id' | 'elo' | 'matchesPlayed' | 'wins' | 'losses' | 'draws'>) => {
    const newId = generateId('tr');
    const newTrack: AnimeTrack = {
      ...newTrackData,
      id: newId,
      elo: 1200,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    addTrackToDb(newTrack).catch(err => {
      console.error("Failed to append track to Firestore", err);
      toast.error("Database error: " + err.message);
    });
  };

  // Core Mutation: Update YouTube ID for any track (helps resolve broken/deleted links)
  const handleUpdateTrackYtId = (id: string, newYtId: string) => {
    updateTrackYtIdInDb(id, newYtId).catch(err => {
      console.error("Failed to update YouTube ID in Firestore", err);
      toast.error("Database error: " + err.message);
    });
  };

  // Core Mutation: Update animeName for any track (helps align metadata with official MAL names)
  const handleUpdateTrackAnimeName = (id: string, newAnimeName: string, animePart?: string) => {
    const cleanAnimeName = getMainAnimeName(newAnimeName);
    updateTrackAnimeNameInDb(id, cleanAnimeName, animePart).catch(err => {
      console.error("Failed to update Anime Name in Firestore", err);
      toast.error("Database error: " + err.message);
    });
  };

  // Core Mutation: Delete an added theme
  const handleDeleteTrack = (id: string) => {
    deleteTrackFromDb(id).catch(err => {
      console.error("Failed to delete track from Firestore", err);
      toast.error("Database error: " + err.message);
    });
  };

  const handleDeleteTracksBatch = async (ids: string[]) => {
    try {
      await deleteTracksBatch(ids);
      toast.success(`Successfully purged ${ids.length} tracks.`);
    } catch (err: any) {
      console.error("Failed to batch delete tracks", err);
      toast.error("Database purge failed: " + err.message);
    }
  };

  // Reset Complete database
  const handleResetDatabase = () => {
    const freshlySeeded = getInitializedTracks();
    setSelectedOnlineTournamentId(null);
    setLocalTournament(null);
    localStorage.removeItem('anitheme_local_tournament');
    resetDatabaseDb(freshlySeeded).then(() => {
      toast.success("Database successfully reset and re-seeded!");
    }).catch(err => {
      console.error("Failed executing database wipe action", err);
      toast.error("Database error: " + err.message);
    });
  };

  // Modern Accounts & Proposals actions
  const handleSubmitProposal = (proposalData: any) => {
    const newId = generateId('prop');
    const newProposal: ContributionProposal = {
      ...proposalData,
      id: newId,
      submittedBy: currentUser ? currentUser.email : 'Guest Mode',
      submittedAt: new Date().toLocaleString(),
      status: 'pending'
    };
    submitProposalToDb(newProposal).then(() => {
      toast.success("Your submission proposal has been recorded in the database!");
    }).catch(err => {
      console.error("Failed to send proposal to Firestore", err);
      toast.error("Database error: " + err.message);
    });
  };

  const handleApproveProposal = (proposalId: string) => {
    const proposal = proposals.find(p => p.id === proposalId);
    if (!proposal) return;

    if (proposal.type === 'add_track') {
      const newTrackId = generateId('tr');
      const newTrack: AnimeTrack = {
        id: newTrackId,
        title: proposal.trackData.title,
        artist: proposal.trackData.artist,
        animeName: getMainAnimeName(proposal.trackData.animeName),
        type: proposal.trackData.type,
        youtubeId: proposal.trackData.youtubeId,
        elo: 1200,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        addedByUser: true,
      };
      
      addTrackToDb(newTrack).then(() => {
        return updateProposalStatusInDb(proposalId, 'approved');
      }).then(() => {
        toast.success("Proposal has been approved and track added!");
      }).catch(err => {
        console.error("Failed approving proposal", err);
        toast.error("Database error: " + err.message);
      });
    } else if (proposal.type === 'fix_link') {
      if (proposal.oldTrackId) {
        updateTrackYtIdInDb(proposal.oldTrackId, proposal.proposedYtId || proposal.trackData.youtubeId).then(() => {
          return updateProposalStatusInDb(proposalId, 'approved');
        }).then(() => {
          toast.success("YouTube link correction applied successfully.");
        }).catch(err => {
          console.error("Failed fixing link from proposal", err);
          toast.error("Database error: " + err.message);
        });
      }
    } else if (proposal.type === 'report_comment') {
      if (proposal.proposedYtId) {
        deleteReviewFromDb(proposal.proposedYtId).then(() => {
          return updateProposalStatusInDb(proposalId, 'approved');
        }).then(() => {
          toast.success("Comment deleted and proposal marked resolved.");
        }).catch(err => {
          console.error("Failed deleting comment from proposal", err);
          toast.error("Database error: " + err.message);
        });
      } else {
        toast.error("No valid comment reference found on proposal.");
      }
    }
  };

  const handleRejectProposal = (proposalId: string, reason?: string) => {
    updateProposalStatusInDb(proposalId, 'rejected', reason || 'Incorrect formatting or dead link.').then(() => {
      toast.success("Proposal has been set to rejected.");
    }).catch(err => {
      console.error("Failed rejecting proposal", err);
      toast.error("Database error: " + err.message);
    });
  };

  const handleClearProposalHistory = () => {
    // Admins can delete approved/rejected proposals to keep list clean
    const resolved = proposals.filter(p => p.status !== 'pending');
    resolved.forEach(p => {
      deleteDoc(doc(db, 'proposals', p.id)).catch(err => console.error("Could not delete proposal record", p.id, err));
    });
    toast.success("Cleaned up resolved proposals from active database snapshots!");
  };

  const registerUserVoteAction = async (votedTracks: string[] = []) => {
    if (currentUser) {
      const newVotesCount = (currentUser.votesCount || 0) + 1;
      const newVotedTrackIds = Array.from(new Set([...(currentUser.votedTrackIds || []), ...votedTracks]));
      const updatedUserVals: Partial<UserAccount> = {
        votesCount: newVotesCount,
        votedTrackIds: newVotedTrackIds
      };
      
      const userLevel = Math.floor(newVotesCount / 30) + 1;

      // Completion Logic
      if (votedTracks.length > 0) {
        const newlyVotedTcks = tracks.filter(t => votedTracks.includes(t.id));
        const mainAnimeNamesToCheck = Array.from(new Set(newlyVotedTcks.map(t => getMainAnimeName(t.animeName))));
        
        for (const mainAnimeName of mainAnimeNamesToCheck) {
          const animeTrackIds = tracks
            .filter(t => getMainAnimeName(t.animeName) === mainAnimeName && (t.type === 'OP' || t.type === 'ED'))
            .map(t => t.id);
          
          if (animeTrackIds.length > 0) {
            checkAndAwardCompletistBadge(currentUser.id, mainAnimeName, animeTrackIds).then(awarded => {
              if (awarded) {
                confetti({
                  particleCount: 200,
                  spread: 120,
                  colors: ['#FF3D2E', '#C81E55', '#1B2E4A', '#FFD34D'],
                  origin: { y: 0.6 }
                });
                
                // Show fullscreen unlock modal blocking next vote UI
                setUnlockedArchiveApp({ name: mainAnimeName, total: animeTrackIds.length });
                
                // Immediately refresh user state to show new collection locally
                setCurrentUser(prev => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    completedCollections: [...(prev.completedCollections || []), mainAnimeName]
                  };
                });
              }
            });
          }
        }
      }

      // Daily Streaks Engine — removed per user request.
      // Streak tracking is no longer shown to users. The voter coefficient
      // (anti-spam ELO weighting) still runs via elo.ts.
      // Keeping votesCount update only.

      if (clashMatchup) {
        updatedUserVals.lastClashPlayedDate = new Date().toISOString().split('T')[0];
      }

      setCurrentUser(prev => prev ? { ...prev, ...updatedUserVals } : null);
      saveUserProfile(currentUser.id, updatedUserVals).catch(err => {
        console.error("Failed to update user votes tally in DB:", err);
      });
    } else {
      // Offline/Guest vote progression for high-engagement simulation
      const newGuestVal = guestVotes + 1;
      setGuestVotes(newGuestVal);
      try {
        localStorage.setItem('anisync_guest_votes', newGuestVal.toString());
      } catch (_) {}
    }
  };

  // ELO adjustments for Arena Matchup
  const handleArenaVote = async (
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
    }
  ) => {
    const trackAObj = tracks.find(t => t.id === trackAId);
    const trackBObj = tracks.find(t => t.id === trackBId);

    if (!trackAObj || !trackBObj) return;

    registerVoteTimestamp();

    if (clashMatchup && (clashMatchup[0].id === trackAId || clashMatchup[0].id === trackBId)) {
      setTimeout(() => setClashMatchup(null), 3500);
    }

    const newHistItem: HistoryItem = {
      id: generateId('hist'),
      timestamp: new Date().toLocaleTimeString(),
      trackA: {
        id: trackAId,
        title: trackAObj.title,
        animeName: trackAObj.animeName,
        eloBefore: ratingChanges.aBefore ?? 1200,
        eloAfter: ratingChanges.aAfter ?? 1200,
      },
      trackB: {
        id: trackBId,
        title: trackBObj.title,
        animeName: trackBObj.animeName,
        eloBefore: ratingChanges.bBefore ?? 1200,
        eloAfter: ratingChanges.bAfter ?? 1200,
      },
      winnerId: outcome,
      source: 'arena',
    };

    if (!currentUser) {
      // Guest Mode: Local simulated Elo track and winrate updates
      const idxA = tracks.findIndex(t => t.id === trackAId);
      const idxB = tracks.findIndex(t => t.id === trackBId);
      if (idxA !== -1 && idxB !== -1) {
        setTracks(prev => {
          const updated = [...prev];
          updated[idxA] = {
            ...updated[idxA],
            elo: ratingChanges.aAfter,
            wins: updated[idxA].wins + (outcome === 'A' ? 1 : 0),
            losses: updated[idxA].losses + (outcome === 'B' ? 1 : 0),
            draws: updated[idxA].draws + (outcome === 'draw' ? 1 : 0),
            matchesPlayed: updated[idxA].matchesPlayed + 1
          };
          updated[idxB] = {
            ...updated[idxB],
            elo: ratingChanges.bAfter,
            wins: updated[idxB].wins + (outcome === 'B' ? 1 : 0),
            losses: updated[idxB].losses + (outcome === 'A' ? 1 : 0),
            draws: updated[idxB].draws + (outcome === 'draw' ? 1 : 0),
            matchesPlayed: updated[idxB].matchesPlayed + 1
          };
          return updated;
        });
      }
      setRecentHistory(prev => [newHistItem, ...prev]);
      registerUserVoteAction([trackAId, trackBId]);
      toast.info("Local vote simulated! Sign in to affect global ELO rankings. 🔒");
      return;
    }

    // Queue the vote for batched submission — 5 votes or 30s idle triggers a flush.
    // This coalesces trackA/trackB updates across multiple votes on the same track,
    // cutting Firestore writes by ~30-50% on a voting streak.
    queueArenaVote({
      trackAId,
      eloA: ratingChanges.aAfter,
      winsA: trackAObj.wins + (outcome === 'A' ? 1 : 0),
      lossesA: trackAObj.losses + (outcome === 'B' ? 1 : 0),
      drawsA: trackAObj.draws + (outcome === 'draw' ? 1 : 0),
      matchesPlayedA: trackAObj.matchesPlayed + 1,
      trackBId,
      eloB: ratingChanges.bAfter,
      winsB: trackBObj.wins + (outcome === 'B' ? 1 : 0),
      lossesB: trackBObj.losses + (outcome === 'A' ? 1 : 0),
      drawsB: trackBObj.draws + (outcome === 'draw' ? 1 : 0),
      matchesPlayedB: trackBObj.matchesPlayed + 1,
      newHistItem,
      voterCoefficient: voterInfo.coefficient,
    }).then(() => {
      registerUserVoteAction([trackAId, trackBId]);
    }).catch(err => {
      console.error("Arena voting queue error", err);
      if (isQuotaExceeded(err)) {
        toast.error("Daily vote quota hit — your vote was logged locally but didn't reach the global leaderboard. Resets at midnight Pacific.", { duration: 8000 });
      } else {
        toast.error("Couldn't save vote — please try again.", { description: err.message });
      }
    });
  };

  const handleSaveDiaryCommentary = (message: string) => {
    if (!currentUser) return;
    
    const newEntry = {
      id: generateId('diary'),
      timestamp: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      message: message.trim(),
      type: 'vote' as const
    };
    
    const updatedDiary = [...(currentUser.arenaDiary || []), newEntry];
    const updatedUserVals: Partial<UserAccount> = {
      arenaDiary: updatedDiary
    };

    // New Badge Achievement Reward: "chronicler" badge for writing battle commentary entries!
    let isNewChronicled = false;
    if ((currentUser.arenaDiary || []).length === 0) {
      isNewChronicled = true;
    }

    setCurrentUser(prev => prev ? { ...prev, ...updatedUserVals } : null);
    saveUserProfile(currentUser.id, updatedUserVals)
      .then(() => {
        if (isNewChronicled) {
          toast.success("🏆 Rank Achievement Unlocked: ANISON CHRONICLER badge earned for documenting battle rationales!");
        } else {
          toast.success("✓ Your commentary has been successfully recorded in your Battle Diary!");
        }
      })
      .catch(err => {
        console.error("Failed to append battle commentary directly to profile DB", err);
      });
  };

  const handleStartCustomArena = (trackIds: string[], playlistName: string) => {
    setCustomArenaTracksOverride(trackIds);
    setCustomArenaName(playlistName);
    setActiveTab('arena');
    setViewedProfileId(null);
    toast.success(`Active stream pool synchronized to custom registry: "${playlistName}"!`);
  };

  const handleStartCustomTournament = (trackIds: string[], playlistName: string, listId?: string) => {
    setLocalTournament(null);
    setSelectedOnlineTournamentId(null);
    if (listId) {
      setInitialTourneyFilter(`custom_list_${listId}`);
    } else {
      setInitialTourneyFilter('ALL');
    }
    setActiveTab('tournament');
    setViewedProfileId(null);
    window.scrollTo(0,0);
    toast.success(`Configuring custom tournament for: "${playlistName}"...`);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Community playlist / tournament template system wiring
  //
  // buildTournamentFromIds — builds an offline (local) single-elimination
  // tournament directly from a list of track IDs. Used by TourneyBuilderView's
  // "Run now" action on saved/community templates.
  //
  // The seeding tables MUST match TournamentBracket's pairing tables exactly,
  // otherwise the bracket will be unfair (e.g. 1v2 in round one).
  //   4 players:  [0,3,1,2]
  //   8 players:  [0,7,3,4,1,6,2,5]
  //   16 players: [0,15,7,8,3,12,4,11,1,14,6,9,2,13,5,10]
  // ─────────────────────────────────────────────────────────────────────────────
  const buildTournamentFromIds = (trackIds: string[], title: string): Tournament | null => {
    // Map IDs to tracks via the `tracks` state array; drop unresolvable IDs.
    const resolved = trackIds
      .map(id => tracks.find(t => t.id === id))
      .filter(Boolean) as AnimeTrack[];
    if (resolved.length < 2) return null;

    // Sort by ELO descending so seeds line up with rank.
    const sortedByElo = [...resolved].sort((a, b) => b.elo - a.elo);

    // Standard bracket seeding — top seed vs bottom seed, etc.
    // (indices are into sortedByElo; other sizes keep order)
    // 32-player derived by recursively mirroring each seed with N-1-seed,
    // the same rule that produces the 4/8/16 tables below.
    const seedTables: Record<number, number[]> = {
      4:  [0, 3, 1, 2],
      8:  [0, 7, 3, 4, 1, 6, 2, 5],
      16: [0, 15, 7, 8, 3, 12, 4, 11, 1, 14, 6, 9, 2, 13, 5, 10],
      32: [0, 31, 15, 16, 7, 24, 8, 23, 3, 28, 12, 19, 4, 27, 11, 20,
           1, 30, 14, 17, 6, 25, 9, 22, 2, 29, 13, 18, 5, 26, 10, 21],
    };
    const seedTable = seedTables[sortedByElo.length];
    const seeded: AnimeTrack[] = seedTable
      ? seedTable.map(i => sortedByElo[i]).filter(Boolean)
      : sortedByElo;
    if (seeded.length < 2) return null;

    // Build the flat matches array. Round 0's matches get trackAId/trackBId
    // from the seeded pairs; subsequent rounds are placeholders filled in by
    // the bracket as votes land.
    const matches: TournamentMatch[] = [];
    let playerCount = seeded.length;
    let roundIndex = 0;
    while (playerCount >= 2) {
      const matchCountInRound = playerCount / 2;
      for (let m = 0; m < matchCountInRound; m++) {
        const match: TournamentMatch = {
          id: `m_${roundIndex}_${m}`,
          round: roundIndex,
          matchIndex: m,
          voted: false,
          votes: {},
          votesA: 0,
          votesB: 0,
        };
        if (roundIndex === 0) {
          match.trackAId = seeded[m * 2]?.id;
          match.trackBId = seeded[m * 2 + 1]?.id;
        }
        matches.push(match);
      }
      playerCount = matchCountInRound;
      roundIndex++;
    }

    // Cast size to the Tournament interface's union — handleRunTournamentTemplate
    // enforces 4/8/16/32 upstream, so this cast is sound at every call site.
    const size = seeded.length as 4 | 8 | 16 | 32;

    return {
      id: generateId('tourney'),
      name: title,
      size,
      typeFilter: 'ALL',
      currentRound: 0,
      currentMatchIndex: 0,
      matches,
      status: 'active',
      isOnline: false,
      createdBy: currentUser?.email || 'Guest Contender',
      createdByUsername: currentUser?.username || 'Guest',
      historyLog: [],
    };
  };

  // Run a tournament template immediately — dedupe, validate the count, build
  // the bracket, persist it locally + (if logged in) to Firestore, and jump
  // to the tournament tab.
  const handleRunTournamentTemplate = (trackIds: string[], title: string) => {
    // Dedupe and keep only IDs that exist in `tracks`.
    const seen = new Set<string>();
    const validIds: string[] = [];
    for (const id of trackIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (tracks.some(t => t.id === id)) validIds.push(id);
    }
    const count = validIds.length;
    if (count !== 4 && count !== 8 && count !== 16 && count !== 32) {
      toast.error(
        `Tournaments need exactly 4, 8, 16, or 32 valid tracks. Found ${count}.`
      );
      return;
    }
    const t = buildTournamentFromIds(validIds, title);
    if (!t) {
      toast.error('Could not build a tournament from these tracks.');
      return;
    }
    // Persist: local state + localStorage + (if logged in) Firestore.
    setLocalTournament(t);
    setSelectedOnlineTournamentId(null);
    try {
      localStorage.setItem('anitheme_local_tournament', JSON.stringify(t));
    } catch (e) {
      console.error('Failed to persist local tournament to localStorage', e);
    }
    if (currentUser) {
      saveTournamentState(t).catch(err =>
        console.error('Failed to save tournament state to Firestore', err)
      );
    }
    // Navigate to the bracket.
    setActiveTab('tournament');
    setViewedProfileId(null);
    window.scrollTo(0, 0);
    toast.success(`"${title}" bracket is live!`);
  };

  // Generic partial-field profile saver. Used by SaveToPlaylistModal (via
  // TrackLeaderboard), TourneyBuilderView, and UserProfileSection — every
  // component that needs to merge a few fields into the user's profile doc
  // without overwriting the rest (a customTournaments save must not wipe
  // customLists, and vice versa).
  //
  // On error we re-throw so callers like SaveToPlaylistModal can revert their
  // local mirror — otherwise the checkboxes would show "saved" when the
  // Firestore write actually failed.
  const handleSaveProfileFields = async (updatedFields: any): Promise<void> => {
    if (!currentUser) return;
    // Optimistically merge into local state — UI feels instant.
    setCurrentUser(prev => (prev ? { ...prev, ...updatedFields } : prev));
    try {
      // saveUserProfile uses setDoc with merge:true — partial-field write.
      await saveUserProfile(currentUser.id, updatedFields);
    } catch (err: any) {
      console.error('Failed to save profile fields:', err);
      toast.error('Failed to save to your profile.');
      // Re-throw so callers can revert their local mirror.
      throw err;
    }
  };

  // ELO adjustments in Tournament mode matches (no draws permitted)
  const handleTournamentVote = (
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
  ) => {
    const trackAObj = tracks.find(t => t.id === trackAId);
    const trackBObj = tracks.find(t => t.id === trackBId);

    if (!trackAObj || !trackBObj) return;

    registerVoteTimestamp();

    const newHistItem: HistoryItem = {
      id: generateId('hist_t'),
      timestamp: new Date().toLocaleTimeString(),
      trackA: {
        id: trackAId,
        title: trackAObj.title,
        animeName: trackAObj.animeName,
        eloBefore: ratingChanges.aBefore ?? 1200,
        eloAfter: ratingChanges.aAfter ?? 1200,
      },
      trackB: {
        id: trackBId,
        title: trackBObj.title,
        animeName: trackBObj.animeName,
        eloBefore: ratingChanges.bBefore ?? 1200,
        eloAfter: ratingChanges.bAfter ?? 1200,
      },
      winnerId: outcome,
      source: 'tournament',
    };

    if (!currentUser) {
      // Guest Mode: Local simulated Elo track and winrate updates
      const idxA = tracks.findIndex(t => t.id === trackAId);
      const idxB = tracks.findIndex(t => t.id === trackBId);
      if (idxA !== -1 && idxB !== -1) {
        setTracks(prev => {
          const updated = [...prev];
          updated[idxA] = {
            ...updated[idxA],
            elo: ratingChanges.aAfter,
            wins: updated[idxA].wins + (outcome === 'A' ? 1 : 0),
            losses: updated[idxA].losses + (outcome === 'B' ? 1 : 0),
            matchesPlayed: updated[idxA].matchesPlayed + 1
          };
          updated[idxB] = {
            ...updated[idxB],
            elo: ratingChanges.bAfter,
            wins: updated[idxB].wins + (outcome === 'B' ? 1 : 0),
            losses: updated[idxB].losses + (outcome === 'A' ? 1 : 0),
            matchesPlayed: updated[idxB].matchesPlayed + 1
          };
          return updated;
        });
      }
      setRecentHistory(prev => [newHistItem, ...prev]);
      registerUserVoteAction([trackAId, trackBId]);
      toast.info("Local vote simulated! (Guest Mode active) 🔒");
      return;
    }

    const newVoteItem = {
      trackAId,
      eloA: ratingChanges.aAfter,
      winsA: trackAObj.wins + (outcome === 'A' ? 1 : 0),
      lossesA: trackAObj.losses + (outcome === 'B' ? 1 : 0),
      drawsA: trackAObj.draws,
      matchesPlayedA: trackAObj.matchesPlayed + 1,
      trackBId,
      eloB: ratingChanges.bAfter,
      winsB: trackBObj.wins + (outcome === 'B' ? 1 : 0),
      lossesB: trackBObj.losses + (outcome === 'A' ? 1 : 0),
      drawsB: trackBObj.draws,
      matchesPlayedB: trackBObj.matchesPlayed + 1,
      newHistItem,
      voterCoefficient: voterInfo.coefficient
    };

    setTournamentVoteBatch(prev => {
      const newBatch = [...prev, newVoteItem];
      // Optional: limit payload size, though 64-team bracket only has 63 matches
      if (newBatch.length >= 63) {
         // It should normally flush when tournament ends (status completed)
         // So this is just a fallback flush
         import('./utils/firestoreService').then(({ saveBatchedMatchVotes }) => {
            saveBatchedMatchVotes(newBatch).catch(console.error);
         });
         return [];
      }
      return newBatch;
    });

    registerUserVoteAction([trackAId, trackBId]);
  };

  const handleUpdateFullTournament = (t: Tournament) => {
    if (t.isOnline) {
      if (t.status === 'completed') {
        flushTournamentBatch();
      }
      
      if (currentUser) {
        // Optimistic override — see the `optimisticTournament` state comment
        // for why this is required to make votes move the tug-of-war bar
        // instantly and to make the winner screen render on settle.
        setOptimisticTournament(t);
        // Mirror into availableTournaments too, so the lobby list shows
        // the latest vote count for other viewers (their next poll will
        // overwrite this with the server's view, but in the meantime
        // nobody sees stale vote totals).
        setAvailableTournaments(prev => {
          const idx = prev.findIndex(x => x.id === t.id);
          if (idx === -1) return [...prev, t];
          const next = [...prev];
          next[idx] = t;
          return next;
        });
        saveTournamentState(t).catch(err => {
          console.error("Online tournament update failed", err);
        });
      } else {
        toast.error("Offline simulation: guest users cannot modify online tournaments.");
      }
    } else {
      setLocalTournament(t);
      try {
        localStorage.setItem('anitheme_local_tournament', JSON.stringify(t));
      } catch (_) {}
      if (currentUser) {
        saveTournamentState(t).catch(err => {
          console.error("Local tournament sync failed", err);
        });
      }
    }
  };

  return (
    <div className={`min-h-screen flex flex-col justify-between ${shakeClass}`}>
      <Toaster theme="dark" position="bottom-right" />
      <ConfirmHost />
      <WelcomeOnboarding />
      {/* CelebrationOverlay + FloatingXpGain removed — XP/streak system deleted */}
      {/* Main Navigation and Brand Banner */}
      <header className="glass-header sticky top-0 z-40 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 md:py-3 flex items-center justify-between gap-2 sm:gap-3 md:gap-6 min-w-0">
          
          {/* Left: Brand Logo & Desktop Navigation */}
          <div className="flex items-center gap-2 sm:gap-4 lg:gap-8 justify-start shrink-0 min-w-0">
            <div
              onClick={() => {
                setActiveTab('leaderboard');
                setViewedProfileId(null);
                setActiveWiki(null);
              }}
              className="flex items-center gap-2 cursor-pointer group hover:opacity-95 transition-all select-none shrink-0"
              role="button"
              tabIndex={0}
              aria-label="Go to home"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('leaderboard'); setViewedProfileId(null); setActiveWiki(null); } }}
            >
              <img
                src="/Logo.png"
                className="h-8 md:h-11 object-contain mix-blend-screen transition-transform duration-300"
                alt="ANISYNC" loading="lazy" decoding="async"
              />
              <div className="hidden lg:block">
                <span className="text-[11px] font-mono tracking-[0.2em] text-brand-primary uppercase bg-brand-primary/5 border border-brand-primary/10 px-2 py-0.5 rounded-md leading-none select-none">
                  ANISYNC
                </span>
              </div>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center">
              <nav className="flex items-center gap-1 p-1 bg-[#100C0A]/90 border border-white/5 rounded-xl shadow-inner">
                <button
                  id="tab-leaderboard-btn"
                  onClick={() => { playSound('click'); setActiveTab('leaderboard'); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                    activeTab === 'leaderboard'
                      ? 'bg-moss/10 border border-moss/30 text-moss shadow-[0_0_15px_rgba(61, 220, 132,0.15)]'
                      : 'text-zinc-500 hover:text-moss hover:bg-moss/5 border border-transparent'
                  }`}
                >
                  <Home className="w-3 h-3" />
                  <span>Home</span>
                </button>

                <button
                  id="tab-arena-btn"
                  onClick={() => { playSound('click'); setActiveTab('arena'); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                    activeTab === 'arena'
                      ? 'bg-vermillion/10 border border-vermillion/30 text-paper glow-cherry'
                      : 'text-zinc-500 hover:text-paper hover:bg-vermillion/5 border border-transparent'
                  }`}
                >
                  <Flame className="w-3 h-3" />
                  <span>1v1 Arena</span>
                </button>

                <button
                  id="tab-tournament-btn"
                  onClick={() => { playSound('click'); setActiveTab('tournament'); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all relative ${
                    activeTab === 'tournament'
                      ? 'bg-gold/10 border border-gold/30 text-gold-bright shadow-[0_0_15px_rgba(255, 138, 61,0.15)]'
                      : 'text-zinc-500 hover:text-gold-bright hover:bg-gold/5 border border-transparent'
                  }`}
                >
                  <Trophy className="w-3 h-3" />
                  <span>Tournament</span>
                  {activeTournament && activeTournament.status === 'active' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-gold-bright ml-0.5" />
                  )}
                </button>

                {currentUser?.role === 'admin' && (
                  <>
                  <button
                    id="tab-moderation-btn"
                    onClick={() => { playSound('click'); setActiveTab('moderation'); }}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                      activeTab === 'moderation'
                        ? 'bg-vermillion/10 border border-vermillion/30 text-vermillion'
                        : 'text-zinc-500 hover:text-vermillion hover:bg-vermillion/5 border border-transparent'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Moderation</span>
                    {pendingProposalsCount > 0 && (
                       <span className="bg-vermillion text-white text-[11px] px-1.5 py-0.5 rounded-sm ml-1 font-black leading-none">
                         {pendingProposalsCount}
                       </span>
                    )}
                  </button>
                  <button
                    onClick={() => { playSound('click'); setActiveTab('admin_pokedex'); }}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                      activeTab === 'admin_pokedex'
                        ? 'bg-indigo-ink/10 border border-indigo-ink/30 text-gold-bright'
                        : 'text-zinc-500 hover:text-gold-bright hover:bg-indigo-ink/5 border border-transparent'
                    }`}
                  >
                    <Disc className="w-3 h-3" />
                    <span>Pokedex</span>
                  </button>
                  </>
                )}

                {currentUser?.role === 'user' && (
                  <button
                    id="tab-submissions-btn"
                    onClick={() => setActiveTab('submissions')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                      activeTab === 'submissions'
                        ? 'bg-indigo-ink/10 border border-indigo-ink/30 text-gold-bright'
                        : 'text-zinc-500 hover:text-gold-bright hover:bg-indigo-ink/5 border border-transparent'
                    }`}
                  >
                    <User className="w-3 h-3" />
                    <span>Suggest</span>
                    {proposals.filter(p => p.submittedBy === currentUser.email).length > 0 && (
                      <span className="bg-indigo-ink text-white text-[11px] px-1.5 py-0.5 rounded-sm ml-1 font-black leading-none">
                        {proposals.filter(p => p.submittedBy === currentUser.email).length}
                      </span>
                    )}
                  </button>
                )}

                <button
                  id="tab-profile-btn"
                  onClick={() => { playSound('click'); setActiveTab('profile'); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                    activeTab === 'profile'
                      ? 'bg-rose-deep/10 border border-rose-deep/30 text-vermillion-tint shadow-[0_0_15px_rgba(27, 46, 74,0.15)]'
                      : 'text-zinc-500 hover:text-vermillion-tint hover:bg-rose-deep/5 border border-transparent'
                  }`}
                >
                  <UserCircle className="w-3 h-3" />
                  <span>Profile</span>
                </button>
              </nav>
            </div>
          </div>

          {/* Right: Search Feature & Profile Picture */}
          <div className="flex items-center justify-end shrink-0 gap-3">
            <button 
              className="hidden sm:flex border border-zinc-800/50 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono tracking-widest font-bold"
              onClick={() => setIsCommandPaletteOpen(true)}
            >
              <Search className="w-3.5 h-3.5" />
              <span>SEARCH</span>
              <kbd className="ml-2 font-mono bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800/50 text-zinc-500 text-[11px] shadow-sm">
                {typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </button>
            
            <button
              className="sm:hidden p-2 sm:p-2.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors border border-zinc-800/50"
              onClick={() => setIsCommandPaletteOpen(true)}
              aria-label="Open search"
            >
              <Search className="w-4 h-4" />
              <span className="sr-only">Open search</span>
            </button>

            {/* Gamification HUD removed — XP and streak systems are no longer shown to users.
                The voter coefficient (anti-spam ELO weighting) still runs internally. */}

            {/* Simple Profile Picture Button — just switches to profile tab */}
            <div 
              className="cursor-pointer rounded-full border-2 border-brand-primary/30 hover:border-brand-primary/80 transition-all overflow-hidden w-9 h-9 sm:w-10 sm:h-10 shrink-0"
              onClick={() => {
                setViewedProfileId(null);
                setActiveTab('profile');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <img 
                src={currentUser?.picture || "https://api.dicebear.com/7.x/avataaars/svg?seed=Guest"} 
                alt={currentUser?.username || "Guest"}
                className="w-full h-full object-cover" loading="lazy" decoding="async"
              />
            </div>
          </div>
          
        </div>
      </header>

      {/* Main Responsive Body Viewport */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 py-6 md:py-10 pb-24 lg:pb-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
          >
            <Suspense fallback={
              activeTab === 'leaderboard' ? <LeaderboardSkeleton /> :
              activeTab === 'arena' ? <ArenaSkeleton /> :
              <GenericSkeleton label="Loading…" />
            }>

            {/* Firestore fetch error state — shows a retry card instead of a
                silent empty list when the tracks subscription fails. */}
            {tracksError && (
              <div className="mb-6">
                <ErrorState
                  title="Couldn't reach the arena"
                  message="We can't load the track database right now. Check your connection and try again."
                  onRetry={() => window.location.reload()}
                />
              </div>
            )}

            {(!currentUser || currentUser.subscriptionTier !== 'pro') &&
              !isNewUser() && // Suppress for first 3 sessions — better first impression.
              !tracksError && // No ads on error states.
              !['profile', 'wiki', 'moderation', 'admin_pokedex', 'submissions', 'detailed_search', 'tourney-builder'].includes(activeTab) && (
              <div className="mb-6">
                <AdBanner />
              </div>
            )}

            {activeTab === 'leaderboard' && (
              <>
                {/*
                  ClashOfTheDay now handles voting inline — no swap to
                  ArenaMatchup. The card itself plays music (single click)
                  and casts real votes via the same batched Firestore path
                  (queueArenaVote) as Arena votes.
                */}
                <ClashOfTheDay 
                  tracks={tracks}
                  currentUser={currentUser}
                  voterCoefficient={voterInfo.coefficient}
                  hasPlayedToday={currentUser?.lastClashPlayedDate === new Date().toISOString().split('T')[0]}
                  onVote={(trackAId, trackBId, outcome, changes) => {
                    // Set clashMatchup so handleArenaVote marks
                    // lastClashPlayedDate (daily lock). The state is no
                    // longer used to swap UI — ClashOfTheDay owns its
                    // own card state.
                    const a = tracks.find(t => t.id === trackAId);
                    const b = tracks.find(t => t.id === trackBId);
                    if (a && b) setClashMatchup([a, b]);
                    handleArenaVote(trackAId, trackBId, outcome, changes);
                  }}
                  onPlay={(track) => setGlobalPlayingTrack(track)}
                />
                <TrackLeaderboard
                  onShowWiki={(type, key) => setActiveWiki({ type, key })}
                  tracks={tracks}
                  onDeleteTrack={handleDeleteTrack}
                  onUpdateTrackYtId={handleUpdateTrackYtId}
                  currentUser={currentUser}
                  onSubmitProposal={handleSubmitProposal}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  onUpdateTrackTags={handleUpdateTrackTags}
                  onPlay={(track) => setGlobalPlayingTrack(track)}
                  recentHistory={recentHistory}
                  onSaveProfile={handleSaveProfileFields}
                />
              </>
            )}

            {activeTab === 'arena' && (
              <div className="space-y-6">
                {customArenaTracksOverride && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-brand-secondary/10 border border-brand-secondary/35 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4 shadow-lg backdrop-blur-md"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-secondary shrink-0" />
                      <div className="space-y-0.5">
                        <span className="font-mono text-[11px] uppercase font-black tracking-widest text-brand-secondary block leading-none">ACTIVE STREAM OVERRIDE</span>
                        <span className="text-white font-display text-xs font-black uppercase tracking-tight">Curation Registry: {customArenaName} ({customArenaTracksOverride.length} theme signals)</span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setCustomArenaTracksOverride(null);
                        setCustomArenaName(null);
                        toast.success("Active stream pool restored to global registry.");
                      }}
                      className="w-full sm:w-auto px-4 py-2 bg-zinc-950 hover:bg-brand-secondary hover:text-black font-mono text-[11px] uppercase font-black tracking-widest rounded-xl transition-all border border-brand-secondary/35 active:scale-95 cursor-pointer"
                    >
                      TERMINATE CUSTOM STREAM
                    </button>
                  </motion.div>
                )}
                <ArenaMatchup
                  tracks={customArenaTracksOverride
                    ? tracks.filter(t => customArenaTracksOverride.includes(t.id))
                    : tracks}
                  currentUser={currentUser}
                  onVote={handleArenaVote}
                  recentHistory={recentHistory}
                  onUpdateTrackYtId={handleUpdateTrackYtId}
                  onPlay={(track) => setGlobalPlayingTrack(track)}
                  isAdmin={currentUser?.role === 'admin'}
                  onSaveCommentary={handleSaveDiaryCommentary}
                  voterCoefficient={voterInfo.coefficient}
                  voterInfo={voterInfo}
                />
              </div>
            )}

            {activeTab === 'tournament' && (
              <TournamentBracket
                tracks={tracks}
                onVoteInTournament={handleTournamentVote}
                onUpdateFullTournament={handleUpdateFullTournament}
                voterCoefficient={voterInfo.coefficient}
                activeTournament={activeTournament}
                initialFilter={initialTourneyFilter}
                onStartTournament={(t) => {
                  if (t.isOnline) {
                    saveTournamentState(t);
                    setSelectedOnlineTournamentId(t.id);
                  } else {
                    setLocalTournament(t);
                    localStorage.setItem('anitheme_local_tournament', JSON.stringify(t));
                  }
                  setActiveTab('tournament');
                }}
                onClearTournament={() => {
                  if (activeTournament) {
                    if (activeTournament.isOnline) {
                      saveTournamentState({ ...activeTournament, status: 'completed' });
                      setSelectedOnlineTournamentId(null);
                    } else {
                      setLocalTournament(null);
                      localStorage.removeItem('anitheme_local_tournament');
                    }
                  }
                }}
                onUpdateTrackYtId={handleUpdateTrackYtId}
                availableTournaments={availableTournaments}
                selectedOnlineTournamentId={selectedOnlineTournamentId}
                onSelectOnlineTournamentId={setSelectedOnlineTournamentId}
                localTournament={localTournament}
                onUpdateLocalTournament={(t) => {
                  setLocalTournament(t);
                  if (t) {
                    localStorage.setItem('anitheme_local_tournament', JSON.stringify(t));
                  } else {
                    localStorage.removeItem('anitheme_local_tournament');
                  }
                }}
                currentUser={currentUser}
                onPlay={(track) => setGlobalPlayingTrack(track)}
                globalPlayingTrack={globalPlayingTrack}
                onRequestCustomBuilder={() => setActiveTab('tourney-builder')}
                onDeleteOnlineTournament={async (id) => {
                  try {
                    await deleteTournamentFromDb(id);
                    toast.success("Online tournament permanently removed by owner.");
                  } catch (error) {
                    toast.error("Failed to remove online tournament.");
                  }
                }}
              />
            )}

            {activeTab === 'tourney-builder' && (
              <TourneyBuilderView
                tracks={tracks}
                currentUser={currentUser}
                userProfiles={userProfiles}
                onSaveProfile={handleSaveProfileFields}
                onStartNow={handleRunTournamentTemplate}
                onCancel={() => setActiveTab('tournament')}
              />
            )}

            {activeTab === 'submissions' && currentUser && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-zinc-900">
                  <div>
                    <h2 className="text-xl font-display font-black text-white uppercase tracking-tight flex items-center gap-2">
                      <User className="w-5 h-5 text-gold-bright" />
                      <span>My Suggestions Portfolio</span>
                    </h2>
                    <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider mt-1">
                      Monitor approvals, nominations and status logs
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('leaderboard')}
                    className="px-3 py-1.5 border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 rounded text-[11px] font-mono font-black uppercase tracking-wider text-zinc-300 cursor-pointer"
                  >
                    ← Back to Leaderboard
                  </button>
                </div>

                {proposals.filter(p => p.submittedBy === currentUser.email).length === 0 ? (
                  <div className="text-center py-16 bg-zinc-950/30 border border-zinc-900 rounded-lg">
                    <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                    <p className="text-zinc-400 font-sans text-sm">You haven't submitted any suggestions yet.</p>
                    <p className="text-zinc-500 font-mono text-[11px] mt-1.5 uppercase">Use "+ Add Theme" or "Fix link" inside leaderboard to suggest contents!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {proposals
                      .filter(p => p.submittedBy === currentUser.email)
                      .map((p) => {
                        return (
                          <div key={p.id} className="p-5 bg-panel-bg border border-zinc-900 rounded-lg relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-5">
                            {/* Color edge status */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                              p.status === 'pending' ? 'bg-gold' : p.status === 'approved' ? 'bg-moss' : 'bg-vermillion'
                            }`} />

                            <div className="space-y-2 pl-2 flex-grow max-w-3xl">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-black border ${
                                  p.type === 'add_track' 
                                    ? 'bg-indigo-ink/10 text-gold-bright border-indigo-ink/20'
                                    : 'bg-vermillion/10 text-vermillion border-vermillion/20'
                                }`}>
                                  {p.type === 'add_track' ? 'NEW TRACK REQUEST' : 'LINK REPLACEMENT SUGGESTION'}
                                </span>
                                <span className="text-[11px] text-zinc-500 font-mono">{p.submittedAt}</span>
                              </div>

                              <div>
                                <h4 className="font-bold text-white text-sm uppercase flex items-center gap-1.5">
                                  {p.trackData.title}
                                  <span className="text-[11px] font-mono font-black text-zinc-400 bg-zinc-900 border border-zinc-800 px-1 rounded">
                                    {p.trackData.type}
                                  </span>
                                </h4>
                                <p className="text-zinc-400 text-xs font-sans mt-0.5">by {p.trackData.artist} • Anime: <span className="text-zinc-300 font-medium">{p.trackData.animeName}</span></p>
                              </div>

                              {p.notes && (
                                <div className="p-2.5 bg-zinc-950 border border-zinc-900 rounded text-xs text-zinc-400 font-mono max-w-xl">
                                  <span className="text-[11px] text-zinc-500 block uppercase mb-0.5 tracking-wider">Submission Log Remark:</span>
                                  {p.notes}
                                </div>
                              )}
                            </div>

                            <div className="shrink-0 flex md:flex-col items-end gap-2.5 text-right">
                              <span className={`px-2.5 py-1 rounded font-mono text-[11px] font-black uppercase flex items-center gap-1.5 border ${
                                p.status === 'pending' 
                                  ? 'bg-gold/5 text-gold-bright border-gold/20'
                                  : p.status === 'approved'
                                    ? 'bg-moss/5 text-moss border-moss/20'
                                    : 'bg-vermillion/5 text-vermillion border-vermillion/20'
                              }`}>
                                {p.status === 'pending' && <Clock className="w-3.5 h-3.5" />}
                                {p.status === 'approved' && <CheckCircle className="w-3.5 h-3.5" />}
                                {p.status === 'rejected' && <XCircle className="w-3.5 h-3.5" />}
                                <span>{p.status}</span>
                              </span>
                              {p.trackData.youtubeId && (
                                <a 
                                  href={`https://youtube.com/watch?v=${p.trackData.youtubeId}`}
                                  target="_blank"
                                  rel="noreferrer referrer"
                                  className="text-[11px] font-mono text-zinc-500 hover:text-white flex items-center justify-end gap-1"
                                >
                                  <span>Verify Live video</span>
                                  <ExternalLink className="w-3 h-3 text-zinc-500 shrink-0" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'admin_pokedex' && currentUser?.role === 'admin' && (
              <AdminPokedex allTracks={tracks} />
            )}

            {activeTab === 'moderation' && currentUser?.role === 'admin' && (
              <AdminQueue
                onDeleteTracksBatch={handleDeleteTracksBatch}
                proposals={proposals}
                tracks={tracks}
                onApproveProposal={handleApproveProposal}
                onRejectProposal={handleRejectProposal}
                onClearHistory={handleClearProposalHistory}
                onUpdateTrackYtId={handleUpdateTrackYtId}
                onUpdateTrackAnimeName={handleUpdateTrackAnimeName}
                onRemoveDuplicates={async (onProgress) => {
                  try {
                    const preventClose = (e: BeforeUnloadEvent) => {
                      e.preventDefault();
                      e.returnValue = '';
                    };
                    window.addEventListener('beforeunload', preventClose);

                    const log = (msg: string) => {
                       onProgress?.(msg);
                    };

                    const cleanTitleStr = (s: string) => {
                      if (!s) return '';
                      let t = s.toLowerCase();
                      t = t.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").replace(/~.*?~/g, "");
                      t = t.replace(/(tv size|tv edit|off vocal|instrumental|karaoke|inst\.|tv\-size)/g, "");
                      return t.replace(/[^a-z0-9]/g, "").trim();
                    };

                    const duplicatesToDelete: string[] = [];
                    // Sort activeTracks first: Prioritize tracks with valid YouTube clips, then shorter/cleaner titles
                    const sortedActiveTracks = [...tracks].sort((a, b) => {
                      const scoreA = (a.youtubeId && a.youtubeId !== "Fve_l8I0Ayk" && a.youtubeId.length > 5) ? 100 : 0;
                      const scoreB = (b.youtubeId && b.youtubeId !== "Fve_l8I0Ayk" && b.youtubeId.length > 5) ? 100 : 0;
                      if (scoreA !== scoreB) return scoreB - scoreA;
                      return (a.title || "").length - (b.title || "").length;
                    });

                    log(`Starting deduplication process. Total tracks in memory: ${sortedActiveTracks.length}`);

                    // Stage 1: Deterministic Local Exact Deduplication (Instant & Free)
                    const seenSignatures = new Set<string>();
                    const seenYtIds = new Set<string>();
                    const localKeepList: typeof tracks = [];
                    const tracksToNormalize: { id: string; animeName: string }[] = [];

                    for (const track of sortedActiveTracks) {
                      const normalizedAnimeName = getMainAnimeName(track.animeName || "").trim();
                      const animeKey = normalizedAnimeName.toLowerCase();
                      const cleanedTitle = cleanTitleStr(track.title || "");
                      const ytId = (track.youtubeId || "").toString().trim();
                      
                      const tSig = `${animeKey}||${cleanedTitle}`;
                      
                      let isDuplicate = false;
                      if (seenSignatures.has(tSig)) {
                        isDuplicate = true;
                      } else if (ytId && ytId !== "Fve_l8I0Ayk" && seenYtIds.has(ytId)) {
                        isDuplicate = true;
                      }

                      if (isDuplicate) {
                        duplicatesToDelete.push(track.id);
                      } else {
                        seenSignatures.add(tSig);
                        if (ytId && ytId !== "Fve_l8I0Ayk") {
                          seenYtIds.add(ytId);
                        }
                        if (track.animeName !== normalizedAnimeName) {
                          tracksToNormalize.push({ id: track.id, animeName: normalizedAnimeName });
                        }
                        const updatedTrack = { ...track, animeName: normalizedAnimeName };
                        localKeepList.push(updatedTrack);
                      }
                    }

                    // Stage 2: Coalesced Franchise Grouping for Remaining Unique Substrings
                    const uniqueNames: string[] = Array.from(new Set(localKeepList.map(t => (t.animeName || '') as string)));
                    const nameToGroupMap: Record<string, string> = {};
                    const sortedUniqueNames = [...uniqueNames].sort((a, b) => a.length - b.length);
                    
                    sortedUniqueNames.forEach(k => {
                      const sKey = k as string;
                      const normK = sKey.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
                      
                      const foundParent = Object.keys(nameToGroupMap).find(parent => {
                        const normParent = parent.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
                        if (normParent.length >= 4) {
                          if (normK.startsWith(normParent) || normParent.startsWith(normK)) {
                            return true;
                          }
                          if (normParent.length >= 6 && (normK.includes(normParent) || normParent.includes(normK))) {
                            return true;
                          }
                        }
                        return false;
                      });
                      
                      if (foundParent) {
                        nameToGroupMap[sKey] = nameToGroupMap[foundParent];
                      } else {
                        nameToGroupMap[sKey] = sKey;
                      }
                    });

                    // Sort tracks into coalesced franchise groups
                    const animeGroups: Record<string, typeof tracks> = {};
                    for (const track of localKeepList) {
                      const aName = (track.animeName || '') as string;
                      const coalescedKey = nameToGroupMap[aName] || aName;
                      if (!animeGroups[coalescedKey]) {
                        animeGroups[coalescedKey] = [];
                      }
                      animeGroups[coalescedKey].push(track);
                    }

                    // CRITICAL OPTIMIZATION: Only send franchise groups containing >= 2 tracks to the AI!
                    // If a group has only 1 track, it is guaranteed unique and has no peers to be a duplicate of.
                    // This trims down the AI scanning load by up to 90%, preventing API timeouts!
                    const candidateTracks: typeof tracks = [];
                    for (const [, groupTracks] of Object.entries(animeGroups)) {
                      if (groupTracks.length >= 2) {
                        candidateTracks.push(...groupTracks);
                      }
                    }

                    // Build smaller chunk sizes of 150 tracks for faster AI responses & 100% gateway safety
                    const chunks: (typeof tracks)[] = [];
                    let currentChunk: typeof tracks = [];
                    for (const track of candidateTracks) {
                      currentChunk.push(track);
                      if (currentChunk.length >= 150) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                      }
                    }
                    if (currentChunk.length > 0) {
                      chunks.push(currentChunk);
                    }

                    let scanMessage = `Database cleanup running: Found ${duplicatesToDelete.length} raw duplicates locally.`;
                    if (candidateTracks.length > 0) {
                      scanMessage += ` Scanning additional ${candidateTracks.length} franchise candidates...`;
                    }
                    toast.loading(scanMessage, { id: 'sweep-loader' });

                    let hadErrors = false;
                    for (let i = 0; i < chunks.length; i++) {
                      log(`Scanning chunk ${i + 1}/${chunks.length} via Database Sync Engine...`);
                      const chunk = chunks[i];
                      let success = false;
                      let attempts = 0;
                      
                      while (!success && attempts < 2) {
                        attempts++;
                        try {
                          const res = await apiFetch('/api/smart-sweep-duplicates', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tracks: chunk })
                          });
                          if (res.ok) {
                            const data = await res.json();
                            if (data && Array.isArray(data.duplicateIdsToDelete)) {
                              duplicatesToDelete.push(...data.duplicateIdsToDelete);
                              log(`Chunk ${i + 1}/${chunks.length} cleared. Detected ${data.duplicateIdsToDelete.length} candidate duplicates.`);
                            }
                            success = true;
                          } else {
                            throw new Error(`Server status ${res.status}`);
                          }
                        } catch (err: any) {
                          const msg = `[Sweep Chunk ${i + 1}/${chunks.length}] Attempt ${attempts} failed: ${err.message}`;
                          console.warn(msg);
                          log(msg);
                          if (attempts >= 2) {
                            hadErrors = true;
                            // Safe non-blocking warning continuation
                          } else {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                          }
                        }
                      }
                      
                      if (i < chunks.length - 1) {
                        // 3.5s cooling-off delay for free-tier Gemini API rate-limits
                        await new Promise(resolve => setTimeout(resolve, 3500));
                      }
                    }

                    let finalDuplicatesToDelete = Array.from(new Set(duplicatesToDelete));

                    if (finalDuplicatesToDelete.length === 0 && tracksToNormalize.length === 0) {
                      toast.dismiss('sweep-loader');
                      toast.info("No duplicates or inconsistent names found in database.");
                      window.removeEventListener('beforeunload', preventClose);
                      return;
                    }

                    if (finalDuplicatesToDelete.length > 0) {
                      toast.loading(`Sweeping ${finalDuplicatesToDelete.length} duplicates from database...`, { id: 'sweep-loader' });
                      const batchSize = 500;
                      for (let i = 0; i < finalDuplicatesToDelete.length; i += batchSize) {
                        const chunk = finalDuplicatesToDelete.slice(i, i + batchSize);
                        const batch = writeBatch(db);
                        chunk.forEach(trackId => {
                          batch.delete(doc(db, 'tracks', trackId));
                        });
                        await batch.commit();
                      }
                    }

                    if (tracksToNormalize.length > 0) {
                      toast.loading(`Normalizing ${tracksToNormalize.length} inconsistent anime franchise entries...`, { id: 'sweep-loader' });
                      const batchSize = 500;
                      for (let i = 0; i < tracksToNormalize.length; i += batchSize) {
                        const chunk = tracksToNormalize.slice(i, i + batchSize);
                        const batch = writeBatch(db);
                        chunk.forEach(item => {
                          batch.update(doc(db, 'tracks', item.id), { animeName: item.animeName });
                        });
                        await batch.commit();
                      }
                    }
                    
                    window.removeEventListener('beforeunload', preventClose);
                    if (hadErrors) {
                      toast.success(`Sweep complete. Cleared ${finalDuplicatesToDelete.length} duplicates and normalized ${tracksToNormalize.length} franchise names. Some chunks skipped...`, { id: 'sweep-loader' });
                    } else {
                      toast.success(`Successfully swept ${finalDuplicatesToDelete.length} duplicates and normalized ${tracksToNormalize.length} franchise names in the repository!`, { id: 'sweep-loader' });
                    }
                  } catch (e: any) {
                    console.error("Failed to sweep duplicates:", e);
                    toast.error(`Error during duplicate sweep: ${e.message}`, { id: 'sweep-loader' });
                    // @ts-ignore
                    if (typeof preventClose !== 'undefined') window.removeEventListener('beforeunload', preventClose);
                  }
                }}
                onBulkAddTracks={async (newTracks) => {
                  try {
                    const preventClose = (e: BeforeUnloadEvent) => {
                      e.preventDefault();
                      e.returnValue = '';
                    };
                    window.addEventListener('beforeunload', preventClose);
                    
                    let addedCount = 0;
                    const normalizeString = (s: string) => {
                      if (!s) return '';
                      const franchise = getMainAnimeName(s);
                      return franchise.toLowerCase().replace(/[^a-z0-9]/g, '');
                    };
                    const cleanTitleStr = (s: string) => {
                      if (!s) return '';
                      let t = s.toLowerCase();
                      t = t.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").replace(/~.*?~/g, "");
                      t = t.replace(/(tv size|tv edit|off vocal|instrumental|karaoke|inst\.|tv\-size)/g, "");
                      return t.replace(/[^a-z0-9]/g, "").trim();
                    };
                    
                    const existingSignatures = new Set(tracks.map(t => `${normalizeString(t.animeName)}|${cleanTitleStr(t.title)}`));
                    const existingTitlesByAnime = new Set(tracks.map(t => `${normalizeString(t.animeName)}|${cleanTitleStr(t.title)}`));
                    const existingYtIds = new Set(tracks.map(t => t.youtubeId).filter(id => id && id !== "Fve_l8I0Ayk" && id.length > 0));
                    
                    const tracksToInsert: typeof tracks = [];
                    for (const t of newTracks) {
                      const normalizedName = getMainAnimeName(t.animeName || "").trim();
                      const sig = `${normalizeString(normalizedName)}|${cleanTitleStr(t.title)}`;
                      const crossTypeKey = `${normalizeString(normalizedName)}|${cleanTitleStr(t.title)}`;
                      
                      if (!existingSignatures.has(sig) && 
                          !existingTitlesByAnime.has(crossTypeKey) && 
                          (t.youtubeId === "" || t.youtubeId === "Fve_l8I0Ayk" || !existingYtIds.has(t.youtubeId))) {
                        const trackWithNormalizedName = {
                          ...t,
                          animeName: normalizedName
                        };
                        tracksToInsert.push(trackWithNormalizedName);
                        existingSignatures.add(sig);
                        existingTitlesByAnime.add(crossTypeKey);
                        if (t.youtubeId) {
                          existingYtIds.add(t.youtubeId);
                        }
                        addedCount++;
                      }
                    }

                    if (tracksToInsert.length > 0) {
                      const batchChunksOf = 400;
                      for (let i = 0; i < tracksToInsert.length; i += batchChunksOf) {
                        const chunk = tracksToInsert.slice(i, i + batchChunksOf);
                        const batch = writeBatch(db);
                        for (const track of chunk) {
                          batch.set(doc(db, 'tracks', track.id), track);
                        }
                        await batch.commit();
                      }
                    }
                    
                    window.removeEventListener('beforeunload', preventClose);

                    if (addedCount < newTracks.length) {
                      toast.success(`Smart Import: Added ${addedCount} new tracks, skipped ${newTracks.length - addedCount} duplicates.`);
                    } else {
                      toast.success(`Imported ${addedCount} heavy-hitter themes into active DB.`);
                    }
                    return addedCount;
                  } catch (e: any) {
                    console.error("Failed bulk import:", e);
                    toast.error(`Import failed: ${e.message}`);
                    return 0;
                  }
                }}
              />
            )}



            {activeTab === 'detailed_search' && (
              <DetailedSearchPage
                tracks={tracks}
                userProfiles={userProfiles}
                initialQuery={globalSearchQuery}
                initialField={globalSearchField}
                onPlay={(t) => setGlobalPlayingTrack(t)}
                onShowWiki={(type, key) => setActiveWiki({ type, key })}
                onViewProfile={(profileId) => {
                  setViewedProfileId(profileId);
                  setActiveTab('profile');
                }}
              />
            )}
            
            {activeTab === 'profile' && currentUser && (
              <UserProfileSection
                profile={currentUser}
                currentUser={currentUser}
                userProfiles={userProfiles}
                isOwnProfile={true}
                allTracks={tracks}
                pokedexCollectibles={pokedexCollectibles}
                onPlayTrack={(track) => {
                  setGlobalPlayingTrack(track);
                  setGlobalPlaylist([track]);
                  setGlobalPlaylistIndex(0);
                }}
                onPlayPlaylist={(tks, st) => {
                  setGlobalPlaylist(tks);
                  setGlobalPlaylistIndex(st);
                  setGlobalPlayingTrack(tks[st]);
                }}
                onStartCustomArena={handleStartCustomArena}
                onStartCustomTournament={handleStartCustomTournament}
                onSaveProfile={handleSaveProfileFields}
                onViewUserProfile={(userId) => setViewedProfileId(userId)}
                activeTrack={globalPlayingTrack}
                recentHistory={recentHistory}
              />
            )}
            
            {activeTab === 'profile' && !currentUser && (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-white/10 rounded-2xl bg-zinc-950">
                <User className="w-12 h-12 text-zinc-700 mb-4" />
                <h2 className="text-xl font-display font-bold text-white mb-2">Sign in to unlock your profile</h2>
                <p className="text-sm text-zinc-400 font-sans max-w-md mx-auto mb-6">
                  Sign in with Google to track your favorites, climb the ranks, sync with MyAnimeList, and join tournaments.
                </p>
                <button
                  onClick={() => setIsLoginModalOpen(true)}
                  className="bg-brand-primary text-black font-mono font-bold text-xs uppercase px-6 py-3 rounded-lg hover:bg-brand-primary-hover shadow-lg"
                >
                  Sign in with Google
                </button>
              </div>
            )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <AnimatePresence>
        {isMobileNavVisible && (
          <motion.nav 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="lg:hidden fixed bottom-0 left-0 w-full z-50 bg-black/95 backdrop-blur-2xl border-t border-zinc-900 pb-safe"
          >
            <div className="flex items-center justify-around h-[68px] px-1 pb-2">
              <button
                onClick={() => {
                  setActiveTab('leaderboard');
                }}
                className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                  activeTab === 'leaderboard' ? 'text-moss scale-[1.05] drop-shadow-[0_0_8px_rgba(61, 220, 132,0.5)]' : 'text-zinc-500 hover:text-moss'
                }`}
              >
                {activeTab === 'leaderboard' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-moss rounded-b" />}
                <Home className="w-5 h-5" />
                <span className="text-[11px] font-mono font-black uppercase tracking-wider">Home</span>
              </button>
              
              <button
                onClick={() => {
                  setActiveTab('arena');
                }}
                className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                  activeTab === 'arena' ? 'text-paper scale-[1.05] drop-shadow-[0_0_8px_rgba(200, 30, 85,0.5)] glow-cherry' : 'text-zinc-500 hover:text-paper'
                }`}
              >
                {activeTab === 'arena' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-paper rounded-b" />}
                <Flame className="w-5 h-5" />
                <span className="text-[11px] font-mono font-black uppercase tracking-wider">Arena</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('tournament');
                }}
                className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                  activeTab === 'tournament' ? 'text-gold-bright scale-[1.05] drop-shadow-[0_0_8px_rgba(255, 211, 77,0.5)]' : 'text-zinc-500 hover:text-gold-bright'
                }`}
              >
                {activeTab === 'tournament' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-gold rounded-b" />}
                <div className="relative">
                  <Trophy className="w-5 h-5" />
                  {activeTournament && activeTournament.status === 'active' && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-brand-secondary" />
                  )}
                </div>
                <span className="text-[11px] font-mono font-black uppercase tracking-wider">Tourney</span>
              </button>

              {currentUser?.role === 'admin' ? (
                <button
                  onClick={() => {
                    setActiveTab('moderation');
                  }}
                  className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                    activeTab === 'moderation' ? 'text-vermillion scale-[1.05] drop-shadow-[0_0_8px_rgba(232,121,249,0.5)]' : 'text-zinc-500 hover:text-vermillion'
                  }`}
                >
                  {activeTab === 'moderation' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-vermillion rounded-b" />}
                  <div className="relative">
                    <Sparkles className="w-5 h-5" />
                    {pendingProposalsCount > 0 && (
                      <span className="absolute -top-1 -right-2 flex items-center justify-center bg-vermillion font-mono text-[11px] font-black w-4 h-4 text-white rounded-full">
                        {pendingProposalsCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono font-black uppercase tracking-wider">Admin</span>
                </button>
              ) : currentUser?.role === 'user' ? (
                <button
                  onClick={() => {
                    setActiveTab('submissions');
                  }}
                  className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                    activeTab === 'submissions' ? 'text-gold-bright scale-[1.05] drop-shadow-[0_0_8px_rgba(255, 61, 46,0.5)]' : 'text-zinc-500 hover:text-gold-bright'
                  }`}
                >
                  {activeTab === 'submissions' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-gold-bright rounded-b" />}
                  <User className="w-5 h-5" />
                  <span className="text-[11px] font-mono font-black uppercase tracking-wider">Suggest</span>
                </button>
              ) : null}

              <button
                onClick={() => {
                  setActiveTab('profile');
                }}
                className={`relative flex flex-col items-center justify-center w-full h-full space-y-1 transition-all ${
                  activeTab === 'profile' ? 'text-vermillion-tint scale-[1.05] drop-shadow-[0_0_8px_rgba(192,132,252,0.5)]' : 'text-zinc-500 hover:text-vermillion-tint'
                }`}
              >
                {activeTab === 'profile' && <motion.div layoutId="mobileActiveTab" className="absolute top-0 w-10 h-0.5 bg-rose-deep rounded-b" />}
                <UserCircle className="w-5 h-5" />
                <span className="text-[11px] font-mono font-black uppercase tracking-wider">Profile</span>
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCommandPaletteOpen && (
          <GlobalSearch 
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            tracks={tracks}
            userProfiles={userProfiles}
            onSelectUser={(userId) => {
              setViewedProfileId(userId);
              setActiveTab('profile');
              setIsCommandPaletteOpen(false);
            }}
            onSelectTrack={(track) => {
              setActiveWiki({ type: 'track', key: track.id });
              setIsCommandPaletteOpen(false);
            }}
            onSelectAnimeWiki={(animeTitle) => {
              setActiveWiki({ type: 'anime', key: animeTitle });
              setIsCommandPaletteOpen(false);
            }}
            onSearchChange={(query, field) => {
              setGlobalSearchQuery(query);
              if (field) {
                setGlobalSearchField(field);
                setActiveTab('detailed_search');
              } else {
                setActiveTab('detailed_search');
              }
              setIsCommandPaletteOpen(false);
            }}
            onNavigate={(tab) => {
              setActiveTab(tab);
              setViewedProfileId(null);
              setActiveWiki(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Footer System Credits */}
      <footer className="border-t border-panel-border bg-[#0A0805] py-8 text-center select-none">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-zinc-500">
          <p>© 2026 ANISYNC. Anime theme ranking engine.</p>
          <div className="flex items-center gap-3">
            <span>Powered by YouTube Player API</span>
            <span className="text-zinc-800">•</span>
            <span>K-32 Elo Matchmaking Algorithm</span>
          </div>
        </div>
      </footer>

      {/* Account Control Hub and Google Sign-In Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLoginModalOpen(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative w-full max-w-xl bg-[#121216] border border-panel-border rounded-xl shadow-2xl overflow-y-auto max-h-[90vh] p-4 sm:p-6 z-10 space-y-5 scrollbar-thin scrollbar-thumb-zinc-800"
            >
              {/* Top Row and Close Button */}
              <div className="flex justify-between items-center pb-3 border-b border-zinc-900">
                <div>
                  <h3 className="font-display font-black text-sm text-white uppercase tracking-tight flex items-center gap-2">
                    <User className="w-4 h-4 text-brand-primary" />
                    <span>Account</span>
                  </h3>
                  <p className="text-[11px] font-mono tracking-wider text-zinc-500 uppercase mt-0.5">
                    Account & settings
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsLoginModalOpen(false)}
                    aria-label="Close"
                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    <span className="sr-only">Close</span>
                  </button>
                </div>
              </div>

              {currentUser ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 bg-zinc-950 p-4 rounded-xl border border-zinc-900">
                    <img src={currentUser.picture} className="w-16 h-16 rounded-xl border border-zinc-800" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                    <div>
                      <p className="text-white font-black text-lg">{currentUser.username}</p>
                      <p className="text-zinc-500 font-mono text-[11px] uppercase">Signed in</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                        setActiveTab('profile'); 
                        setIsLoginModalOpen(false);
                    }}
                    className="w-full py-3 rounded-lg bg-rose-deep text-white font-black text-xs uppercase"
                  >
                    Go To Full Profile Log
                  </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentUser(null);
                        auth.signOut().catch(err => console.error("Firebase auth logout failed:", err));
                        setActiveTab('leaderboard');
                        setIsLoginModalOpen(false);
                        toast.success("Successfully logged out from active session.");
                      }}
                      className="w-full px-2.5 py-3 border border-rose-deep hover:bg-vermillion/10 text-vermillion text-[11px] font-mono font-black uppercase rounded transition-all cursor-pointer hover:border-rose-deep shrink-0"
                    >
                      Sign Out
                    </button>
                </div>
              ) : (
                <>
                  {/* Account Status / Profile Overview - Guest Mode */}
                  <div className="p-3.5 bg-zinc-950/70 border border-zinc-900 rounded-lg flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded flex items-center justify-center text-xs font-mono font-black border uppercase bg-zinc-900 text-zinc-500 border-zinc-800 shrink-0 select-none">
                        GS
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-[#f8fafc] flex items-center gap-1.5 leading-none">
                          <span className="truncate">Guest / Visitor</span>
                          <span className="inline-block px-1.5 py-0.5 rounded-[2px] text-[11px] font-black font-mono uppercase bg-zinc-900 text-zinc-500 tracking-wider">
                            GS
                          </span>
                        </h4>
                        <p className="text-[11px] text-zinc-500 font-mono mt-1.5">Unauthenticated anonymous window. Log in to personalize profiles and track your progress!</p>
                      </div>
                    </div>
                  </div>

                  {/* Main Log In Trigger Buttons */}
                  <div className="space-y-3.5">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 font-bold text-white text-xs transition-all select-none cursor-pointer shadow-md group"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                      </svg>
                      <span>Connect Live Google Account</span>
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Public Member Profile Viewer Modal Popup */}
      <AnimatePresence>
        {viewedProfileId && (() => {
          const viewedProfile = userProfiles.find(u => u.id === viewedProfileId);
          if (!viewedProfile) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setViewedProfileId(null)}
                className="absolute inset-0 bg-black/85 backdrop-blur-md"
              />

              {/* Modal Card */}
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 15 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 15 }}
                transition={{ type: 'spring', duration: 0.4 }}
                className="relative w-full max-w-xl bg-panel-bg border border-panel-border rounded-xl shadow-2xl overflow-y-auto max-h-[90vh] p-4 sm:p-6 z-10 space-y-4 scrollbar-thin scrollbar-thumb-zinc-800"
              >
                <div className="flex justify-between items-center pb-2 border-b border-zinc-900">
                  <h3 className="font-display font-black text-xs text-zinc-500 uppercase tracking-widest leading-none">
                    Profile
                  </h3>
                  <button
                    type="button"
                    onClick={() => setViewedProfileId(null)}
                    aria-label="Close profile viewer"
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    <span className="sr-only">Close</span>
                  </button>
                </div>

                <UserProfileSection
                  profile={viewedProfile}
                  currentUser={currentUser}
                  userProfiles={userProfiles}
                  isOwnProfile={currentUser?.id === viewedProfile.id}
                  allTracks={tracks}
                  pokedexCollectibles={pokedexCollectibles}
                  onPlayTrack={(track) => {
                    setGlobalPlayingTrack(track);
                    setGlobalPlaylist([track]);
                    setGlobalPlaylistIndex(0);
                  }}
                  onPlayPlaylist={(tks, st) => {
                    setGlobalPlaylist(tks);
                    setGlobalPlaylistIndex(st);
                    setGlobalPlayingTrack(tks[st]);
                  }}
                  onStartCustomArena={handleStartCustomArena}
                  onStartCustomTournament={handleStartCustomTournament}
                  onSaveProfile={currentUser?.id === viewedProfile.id ? handleSaveProfileFields : undefined}
                  onViewUserProfile={(userId) => setViewedProfileId(userId)}
                  activeTrack={globalPlayingTrack}
                  recentHistory={recentHistory}
                />
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {activeWiki && (
          <WikiPage
            wikiType={activeWiki.type}
            wikiKey={activeWiki.key}
            allTracks={tracks}
            recentHistory={recentHistory}
            currentUser={currentUser}
            userProfiles={userProfiles}
            onPlay={(track) => setGlobalPlayingTrack(track)}
            onClose={() => setActiveWiki(null)}
            favorites={favorites}
            saved={saved}
            onToggleFavorite={toggleFavorite}
            onToggleSaved={toggleSaved}
            onSubmitProposal={handleSubmitProposal}
            onAddTrack={handleAddTrack}
            onUpdateTrackAnimeName={(id, newName) => {
               // Update track
               const track = tracks.find(t => t.id === id);
               if (track) {
                   // This is a simplified track update for now
                   console.log("Anime name updated", id, newName);
               }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {unlockedArchiveApp && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md px-4">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="bg-zinc-950 border border-brand-primary/40 rounded-3xl p-8 max-w-sm w-full text-center shadow-[0_0_80px_rgba(255, 61, 46,0.2)]"
            >
              <div className="relative mb-6 flex justify-center">
                <div className="w-24 h-24 rounded-full border border-brand-primary bg-black flex items-center justify-center shadow-[0_0_30px_rgba(255, 61, 46,0.5)]">
                  {unlockedArchiveApp.total >= 10 ? (
                    <Layers className="w-12 h-12 text-vermillion drop-shadow-[0_0_15px_rgba(200, 30, 85,0.8)]" /> 
                  ) : unlockedArchiveApp.total >= 5 ? (
                    <Film className="w-12 h-12 text-gold-bright drop-shadow-[0_0_15px_rgba(255, 211, 77,0.8)]" /> 
                  ) : (
                    <Disc className="w-12 h-12 text-gold-bright drop-shadow-[0_0_15px_rgba(255, 61, 46,0.8)]" /> 
                  )}
                </div>
              </div>
              <h1 className="font-display font-black text-2xl text-vermillion uppercase tracking-tighter mb-2">
                Archive Secured
              </h1>
              <p className="text-zinc-400 text-sm font-mono uppercase tracking-widest mb-1">
                Collection Completed
              </p>
              <p className="text-white font-bold text-lg mb-8 leading-tight">
                {unlockedArchiveApp.name}
              </p>
              <button
                onClick={() => setUnlockedArchiveApp(null)}
                className="w-full bg-brand-primary hover:bg-brand-primary/80 text-black font-black uppercase tracking-widest py-3 rounded-xl transition-all"
              >
                Continue Ranking
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <GlobalPlayer 
        track={globalPlayingTrack} 
        onClose={() => setGlobalPlayingTrack(null)} 
        isAdmin={currentUser?.role === 'admin'} 
        onAdminUpdate={(updatedTrack) => {
          setGlobalPlayingTrack(updatedTrack);
        }}
        onAdminDelete={(trackId) => {
          setGlobalPlayingTrack(null);
        }}
        hasNext={globalPlaylist.length > 1}
        hasPrev={globalPlaylist.length > 1}
        onNext={playNext}
        onPrev={playPrev}
        isShuffle={isShuffleEnabled}
        onToggleShuffle={() => setIsShuffleEnabled(!isShuffleEnabled)}
        isMobileNavVisible={isMobileNavVisible}
        playlist={globalPlaylist}
        playlistIndex={globalPlaylistIndex}
        onPlayIndex={(idx) => {
          setGlobalPlaylistIndex(idx);
          if (globalPlaylist[idx]) {
            setGlobalPlayingTrack(globalPlaylist[idx]);
          }
        }}
      />
    </div>
  );
}
