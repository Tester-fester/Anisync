/**
 * Last.fm API client — free, API key required.
 * Best source for artist tags + "similar artists" graph (taste analysis).
 *
 * Get a free API key: https://www.last.fm/api/account/create
 * Set LASTFM_API_KEY in your .env
 *
 * Docs: https://www.last.fm/api
 */

const LF_BASE = 'https://ws.audioscrobbler.com/2.0';

function apiKey(): string {
  return process.env.LASTFM_API_KEY || '';
}

async function lfCall<T>(method: string, params: Record<string, string>): Promise<T | null> {
  const key = apiKey();
  if (!key) {
    if (typeof console !== 'undefined') {
      console.warn('[Last.fm] LASTFM_API_KEY not set — skipping call');
    }
    return null;
  }
  const allParams = {
    method,
    api_key: key,
    format: 'json',
    ...params,
  };
  const qs = new URLSearchParams(allParams).toString();
  try {
    const res = await fetch(`${LF_BASE}/?${qs}`, {
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) {
      console.warn('[Last.fm] rate-limited (429)');
      return null;
    }
    if (!res.ok) {
      console.warn(`[Last.fm] ${method} failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as T & { error?: number; message?: string };
    if (data.error) {
      console.warn(`[Last.fm] ${method} error:`, data.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn('[Last.fm] fetch error:', err.message);
    return null;
  }
}

export interface LastFmArtist {
  name: string;
  mbid?: string;
  url?: string;
  image?: Array<{ '#text': string; size: string }>;
  listeners?: number;
  playcount?: number;
  bio?: {
    summary?: string;
    content?: string;
    published?: string;
  };
  tags?: {
    tag: Array<{ name: string; url: string }>;
  };
  similar?: {
    artist: Array<{ name: string; url: string; image?: Array<{ '#text': string }> }>;
  };
}

/**
 * Get artist info — bio, tags, similar artists, image.
 * Powers the Wiki "artist" page enrichment + Gemini taste analyzer.
 */
export async function getArtistInfo(artistName: string): Promise<LastFmArtist | null> {
  if (!artistName) return null;
  const data = await lfCall<{ artist: LastFmArtist }>('artist.getinfo', {
    artist: artistName,
    autocorrect: '1',
  });
  return data?.artist || null;
}

/**
 * Get similar artists — powers the taste-analysis "similar artists" radar.
 */
export async function getSimilarArtists(artistName: string, limit = 8): Promise<Array<{ name: string; url?: string; image?: string }>> {
  if (!artistName) return [];
  const data = await lfCall<{ similarartists?: { artist: any[] } }>('artist.getsimilar', {
    artist: artistName,
    limit: String(limit),
    autocorrect: '1',
  });
  if (!data?.similarartists?.artist) return [];
  return data.similarartists.artist.map(a => ({
    name: a.name,
    url: a.url,
    image: a.image?.find((i: any) => i.size === 'large')?.['#text'],
  }));
}

/**
 * Get top tags for an artist — powers the vibe spectrum (genre tags).
 */
export async function getArtistTopTags(artistName: string): Promise<string[]> {
  if (!artistName) return [];
  const data = await lfCall<{ toptags?: { tag: any[] | { name: string; url: string } } }>('artist.gettoptags', {
    artist: artistName,
    autocorrect: '1',
  });
  if (!data?.toptags) return [];
  const tagObj = data.toptags.tag;
  if (!tagObj) return [];
  const tags = Array.isArray(tagObj) ? tagObj : [tagObj];
  return tags.map(t => t.name).filter(Boolean);
}

/**
 * Get top tracks for an artist — useful for the Wiki "artist" page.
 */
export async function getArtistTopTracks(artistName: string, limit = 10): Promise<Array<{ name: string; listeners?: number; playcount?: number }>> {
  if (!artistName) return [];
  const data = await lfCall<{ toptracks?: { track: any[] } }>('artist.gettoptracks', {
    artist: artistName,
    limit: String(limit),
    autocorrect: '1',
  });
  if (!data?.toptracks?.track) return [];
  return data.toptracks.track.map(t => ({
    name: t.name,
    listeners: parseInt(t.listeners, 10) || 0,
    playcount: parseInt(t.playcount, 10) || 0,
  }));
}
