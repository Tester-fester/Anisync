/**
 * MusicBrainz + Cover Art Archive client.
 *
 * MusicBrainz is the canonical open-metadata database for music — releases,
 * recordings, ISRC/ISWC codes, artists. CC0-licensed data.
 * Cover Art Archive is its companion album-art service.
 *
 * Rate limit: 1 req/sec per IP (strict). Must set a descriptive User-Agent
 * with contact info or get banned. This client enforces the throttle.
 *
 * Docs:
 *  - https://musicbrainz.org/doc/MusicBrainz_API
 *  - https://coverartarchive.org
 */

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';

// Enforce MusicBrainz's 1 req/sec rate limit.
let lastMbCallAt = 0;
const MB_MIN_INTERVAL_MS = 1100; // 1.1s — small buffer

async function mbThrottle(): Promise<void> {
  const now = Date.now();
  const wait = MB_MIN_INTERVAL_MS - (now - lastMbCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastMbCallAt = Date.now();
}

async function mbFetch<T>(path: string): Promise<T | null> {
  await mbThrottle();
  try {
    const res = await fetch(`${MB_BASE}${path}`, {
      headers: {
        'User-Agent': 'ANISYNC/1.0 ( anisync.app / contact@anisync.app )',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 503) {
      console.warn('[MusicBrainz] rate-limited (503) — backing off 3s');
      await new Promise(r => setTimeout(r, 3000));
      return null;
    }
    if (!res.ok) {
      console.warn(`[MusicBrainz] ${path} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    console.warn('[MusicBrainz] fetch error:', err.message);
    return null;
  }
}

export interface MbRecording {
  id: string;
  title: string;
  length?: number;       // ms
  isrc?: string;
  artist?: string;
  releases?: Array<{
    id: string;
    title: string;
    date?: string;
    status?: string;
    country?: string;
  }>;
}

/**
 * Search recordings by title + artist. Useful for finding ISRC codes
 * for cross-source dedup with iTunes/VGMdb.
 */
export async function searchRecordings(title: string, artist?: string, limit = 10): Promise<MbRecording[]> {
  if (!title) return [];
  const parts = [`recording:"${title}"`];
  if (artist) parts.push(`artist:"${artist}"`);
  const query = parts.join(' AND ');
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fmt: 'json',
    inc: 'releases',
  });
  const data = await mbFetch<{ recordings?: any[] }>(`/recording?${params}`);
  if (!data?.recordings) return [];
  return data.recordings.map((r: any) => ({
    id: r.id,
    title: r.title,
    length: r.length,
    isrc: r.isrc?.[0],
    artist: r['artist-credit']?.[0]?.name,
    releases: (r.releases || []).map((rel: any) => ({
      id: rel.id,
      title: rel.title,
      date: rel.date,
      status: rel.status,
      country: rel.country,
    })),
  }));
}

export interface MbRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  barcode?: string;        // UPC — key for dedup against iTunes/VGMdb
  catalogNumber?: string;
  format?: string;
  trackCount?: number;
  artist?: string;
}

/**
 * Search releases (albums) by title + artist. Returns catalog numbers + barcodes.
 */
export async function searchReleases(title: string, artist?: string, limit = 10): Promise<MbRelease[]> {
  if (!title) return [];
  const parts = [`release:"${title}"`];
  if (artist) parts.push(`artist:"${artist}"`);
  const query = parts.join(' AND ');
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fmt: 'json',
  });
  const data = await mbFetch<{ releases?: any[] }>(`/release?${params}`);
  if (!data?.releases) return [];
  return data.releases.map((r: any) => ({
    id: r.id,
    title: r.title,
    date: r.date,
    country: r.country,
    status: r.status,
    barcode: r.barcode,
    catalogNumber: r['label-info']?.[0]?.['catalog-number'],
    format: r.media?.[0]?.format,
    trackCount: r.media?.[0]?.['track-count'],
    artist: r['artist-credit']?.[0]?.name,
  }));
}

/**
 * Get cover art for a MusicBrainz release by MBID.
 * Returns the front-cover URL at the largest available resolution.
 */
export async function getReleaseCoverArt(mbid: string): Promise<string | null> {
  if (!mbid) return null;
  try {
    const res = await fetch(`${CAA_BASE}/release/${mbid}`, {
      headers: {
        'User-Agent': 'ANISYNC/1.0 ( anisync.app / contact@anisync.app )',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { images?: Array<{ image?: string; thumbnails?: { large?: string } }> };
    const front = data.images?.find(i => (i as any).front === true) || data.images?.[0];
    return front?.image || front?.thumbnails?.large || null;
  } catch {
    return null;
  }
}

/**
 * Get cover art for a MusicBrainz release-group by MBID (covers more cases
 * — release groups aggregate all editions of an album).
 */
export async function getReleaseGroupCoverArt(mbid: string): Promise<string | null> {
  if (!mbid) return null;
  try {
    const res = await fetch(`${CAA_BASE}/release-group/${mbid}`, {
      headers: {
        'User-Agent': 'ANISYNC/1.0 ( anisync.app / contact@anisync.app )',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { images?: Array<{ image?: string }> };
    return data.images?.[0]?.image || null;
  } catch {
    return null;
  }
}

/**
 * Combined helper: search releases + fetch cover art for the top hit.
 * Used by the admin "resolve track images" feature as a fallback when
 * iTunes lacks the cover (common for niche anime OSTs).
 */
export async function findCoverArt(title: string, artist?: string): Promise<string | null> {
  const releases = await searchReleases(title, artist, 3);
  for (const rel of releases) {
    const url = await getReleaseCoverArt(rel.id);
    if (url) return url;
  }
  return null;
}
