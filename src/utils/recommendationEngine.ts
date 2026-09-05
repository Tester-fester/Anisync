import { AnimeTrack, UserAccount } from '../types';
import { getAnimeEraAndYear } from './animeEras';

export interface VibeProfile {
  nostalgia: number;
  hype: number;
  atmospheric: number;
  symphonic: number;
  vocalIntensity: number;
}

/**
 * Dynamically computes a vibe profile for a track based on its metadata, type, and tags.
 */
export function getTrackVibeProfile(track: AnimeTrack): VibeProfile {
  let nostalgia = 30;
  let hype = 40;
  let atmospheric = 30;
  let symphonic = 20;
  let vocalIntensity = 50;

  // 1. Era/Nostalgia based on release year
  const { year } = getAnimeEraAndYear(track.animeName);
  if (year < 2000) {
    nostalgia = 95;
  } else if (year < 2010) {
    nostalgia = 75;
  } else if (year < 2018) {
    nostalgia = 45;
  } else {
    nostalgia = 20;
  }

  // Tags checking
  const tags = (track.tags || []).map(t => t.toLowerCase());
  
  if (tags.some(t => ['retro', 'classic', 'legendary', 'nostalgic', 'oldie', '90s', '80s', 'golden age'].includes(t))) {
    nostalgia += 25;
  }

  // 2. Hype
  if (track.type === 'OP') {
    hype = 75;
  } else if (track.type === 'ED') {
    hype = 30;
  } else {
    hype = 40;
  }
  if (tags.some(t => ['hype', 'rock', 'metal', 'intense', 'epic', 'action', 'battle', 'high energy', 'fast-tempo', 'power'].includes(t))) {
    hype += 25;
  }
  // Small boost for ELO (helps bubbling up popular hype anthems)
  hype += (track.elo - 1500) / 18;

  // 3. Atmospheric
  if (track.type === 'ED') {
    atmospheric = 75;
  } else if (track.type === 'OST') {
    atmospheric = 65;
  } else {
    atmospheric = 25;
  }
  if (tags.some(t => ['atmospheric', 'chill', 'sad', 'melancholic', 'emotional', 'slow', 'lofi', 'ambient', 'beautiful', 'calm'].includes(t))) {
    atmospheric += 30;
  }

  // 4. Symphonic
  if (track.type === 'OST') {
    symphonic = 80;
  } else {
    symphonic = 25;
  }
  if (tags.some(t => ['symphonic', 'orchestral', 'instrumental', 'cinematic', 'epic', 'piano', 'violin', 'choir', 'orchestra'].includes(t))) {
    symphonic += 30;
  }

  // 5. Vocal Presence / Intensity
  const intenseArtists = [
    'linked horizon', 'tk from', 'lisa', 'flow', 'tm_revolution', 'myth & roid', 'sim', 
    'fear, and loathing', 'aimer', 'one ok rock', 'man with a mission', 'granrodeo', 
    'unravel', 'kanon wakeshima', 'yoshiki', 'hyde', 'radwimps', 'kessoku', 'ado', 'eve'
  ];
  const artistLower = track.artist.toLowerCase();
  const hasIntenseArtist = intenseArtists.some(name => artistLower.includes(name));

  if (hasIntenseArtist) {
    vocalIntensity = 85;
  } else if (track.type === 'OP') {
    vocalIntensity = 70;
  } else if (track.type === 'ED') {
    vocalIntensity = 50;
  } else {
    vocalIntensity = tags.includes('vocal') ? 65 : 15; 
  }

  if (tags.some(t => ['vocal', 'vocals', 'vocalization', 'heavy vocals', 'choir', 'opera', 'screaming', 'intense vocals', 'lead vocal'].includes(t))) {
    vocalIntensity += 25;
  }

  return {
    nostalgia: Math.min(100, Math.max(0, nostalgia)),
    hype: Math.min(100, Math.max(0, hype)),
    atmospheric: Math.min(100, Math.max(0, atmospheric)),
    symphonic: Math.min(100, Math.max(0, symphonic)),
    vocalIntensity: Math.min(100, Math.max(0, vocalIntensity)),
  };
}

/**
 * Calculates a dynamic, personalized recommendation score for a track for a specific user.
 * Combines Vibe spectrum affinity and similarity to specified favorite tracks.
 */
export function calculateTrackScore(
  track: AnimeTrack,
  user: UserAccount | null,
  allTracks: AnimeTrack[] = [],
  cachedFavTracks?: AnimeTrack[]
): number {
  if (!user) {
    // If no user, default to popularity (weighted ELO)
    return track.elo;
  }

  const defaultVibe = {
    nostalgia: 75,
    hype: 85,
    atmospheric: 60,
    symphonic: 45,
    vocalIntensity: 70
  };

  const userVibe = user.vibeSpectrum || defaultVibe;
  const trackVibe = getTrackVibeProfile(track);

  // 1. Calculate similarity score between user vibe spectrum and track profile
  let score = 0;
  score += (userVibe.nostalgia / 100) * trackVibe.nostalgia * 1.2;
  score += (userVibe.hype / 100) * trackVibe.hype * 1.2;
  score += (userVibe.atmospheric / 100) * trackVibe.atmospheric * 1.0;
  score += (userVibe.symphonic / 100) * trackVibe.symphonic * 1.0;
  score += (userVibe.vocalIntensity / 100) * trackVibe.vocalIntensity * 1.1;

  // 2. Add Favorite Boost (similarity to user's favorite tracks)
  const favoriteTrackIds = user.favoriteTrackIds || [];
  if (favoriteTrackIds.length > 0) {
    let similarityBoost = 0;
    
    let favTracks = cachedFavTracks;
    
    if (!favTracks && allTracks.length > 0) {
      favTracks = favoriteTrackIds
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean) as AnimeTrack[];
    }

    if (favTracks) {
      const trackArtistLower = track.artist.toLowerCase();
      const trackCleanAnime = track.animeName.split('(')[0].trim().toLowerCase();
      const trackEra = getAnimeEraAndYear(track.animeName).eraId;
      const trackTags = track.tags || [];

      favTracks.forEach(fav => {
        const favArtistLower = fav.artist.toLowerCase();
        // Artist Match: Big boost if same artist
        if (favArtistLower === trackArtistLower) {
          similarityBoost += 15;
        } else if (trackArtistLower.includes(favArtistLower) || favArtistLower.includes(trackArtistLower)) {
          similarityBoost += 8;
        }

        // Anime Series similarity: Boost if same show series
        const favCleanAnime = fav.animeName.split('(')[0].trim().toLowerCase();
        if (favCleanAnime === trackCleanAnime || favCleanAnime.includes(trackCleanAnime) || trackCleanAnime.includes(favCleanAnime)) {
          similarityBoost += 12;
        }

        // Eras similarity: Boost if same era
        const favEra = getAnimeEraAndYear(fav.animeName).eraId;
        if (favEra === trackEra) {
          similarityBoost += 5;
        }

        // Tag overlaps
        const favTags = fav.tags || [];
        // Only run filter if there are actually tags on both
        if (favTags.length > 0 && trackTags.length > 0) {
           let overlapCount = 0;
           for (const t of favTags) {
              if (trackTags.includes(t)) overlapCount++;
           }
           similarityBoost += overlapCount * 4;
        }
      });

      // Average the similarity boost to keep it normalized
      score += Math.min(45, similarityBoost);
    }
  }

  // 3. Proximity to Favorite's ELO (allows low ELO recommendations if user likes low ELO tracks)
  let finalFavTracks = cachedFavTracks;
  if (!finalFavTracks && allTracks.length > 0) {
    finalFavTracks = (user.favoriteTrackIds || [])
      .map(id => allTracks.find(t => t.id === id))
      .filter(Boolean) as AnimeTrack[];
  }

  if (finalFavTracks && finalFavTracks.length > 0) {
    const avgFavElo = finalFavTracks.reduce((sum, f) => sum + f.elo, 0) / finalFavTracks.length;
    const eloDifference = Math.abs(track.elo - avgFavElo);
    // Give a bonus if the track's ELO is close to the average ELO of their favorites
    const eloBonus = Math.max(0, 15 - (eloDifference / 40)); 
    score += eloBonus;
  } else {
    // Fallback: Add small factor for organic track popularity (so quality tracks bubble up generally if no favs)
    score += (track.elo / 500);
  }

  return score;
}

/**
 * Returns a list of customizable recommended playlists based on the user's specific mood parameters.
 */
export function getRecommendedPlaylistsForUser(
  user: UserAccount | null,
  allTracks: AnimeTrack[]
): {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
}[] {
  if (!allTracks || allTracks.length === 0) return [];

  const username = user?.username || 'User';
  const hasFavorites = user?.favoriteTrackIds && user.favoriteTrackIds.length > 0;

  // Precompute favTracks for O(1) performance during scoring
  const trackMap = new Map(allTracks.map(t => [t.id, t]));
  const favTracks = (user?.favoriteTrackIds || [])
    .map(id => trackMap.get(id))
    .filter(Boolean) as AnimeTrack[];

  // Score all tracks for user
  const scoredTracks = [...allTracks].map(track => ({
    track,
    score: calculateTrackScore(track, user, allTracks, favTracks)
  }));

  // Exclude favorites from lists to keep recommendations fresh & discovery-oriented
  const favIds = user?.favoriteTrackIds || [];
  const discoveryPool = scoredTracks.filter(item => !favIds.includes(item.track.id));

  // Precompute track vibes to prevent excessive calculations during multiple sorts
  const precomputedVibes = new Map();
  discoveryPool.forEach(item => {
    precomputedVibes.set(item.track.id, getTrackVibeProfile(item.track));
  });

  // Sort general pool by recommendation score
  const sortedDiscovery = [...discoveryPool].sort((a, b) => b.score - a.score);

  // Playlist 1: Smart Match Algorithm Core
  const smartCoreTracks = sortedDiscovery.slice(0, 5).map(item => item.track.id);

  // Playlist 2: High Energy & Vocal Intensity (Hype workout)
  const hypeSorted = [...discoveryPool]
    .sort((a, b) => {
      const vibeA = precomputedVibes.get(a.track.id);
      const vibeB = precomputedVibes.get(b.track.id);
      const scoreA = (vibeA?.hype || 0) * 1.5 + (vibeA?.vocalIntensity || 0) * 1.0;
      const scoreB = (vibeB?.hype || 0) * 1.5 + (vibeB?.vocalIntensity || 0) * 1.0;
      return scoreB - scoreA;
    })
    .slice(0, 5)
    .map(item => item.track.id);

  // Playlist 3: Melancholic Endings & Deep Atmospheric
  const atmosphericSorted = [...discoveryPool]
    .sort((a, b) => {
      const vibeA = precomputedVibes.get(a.track.id);
      const vibeB = precomputedVibes.get(b.track.id);
      const scoreA = (vibeA?.atmospheric || 0) * 1.5 + (vibeA?.nostalgia || 0) * 1.0;
      const scoreB = (vibeB?.atmospheric || 0) * 1.5 + (vibeB?.nostalgia || 0) * 1.0;
      return scoreB - scoreA;
    })
    .slice(0, 5)
    .map(item => item.track.id);

  // Playlist 4: Symphonic Orchestrals & Cinematic
  const symphonicSorted = [...discoveryPool]
    .sort((a, b) => {
      const vibeA = precomputedVibes.get(a.track.id);
      const vibeB = precomputedVibes.get(b.track.id);
      const scoreA = (vibeA?.symphonic || 0) * 1.6 + (vibeA?.atmospheric || 0) * 0.8;
      const scoreB = (vibeB?.symphonic || 0) * 1.6 + (vibeB?.atmospheric || 0) * 0.8;
      return scoreB - scoreA;
    })
    .slice(0, 5)
    .map(item => item.track.id);

  // Playlist 5: Retro Legends & CRT Nostalgia
  const nostalgiaSorted = [...discoveryPool]
    .sort((a, b) => {
      const vibeA = precomputedVibes.get(a.track.id);
      const vibeB = precomputedVibes.get(b.track.id);
      const scoreA = (vibeA?.nostalgia || 0) * 1.8 + (vibeA?.symphonic || 0) * 0.6;
      const scoreB = (vibeB?.nostalgia || 0) * 1.8 + (vibeB?.symphonic || 0) * 0.6;
      return scoreB - scoreA;
    })
    .slice(0, 5)
    .map(item => item.track.id);

  const lists = [];

  // Always offer a personalized recommendation master playlist!
  lists.push({
    id: 'list_personal_rec',
    name: `Neural Synapse: ${username}'s Core Match`,
    description: `Dynamic real-time algorithmically curated list mirroring your favorite artists and active vibe spectrum (${user?.vibeSpectrum ? 'Custom Calibration' : 'Standard'}).`,
    trackIds: smartCoreTracks.length > 0 ? smartCoreTracks : allTracks.slice(0, 5).map(t => t.id)
  });

  lists.push({
    id: 'list_hype_workout',
    name: `High-Octane: ${username}'s Peak Hype`,
    description: `Action-driven high-BPM themes selected for maximum neural activation and workout intensity.`,
    trackIds: hypeSorted.length > 0 ? hypeSorted : allTracks.filter(t => t.type === 'OP').slice(0, 5).map(t => t.id)
  });

  lists.push({
    id: 'list_deep_chill',
    name: `Abyssal Chill: ${username}'s Soothing Waves`,
    description: `Melancholic masterpieces and comforting resolutions for Late Night unwinding.`,
    trackIds: atmosphericSorted.length > 0 ? atmosphericSorted : allTracks.filter(t => t.type === 'ED').slice(0, 5).map(t => t.id)
  });

  lists.push({
    id: 'list_epic_orchestras',
    name: `Orchestral Grid: ${username}'s Symphonetics`,
    description: `Enormous cinematic background elements and acoustic masterpieces.`,
    trackIds: symphonicSorted.length > 0 ? symphonicSorted : allTracks.filter(t => t.type === 'OST').slice(0, 5).map(t => t.id)
  });

  lists.push({
    id: 'list_retro_legends_dynamic',
    name: `CRT Relics: ${username}'s Nostalgia Trip`,
    description: `Hand-drawn cell vibes, heavy analog synths, and retro masterpieces.`,
    trackIds: nostalgiaSorted.length > 0 ? nostalgiaSorted : allTracks.slice(5, 10).map(t => t.id)
  });

  return lists;
}

/**
 * Calculates a 0-100% compatibility rating between two user accounts based on their vibe spectrum weights and favorite tracks.
 */
export function calculateUserCompatibility(
  userA: UserAccount,
  userB: UserAccount
): number {
  if (!userA || !userB) return 50;
  
  const defaultSpectrum = {
    nostalgia: 50,
    hype: 50,
    atmospheric: 50,
    symphonic: 50,
    vocalIntensity: 50
  };

  const specA = userA.vibeSpectrum || defaultSpectrum;
  const specB = userB.vibeSpectrum || defaultSpectrum;

  // 1. Calculate average absolute difference in vibe spectrum parameters
  let totalDelta = 0;
  const metrics: (keyof VibeProfile)[] = ['nostalgia', 'hype', 'atmospheric', 'symphonic', 'vocalIntensity'];
  metrics.forEach(metric => {
    const valA = specA[metric] ?? 50;
    const valB = specB[metric] ?? 50;
    totalDelta += Math.abs(valA - valB);
  });

  // Calculate similarity based on the divergence (max difference is 100 per metric)
  const maxPossibleDelta = metrics.length * 100;
  const vibeSimilarityPercent = 100 - (totalDelta / maxPossibleDelta) * 100;

  // 2. Calculate overlap in favorite tracks
  const favsA = userA.favoriteTrackIds || [];
  const favsB = userB.favoriteTrackIds || [];

  let favMultiplierBoost = 0;
  if (favsA.length > 0 && favsB.length > 0) {
    const commonTracksCount = favsA.filter(id => favsB.includes(id)).length;
    // Calculate Jaccard similarity or standard overlay proportion
    const totalUniqueCount = new Set([...favsA, ...favsB]).size;
    if (totalUniqueCount > 0) {
      favMultiplierBoost = (commonTracksCount / totalUniqueCount) * 100;
    }
  }

  // Double-weighted vibe similarity (70% weight) + favorite list overlay (30% weight)
  const weightedResult = vibeSimilarityPercent * 0.70 + favMultiplierBoost * 0.30;
  
  // Return rounded integer bound between 0 and 100
  return Math.round(Math.min(100, Math.max(0, weightedResult)));
}

