/**
 * Multi-source tagging system for anime tracks.
 *
 * Generates rich, meaningful tags by combining:
 *   1. Anime genres (from Jikan/MAL) — Action, Romance, Comedy, etc.
 *   2. Anime demographics — Shounen, Shoujo, Seinen, Josei
 *   3. Era tags (by year) — 90s, 2000s, 2010s, 2020s
 *   4. Track type — OP, ED, OST
 *   5. Audio/mood tags (from title keyword analysis)
 *
 * This replaces the old system where every track got hardcoded ["Hype"].
 */

export interface AnimeMetadata {
  mal_id?: number;
  title: string;
  genres?: string[];
  demographics?: string[];
  year?: number;
  studios?: string[];
}

// ---------------------------------------------------------------------------
// Tag vocabulary — organized by category. Used for the arena tag filter.
// ---------------------------------------------------------------------------

export const TAG_CATEGORIES = {
  type: ['OP', 'ED', 'OST'],
  genre: [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror',
    'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
    'Sports', 'Supernatural', 'Suspense', 'Award Winning', 'Avant Garde',
    'Boys Love', 'Girls Love', 'Gourmet', 'Erotica', 'Hentai',
  ],
  demographic: ['Shounen', 'Shoujo', 'Seinen', 'Josei', 'Kids'],
  era: ['90s', '2000s', '2010s', '2020s', 'Pre-90s'],
  studio: [
    'Studio Ghibli', 'MAPPA', 'Ufotable', 'Bones', 'Wit Studio',
    'Kyoto Animation', 'A-1 Pictures', 'Madhouse', 'Sunrise',
    'Toei Animation', 'Production I.G', 'Shaft', 'Trigger', 'CloverWorks',
  ],
  mood: [
    'Hype', 'Epic', 'Emotional', 'Chill', 'Nostalgic', 'Intense',
    'Sad', 'Romantic', 'Dark', 'Uplifting', 'Melancholic', 'Energetic',
  ],
} as const;

// All valid tags (flattened) for quick lookup
export const ALL_VALID_TAGS = new Set<string>(
  Object.values(TAG_CATEGORIES).flat()
);

// ---------------------------------------------------------------------------
// Fetch anime metadata (genres, year, demographics) from Jikan.
// Cached in-memory for 1 hour to avoid hitting the API repeatedly.
// ---------------------------------------------------------------------------

const metaCache = new Map<string, { data: AnimeMetadata | null; expires: number }>();
const META_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchAnimeMetadata(
  animeName: string,
  malId?: number
): Promise<AnimeMetadata | null> {
  const cacheKey = `${animeName.toLowerCase().trim()}_${malId || 'noid'}`;
  const cached = metaCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    let url: string;
    if (malId) {
      url = `https://api.jikan.moe/v4/anime/${malId}/full`;
    } else {
      url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeName)}&limit=1`;
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
    });

    if (res.status === 429) {
      // Rate limited — wait and retry once
      await new Promise(r => setTimeout(r, 1500));
      const retry = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      });
      if (!retry.ok) {
        metaCache.set(cacheKey, { data: null, expires: Date.now() + META_CACHE_TTL });
        return null;
      }
      const json = await retry.json();
      return parseJikanMeta(json?.data, animeName);
    }

    if (!res.ok) {
      metaCache.set(cacheKey, { data: null, expires: Date.now() + META_CACHE_TTL });
      return null;
    }

    const json = await res.json();
    const meta = parseJikanMeta(json?.data, animeName);
    metaCache.set(cacheKey, { data: meta, expires: Date.now() + META_CACHE_TTL });
    return meta;
  } catch {
    metaCache.set(cacheKey, { data: null, expires: Date.now() + META_CACHE_TTL });
    return null;
  }
}

function parseJikanMeta(data: any, fallbackName: string): AnimeMetadata | null {
  if (!data) return null;
  return {
    mal_id: data.mal_id,
    title: data.title || fallbackName,
    genres: Array.isArray(data.genres)
      ? data.genres.map((g: any) => g.name).filter(Boolean)
      : [],
    demographics: Array.isArray(data.demographics)
      ? data.demographics.map((d: any) => d.name).filter(Boolean)
      : [],
    year: data.year || data.aired?.from ? new Date(data.aired.from).getFullYear() : undefined,
    studios: Array.isArray(data.studios)
      ? data.studios.map((s: any) => s.name).filter(Boolean)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Generate tags for a track using all available data.
// ---------------------------------------------------------------------------

export function generateTrackTags(
  track: { title: string; animeName: string; type: string },
  meta: AnimeMetadata | null
): string[] {
  const tags = new Set<string>();

  // 1. Track type tag
  if (track.type === 'OP') tags.add('OP');
  else if (track.type === 'ED') tags.add('ED');
  else if (track.type === 'OST') tags.add('OST');

  if (meta) {
    // 2. Genre tags (from Jikan)
    if (meta.genres) {
      for (const genre of meta.genres) {
        if (TAG_CATEGORIES.genre.includes(genre as any)) {
          tags.add(genre);
        }
      }
    }

    // 3. Demographic tags
    if (meta.demographics) {
      for (const demo of meta.demographics) {
        if (TAG_CATEGORIES.demographic.includes(demo as any)) {
          tags.add(demo);
        }
      }
    }

    // 4. Era tag (by year)
    if (meta.year) {
      const year = meta.year;
      if (year < 1990) tags.add('Pre-90s');
      else if (year < 2000) tags.add('90s');
      else if (year < 2010) tags.add('2000s');
      else if (year < 2020) tags.add('2010s');
      else tags.add('2020s');
    }

    // 5. Studio tag
    if (meta.studios && meta.studios.length > 0) {
      const studio = meta.studios[0];
      if (TAG_CATEGORIES.studio.includes(studio as any)) {
        tags.add(studio);
      }
    }
  }

  // 6. Mood tags (from title keyword analysis — lightweight, no API needed)
  const combined = `${track.title} ${track.animeName}`.toLowerCase();
  if (combined.includes('hikari') || combined.includes('light') || combined.includes('hero')) {
    tags.add('Uplifting');
  }
  if (combined.includes('kanashimi') || combined.includes('sad') || combined.includes('tears') || combined.includes('namida')) {
    tags.add('Sad');
    tags.add('Emotional');
  }
  if (combined.includes('tatakai') || combined.includes('battle') || combined.includes('fight') || combined.includes('war')) {
    tags.add('Epic');
    tags.add('Intense');
  }
  if (combined.includes('love') || combined.includes('ai') || combined.includes('koi') || combined.includes('romance')) {
    tags.add('Romantic');
  }
  if (combined.includes('yume') || combined.includes('dream')) {
    tags.add('Nostalgic');
  }

  // 7. Default tag if nothing was found
  if (tags.size === 0) {
    tags.add('Hype');
  }

  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Batch tag generation — fetches metadata for a list of anime, then
// generates tags for each track. Used by bulk import.
// ---------------------------------------------------------------------------

export async function generateTagsForTracks(
  tracks: Array<{ title: string; animeName: string; type: string; mal_id?: number }>
): Promise<string[][]> {
  // Deduplicate anime names to minimize API calls
  const animeToFetch = new Map<string, { name: string; mal_id?: number }>();
  for (const t of tracks) {
    const key = t.animeName.toLowerCase().trim();
    if (!animeToFetch.has(key)) {
      animeToFetch.set(key, { name: t.animeName, mal_id: t.mal_id });
    }
  }

  // Fetch metadata for each unique anime (with rate limiting)
  const metaMap = new Map<string, AnimeMetadata | null>();
  for (const [key, info] of animeToFetch) {
    const meta = await fetchAnimeMetadata(info.name, info.mal_id);
    metaMap.set(key, meta);
    // Rate limit: Jikan allows 3 req/sec, so wait 400ms between calls
    await new Promise(r => setTimeout(r, 400));
  }

  // Generate tags for each track
  return tracks.map(t => {
    const key = t.animeName.toLowerCase().trim();
    const meta = metaMap.get(key) || null;
    return generateTrackTags(t, meta);
  });
}
