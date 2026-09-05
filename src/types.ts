/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TrackType = 'OP' | 'ED' | 'OST';

export interface PokedexCollectible {
  id: string; // The doc ID, usually the lowercased sanitized animeName
  animeName: string; // "Attack on Titan"
  description: string;
  iconType: 'emoji' | 'image';
  iconValue: string; // the emoji or image URL
  visualEffect: 'none' | 'glow-red' | 'glow-blue' | 'glow-purple' | 'sparkle' | 'holo' | 'fire' | 'void' | 'cherry-blossom' | 'gold-shine';
  requiredTrackIds: string[]; // List of specific track IDs the user needs to unlock
  createdAt: number;
}

export interface AnimeTrack {
  id: string;
  title: string;
  artist: string;
  animeName: string;
  animePart?: string;
  type: TrackType;
  youtubeId: string;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  addedByUser?: boolean;
  tags?: string[];
  customImageUrl?: string;
}

export interface TournamentMatch {
  id: string;
  round: number; // 0 for Round of 16/32, 1 for Quarter, 2 for Semi, 3 for Final (depending on size)
  matchIndex: number; // index inside this round
  trackAId?: string;
  trackBId?: string;
  winnerId?: string;
  voted?: boolean;
  votes?: { [userIdOrSessionId: string]: 'A' | 'B' };
  votesA?: number;
  votesB?: number;
}

export interface Tournament {
  id: string;
  name: string;
  size: 4 | 8 | 16 | 32;
  typeFilter: string;
  currentRound: number; // current active round index (0, 1, 2...)
  currentMatchIndex: number; // current active match index inside the round
  matches: TournamentMatch[]; // Flat list or round-by-round arrays. Let's make it a flat array.
  status: 'active' | 'completed';
  isOnline?: boolean;
  votingDuration?: number; // duration of each match in seconds
  matchEndTime?: number; // timestamp in ms for when current match ends
  createdBy?: string;
  createdByUsername?: string;
  winnerId?: string;
  // pacingMode removed — online tournaments always auto-advance when the timer
  // hits 0 per spec (no manual host intervention). Field kept in the comment
  // for migration context: existing Firestore docs may still carry a stale
  // `pacingMode: 'manual'` value but it's a no-op now.
  privacy?: 'public' | 'private';
  lobbyPassword?: string;
  currentlyPlayingId?: string;
  historyLog: {
    matchId: string;
    trackA: string;
    trackB: string;
    winner: string;
    eloChanges: {
      aBefore: number;
      aAfter: number;
      bBefore: number;
      bAfter: number;
    };
  }[];
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  trackA: {
    id: string;
    title: string;
    animeName: string;
    eloBefore: number;
    eloAfter: number;
  };
  trackB: {
    id: string;
    title: string;
    animeName: string;
    eloBefore: number;
    eloAfter: number;
  };
  winnerId: string; // 'A' or 'B' or 'draw'
  source: 'arena' | 'tournament';
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  picture?: string;
  banner?: string;
  bio?: string;
  malUser?: string;
  badges?: string[]; // e.g., ['early_adopter', 'mal_linked', 'voter_bronze', 'voter_silver', 'voter_gold', 'contributor']
  displayedBadgeIds?: string[]; // badges chosen to be displayed by user
  votesCount?: number;
  elo?: number; // Aggregate user ELO rating (separate from per-track ELO)
  createdAt?: string; // ISO date string — when the account was created
  lastClashPlayedDate?: string;
  streakCount?: number;
  lastStreakUpdateDate?: string;
  bestStreak?: number;
  following?: string[]; // Array of User IDs this user follows
  followersCount?: number; // Number of followers
  completedCollections?: string[]; // E.g., ['naruto', 'attack_on_titan', 'studio_ghibli']
  subscriptionTier?: 'free' | 'pro';
  activeCrest?: string; // Active avatar crest name, e.g. 'Cowboy Bebop'
  votedTrackIds?: string[]; // Track IDs the user has voted on in arena
  updatedAt?: string;
  favoriteTrackIds?: string[];
  savedTrackIds?: string[];
  vibeSpectrum?: {
    nostalgia: number;
    hype: number;
    atmospheric: number;
    symphonic: number;
    vocalIntensity: number;
  };
  customLists?: {
    id: string;
    name: string;
    description?: string;
    trackIds: string[];
    createdAt?: string;
  }[];
  arenaDiary?: {
    id: string;
    timestamp: string;
    message: string;
    type: 'vote' | 'tournament' | 'favorite' | 'general';
  }[];
  customTournaments?: {
    id: string;
    name: string;
    size: 4 | 8 | 16 | 32;
    tracks: (string | null)[]; // ordered tracks representing matchups
    createdAt: number;
  }[];
  // --- Gamification (XP / streaks / daily goals) ---
  // Added here so useGamification + the HUD read/write typed fields
  // instead of leaking `any` casts through the codebase.
  totalXp?: number;
  weeklyXp?: number;
  weeklyXpWeek?: string;
  dailyGoalDate?: string;
  dailyGoalVotes?: number;
  streakFreezeCount?: number;
}

export type ProposalType = 'add_track' | 'fix_link' | 'report_comment';

export interface ContributionProposal {
  id: string;
  type: ProposalType;
  submittedBy: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  trackData: {
    title: string;
    artist: string;
    animeName: string;
    type: TrackType;
    youtubeId: string;
    customImageUrl?: string;
  };
  oldTrackId?: string;
  proposedYtId?: string;
  notes?: string;
}

export interface TrackReview {
  id: string;
  trackId: string;
  userId: string;
  username: string;
  userPicture?: string;
  rating: number; // 1-10
  comment: string;
  createdAt: string;
  source?: 'arena' | 'tournament' | 'direct';
}

export interface ArtistProfile {
  id: string; // normalized lowercase of artistName
  artistName: string;
  imageUrl?: string;
  bio?: string;
  birthday?: string;
  websiteUrl?: string;
  malUrl?: string;
  updatedAt?: string;
}
