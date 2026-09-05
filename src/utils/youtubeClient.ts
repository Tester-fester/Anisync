/**
 * Consolidated YouTube client — wraps `youtubei.js` (the InnerTube client)
 * with graceful fallback to `yt-search` for resilience.
 *
 * Why youtubei.js:
 *  - Only one of the 5 YouTube libs that does search + playlist + metadata.
 *  - Most actively maintained (ytjs.dev docs updated May 2026).
 *  - Returns rich metadata (duration, view count, channel).
 *
 * Why keep yt-search as fallback:
 *  - youtubei.js wraps YouTube's private InnerTube API, which YouTube changes
 *    every few weeks. When that happens, yt-search's HTML-scrape approach
 *    is more stable for the narrow use case of "search + return top results."
 *  - One day of InnerTube breakage is preferable to a broken app.
 *
 * Old libs DROPPED from package.json:
 *  - youtube-ext (stalest — last published May 2024)
 *  - yt-search (kept ONLY as fallback — see note above; NOT removed yet)
 *  - ytpl (subsumed by youtubei.js getPlaylist)
 *
 * This wrapper exposes THREE operations matching the old code:
 *   1. searchVideos(query)        — used by /api/youtube-search, resolveYoutubeId
 *   2. getPlaylistVideos(listId)  — used by /api/youtube-playlist-fetch
 *   3. getVideoMetadata(id)       — used by various admin endpoints
 *
 * The returned shape is intentionally compatible with the old yt-search
 * shape so call sites don't need changes: { videoId, title, author, duration }
 */

export interface YouTubeVideo {
  videoId: string;
  title: string;
  author: string;
  duration: string;        // "3:45" or "N/A"
  durationSec?: number;
  viewCount?: number;
  thumbnail?: string;
}

export interface YouTubePlaylist {
  listId: string;
  title: string;
  author: string;
  videoCount: number;
  thumbnail?: string;
}

// Lazily-imported so unused libs don't bloat the browser bundle.
// (server-side only — never imported from client code)
let _yti: any = null;
async function getYti(): Promise<any> {
  if (_yti) return _yti;
  try {
    const mod: any = await import('youtubei.js');
    // youtubei.js default export pattern — class is `Innertube`
    _yti = mod.Innertube || mod.default?.Innertube || mod.default;
    return _yti;
  } catch {
    return null;
  }
}

let _yts: any = null;
async function getYts() {
  if (_yts) return _yts;
  try {
    _yts = (await import('yt-search')).default;
    return _yts;
  } catch {
    return null;
  }
}

/**
 * Format seconds → "m:ss" or "h:mm:ss"
 */
function formatDuration(sec: number | undefined | null): string {
  if (!sec || sec <= 0) return 'N/A';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Search YouTube videos by query. Returns up to `limit` results.
 *
 * Tries youtubei.js first; if it throws, falls back to yt-search.
 */
export async function searchVideos(query: string, limit = 30): Promise<{ videos: YouTubeVideo[]; playlists: YouTubePlaylist[] }> {
  if (!query) return { videos: [], playlists: [] };

  // --- Try youtubei.js first ---
  try {
    const Innertube = await getYti();
    if (Innertube) {
      const yt = await Innertube.create();
      const search = await yt.search(query);

      const videos: YouTubeVideo[] = [];
      const playlists: YouTubePlaylist[] = [];

      // youtubei.js returns a SearchFeed — iterate over its .videos / .playlists
      // (API shape varies slightly across versions, so be defensive.)
      const searchVideos = (search as any).videos || (search as any).results || [];
      for (const v of searchVideos) {
        if (videos.length >= limit) break;
        try {
          const id = v?.id || v?.videoId;
          const title = v?.title?.text || v?.title || '';
          const author = v?.author?.name || v?.author?.text || v?.author || '';
          const durationSec = v?.duration?.seconds || v?.length_seconds;
          const viewCount = v?.view_count?.text ? parseInt(String(v.view_count.text).replace(/[^0-9]/g, '')) : undefined;
          const thumbnail = v?.thumbnails?.[0]?.url || v?.best_thumbnail?.url;
          if (id && title) {
            videos.push({
              videoId: id,
              title,
              author,
              duration: typeof durationSec === 'number' ? formatDuration(durationSec) : (v?.duration?.text || 'N/A'),
              durationSec: typeof durationSec === 'number' ? durationSec : undefined,
              viewCount,
              thumbnail,
            });
          }
        } catch {}
      }

      const searchPlaylists = (search as any).playlists || [];
      for (const p of searchPlaylists) {
        if (playlists.length >= 10) break;
        try {
          const id = p?.id || p?.playlistId;
          const title = p?.title?.text || p?.title || '';
          const author = p?.author?.name || p?.author?.text || 'YouTube';
          const videoCount = p?.video_count || p?.itemCount || 0;
          if (id && title) {
            playlists.push({ listId: id, title, author, videoCount: typeof videoCount === 'number' ? videoCount : 0 });
          }
        } catch {}
      }

      if (videos.length > 0 || playlists.length > 0) {
        return { videos, playlists };
      }
    }
  } catch (err: any) {
    console.warn('[YouTube/youtubei.js] search failed, falling back to yt-search:', err.message);
  }

  // --- Fallback: yt-search ---
  try {
    const yts = await getYts();
    if (yts) {
      const r = await yts(query);
      const videos: YouTubeVideo[] = (r.videos || []).slice(0, limit).map((v: any) => ({
        videoId: v.videoId,
        title: v.title,
        author: v.author?.name || 'Unknown',
        duration: v.timestamp || 'N/A',
        durationSec: v.seconds,
        viewCount: v.views,
        thumbnail: v.thumbnail || v.image,
      }));
      const playlists: YouTubePlaylist[] = (r.playlists || []).slice(0, 10).map((p: any) => ({
        listId: p.listId,
        title: p.title,
        author: p.author?.name || 'YouTube',
        videoCount: p.videoCount || 0,
      }));
      return { videos, playlists };
    }
  } catch (err: any) {
    console.warn('[YouTube/yt-search] fallback also failed:', err.message);
  }

  return { videos: [], playlists: [] };
}

/**
 * Fetch a playlist's videos by list ID.
 */
export async function getPlaylistVideos(listId: string, limit = 60): Promise<YouTubeVideo[]> {
  if (!listId) return [];

  // --- youtubei.js first ---
  try {
    const Innertube = await getYti();
    if (Innertube) {
      const yt = await Innertube.create();
      const playlist = await yt.getPlaylist(listId);
      const items = (playlist as any).videos || (playlist as any).items || [];
      const out: YouTubeVideo[] = [];
      for (const v of items) {
        if (out.length >= limit) break;
        try {
          const id = v?.id || v?.videoId;
          const title = v?.title?.text || v?.title || '';
          const author = v?.author?.name || v?.author?.text || v?.author || '';
          const durationSec = v?.duration?.seconds;
          if (id && title) {
            out.push({
              videoId: id,
              title,
              author,
              duration: typeof durationSec === 'number' ? formatDuration(durationSec) : (v?.duration?.text || 'N/A'),
              durationSec: typeof durationSec === 'number' ? durationSec : undefined,
            });
          }
        } catch {}
      }
      if (out.length > 0) return out;
    }
  } catch (err: any) {
    console.warn('[YouTube/youtubei.js] playlist failed, falling back:', err.message);
  }

  // --- Fallback: yt-search (supports playlist fetch via { listId }) ---
  try {
    const yts = await getYts();
    if (yts) {
      const r = await yts({ listId });
      return (r.videos || []).slice(0, limit).map((v: any) => ({
        videoId: v.videoId,
        title: v.title,
        author: v.author?.name || 'Unknown',
        duration: v.timestamp || 'N/A',
        durationSec: v.seconds,
      }));
    }
  } catch (err: any) {
    console.warn('[YouTube/yt-search] playlist fallback failed:', err.message);
  }

  // --- Last resort: HTML scrape (the old /api/youtube-playlist-fetch approach) ---
  try {
    const listRes = await fetch(`https://www.youtube.com/playlist?list=${listId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await listRes.text();
    const ids = Array.from(new Set(Array.from(text.matchAll(/"videoId":"([^"]{11})"/g)).map(m => m[1]))).slice(0, limit);
    // Use oEmbed for titles (slow but reliable)
    const out: YouTubeVideo[] = [];
    for (const id of ids) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const d = await r.json();
          out.push({ videoId: id, title: d.title, author: d.author_name, duration: 'N/A' });
        }
      } catch {}
    }
    return out;
  } catch (err: any) {
    console.warn('[YouTube/HTML-scrape] last-resort failed:', err.message);
    return [];
  }
}

/**
 * Get metadata for a single video by ID.
 */
export async function getVideoMetadata(videoId: string): Promise<{ title: string; author: string; thumbnail?: string } | null> {
  if (!videoId) return null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      title: d.title,
      author: d.author_name,
      thumbnail: d.thumbnail_url,
    };
  } catch {
    return null;
  }
}
