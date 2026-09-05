/**
 * AnimeThemes API client — the canonical anime theme music database.
 * Purpose-built for this app: anime ↔ theme (OP/ED/IN) ↔ song ↔ artist
 * ↔ audio/video (WebM).
 *
 * Docs: https://api-docs.animethemes.moe
 * No auth required. Be polite (~1 req/sec).
 */

const AT_BASE = 'https://api.animethemes.moe';

export interface AnimeThemeEntry {
  id: number;
  slug: string;       // "OP1", "ED2", "IN1"
  type: 'OP' | 'ED' | 'IN';
  song?: {
    id: number;
    title: string;
    artists?: Array<{ name: string; as?: string }>;
  };
  anime?: {
    id: number;
    name: string;
    slug: string;
    year?: number;
    season?: string;
  };
  entries?: Array<{
    id: number;
    episode?: string;
    videos?: Array<{
      id: number;
      link: string;        // webm/mp4
      lyrics?: string;     // sometimes present
      resolution?: number;
      nc?: boolean;        // non-credit?
      subbed?: boolean;
      uncen?: boolean;
    }>;
  }>;
}

export interface AnimeThemeSearchResult {
  anime: {
    id: number;
    name: string;
    slug: string;
    year?: number;
    season?: string;
  };
  themes: AnimeThemeEntry[];
}

/**
 * Search anime themes by anime name. Returns themes + songs + videos.
 *
 * Uses the /anime endpoint (NOT /search — /search returns 422 when include
 * is passed as a comma-separated string via URLSearchParams; it requires
 * include[] as repeated params which URLSearchParams doesn't generate).
 * The /anime endpoint accepts comma-separated include + fields params fine.
 */
export async function searchThemesByAnime(animeName: string, limit = 5): Promise<AnimeThemeSearchResult[]> {
  if (!animeName) return [];
  const params = new URLSearchParams({
    'q': animeName,
    'limit': String(limit),
    'include': 'animethemes,animethemes.song,animethemes.song.artists',
  });
  try {
    const res = await fetch(`${AT_BASE}/anime?${params}`, {
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[AnimeThemes] search failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { anime?: any[] };
    if (!data.anime || data.anime.length === 0) return [];

    // Map to the AnimeThemeSearchResult shape
    return data.anime.map((a: any) => ({
      anime: {
        id: a.id,
        name: a.name,
        slug: a.slug,
        year: a.year,
        season: a.season,
      },
      themes: (a.animethemes || []).map((t: any) => ({
        id: t.id,
        slug: t.slug,
        type: t.type,
        song: t.song ? {
          id: t.song.id,
          title: t.song.title,
          artists: (t.song.artists || []).map((art: any) => ({ name: art.name, as: art.as })),
        } : undefined,
      })),
    }));
  } catch (err: any) {
    console.warn('[AnimeThemes] search error:', err.message);
    return [];
  }
}

/**
 * Get themes for a specific anime by slug. More precise than search.
 */
export async function getThemesByAnimeSlug(slug: string): Promise<AnimeThemeEntry[]> {
  if (!slug) return [];
  const params = new URLSearchParams({
    'include': 'animethemes,animethemes.song,animethemes.song.artists',
  });
  try {
    const res = await fetch(`${AT_BASE}/anime/${encodeURIComponent(slug)}?${params}`, {
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { anime?: { animethemes?: any[] } };
    // The API returns 'animethemes' (not 'themes') when using the include param
    const themes = data.anime?.animethemes || [];
    return themes as AnimeThemeEntry[];
  } catch (err: any) {
    console.warn('[AnimeThemes] by-slug error:', err.message);
    return [];
  }
}

/**
 * Flatten AnimeThemes search results into track-shaped objects matching
 * ANISYNC's AnimeTrack interface (minus the ELO fields).
 */
export interface FlatThemeTrack {
  title: string;
  artist: string;
  animeName: string;
  type: 'OP' | 'ED' | 'OST';
  themeType: string;       // "OP1", "ED2", "IN1"
  videoLink?: string;      // direct WebM/MP4 link
  animeSlug?: string;
  animeYear?: number;
  source: 'animethemes';
}

export function flattenThemeResults(results: AnimeThemeSearchResult[]): FlatThemeTrack[] {
  const out: FlatThemeTrack[] = [];
  for (const r of results) {
    const animeName = r.anime.name;
    const animeSlug = r.anime.slug;
    const animeYear = r.anime.year;
    for (const theme of r.themes || []) {
      // AnimeThemes uses "IN" for insert songs; map to OST for ANISYNC's type union.
      const type: 'OP' | 'ED' | 'OST' = theme.type === 'OP' ? 'OP' : theme.type === 'ED' ? 'ED' : 'OST';
      const song = theme.song;
      const artists = (song?.artists || []).map(a => a.as || a.name).join(', ');
      const video = theme.entries?.[0]?.videos?.[0];
      out.push({
        title: song?.title || `${animeName} ${theme.slug}`,
        artist: artists || 'Unknown Artist',
        animeName,
        type,
        themeType: theme.slug,
        videoLink: video?.link,
        animeSlug,
        animeYear,
        source: 'animethemes',
      });
    }
  }
  return out;
}
