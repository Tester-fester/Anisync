/**
 * LRCLIB client — free, open, no-auth lyrics database.
 * Returns synced (LRC, timed) + plain lyrics. The canonical replacement
 * for the /api/lyrics stub.
 *
 * Docs: https://lrclib.net/docs
 */

const LRCLIB_BASE = 'https://lrclib.net/api';

export interface LrcLibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/**
 * Get lyrics for a track. Tries exact match first, then fuzzy by artist+title.
 * Returns the best match (preferring synced over plain).
 */
export async function getLyrics(opts: {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number; // seconds — helps disambiguate
}): Promise<LrcLibResult | null> {
  const { trackName, artistName, albumName, duration } = opts;
  if (!trackName || !artistName) return null;

  // 1. Try exact-match endpoint (most accurate when duration is known).
  const exactParams = new URLSearchParams({
    track_name: trackName,
    artist_name: artistName,
  });
  if (albumName) exactParams.set('album_name', albumName);
  if (duration && duration > 0) exactParams.set('duration', String(Math.round(duration)));

  try {
    const res = await fetch(`${LRCLIB_BASE}/get?${exactParams}`, {
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as LrcLibResult;
      if (data && (data.plainLyrics || data.syncedLyrics)) return data;
    }
    // 404 = no exact match — fall through to search.
    if (res.status !== 404) {
      console.warn(`[LRCLIB] get failed: ${res.status}`);
    }
  } catch (err: any) {
    console.warn('[LRCLIB] get error:', err.message);
  }

  // 2. Fallback to search endpoint — pick the best candidate.
  try {
    const searchParams = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    });
    const res = await fetch(`${LRCLIB_BASE}/search?${searchParams}`, {
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const results = (await res.json()) as LrcLibResult[];
    if (!Array.isArray(results) || results.length === 0) return null;

    // Prefer entries with synced lyrics; if duration given, prefer closest match.
    const withLyrics = results.filter(r => r.syncedLyrics || r.plainLyrics);
    if (withLyrics.length === 0) return null;

    const scored = withLyrics.map(r => {
      let score = 0;
      if (r.syncedLyrics) score += 100;
      if (duration && r.duration) {
        const diff = Math.abs(r.duration - duration);
        score += Math.max(0, 50 - diff); // closer = higher
      }
      if (albumName && r.albumName && r.albumName.toLowerCase().includes(albumName.toLowerCase())) {
        score += 25;
      }
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].r;
  } catch (err: any) {
    console.warn('[LRCLIB] search error:', err.message);
    return null;
  }
}

/**
 * Parse an LRC string into an array of { time, text } entries.
 * Returns [] if the lyrics are plain (untimed).
 *
 * LRC format: [mm:ss.xx] lyric line
 */
export function parseLrc(lrc: string | null): Array<{ time: number; text: string }> {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const out: Array<{ time: number; text: string }> = [];
  const timeRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const line of lines) {
    const matches = [...line.matchAll(timeRe)];
    if (matches.length === 0) continue;
    const text = line.replace(timeRe, '').trim();
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracStr = m[3] || '0';
      const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
      const time = min * 60 + sec + frac;
      out.push({ time, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
