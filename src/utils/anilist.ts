/**
 * AniList GraphQL API client — free, no auth for reads, ~90 RPM.
 * Best source for anime + staff (artist/seiyuu/director) cross-linking.
 *
 * Docs: https://docs.anilist.co
 * GraphQL endpoint: https://graphql.anilist.co
 */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

export interface AniListAnime {
  id: number;
  idMal?: number;       // MAL ID for cross-linking
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  coverImage?: {
    extraLarge?: string;
    large?: string;
    medium?: string;
    color?: string;
  };
  bannerImage?: string;
  format?: string;
  episodes?: number;
  duration?: number;
  season?: string;
  seasonYear?: number;
  genres?: string[];
  averageScore?: number;
  popularity?: number;
  description?: string;
  startDate?: { year?: number; month?: number; day?: number };
  studios?: {
    nodes: Array<{ id: number; name: string; isAnimation: boolean }>;
  };
  staff?: {
    nodes: Array<{
      id: number;
      name: { full: string; native?: string };
      image?: { large?: string };
      language?: string;
      primaryOccupations?: string[];
    }>;
  };
}

async function anilistQuery<T>(query: string, variables: Record<string, any>): Promise<T | null> {
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ANISYNC/1.0 (https://anisync.app)',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) {
      console.warn('[AniList] rate limit hit — backing off');
      await new Promise(r => setTimeout(r, 1500));
      return null;
    }
    if (!res.ok) {
      console.warn(`[AniList] query failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: any[] };
    if (json.errors && json.errors.length > 0) {
      console.warn('[AniList] GraphQL errors:', json.errors.map(e => e.message).join('; '));
      return null;
    }
    return json.data || null;
  } catch (err: any) {
    console.warn('[AniList] query error:', err.message);
    return null;
  }
}

/**
 * Search anime by name. Returns up to `perPage` results with cover + basic metadata.
 */
export async function searchAnime(query: string, perPage = 8): Promise<AniListAnime[]> {
  if (!query) return [];
  const q = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, search: $search, sort: SEARCH_MATCH) {
          id
          idMal
          title { romaji english native }
          coverImage { extraLarge large medium color }
          format
          episodes
          season
          seasonYear
          genres
          averageScore
          popularity
        }
      }
    }`;
  const data = await anilistQuery<{ Page: { media: AniListAnime[] } }>(q, { search: query, perPage });
  return data?.Page?.media || [];
}

/**
 * Get full anime details by AniList ID — includes studios + staff (artists!).
 */
export async function getAnimeById(id: number): Promise<AniListAnime | null> {
  const q = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        idMal
        title { romaji english native }
        coverImage { extraLarge large medium color }
        bannerImage
        format
        episodes
        duration
        season
        seasonYear
        genres
        averageScore
        popularity
        description(asHtml: false)
        startDate { year month day }
        studios(isMain: true) {
          nodes { id name isAnimation }
        }
        staff(sort: RELEVANCE) {
          nodes {
            id
            name { full native }
            image { large }
            language
            primaryOccupations
          }
        }
      }
    }`;
  const data = await anilistQuery<{ Media: AniListAnime }>(q, { id });
  return data?.Media || null;
}

/**
 * Get an artist's works — find all anime where this person composed/performed.
 * Useful for the Wiki "artist" page to show their other anime credits.
 */
export interface AniListStaffWork {
  animeId: number;
  animeTitle: string;
  animeYear?: number;
  role: string;       // "Theme Song Composition", "Theme Song Performance", etc.
  coverImage?: string;
}

export async function getStaffWorks(staffId: number, perPage = 25): Promise<AniListStaffWork[]> {
  const q = `
    query ($id: Int, $perPage: Int) {
      Staff(id: $id) {
        id
        name { full native }
        image { large }
        characterMedia(perPage: $perPage, sort: ID) {
          nodes {
            id
            type
            media {
              id
              title { romaji english }
              coverImage { large }
              seasonYear
            }
            staffRole
          }
        }
      }
    }`;
  const data = await anilistQuery<{ Staff: any }>(q, { id: staffId, perPage });
  if (!data?.Staff) return [];
  const nodes = data.Staff.characterMedia?.nodes || [];
  return nodes
    .filter((n: any) => n.media && n.type === 'ANIME')
    .map((n: any) => ({
      animeId: n.media.id,
      animeTitle: n.media.title?.romaji || n.media.title?.english || 'Unknown',
      animeYear: n.media.seasonYear,
      role: n.staffRole || 'Staff',
      coverImage: n.media.coverImage?.large,
    }));
}

/**
 * Search for a staff member by name (composer, artist, etc.).
 */
export async function searchStaff(name: string, perPage = 5): Promise<Array<{
  id: number;
  name: string;
  nativeName?: string;
  image?: string;
  primaryOccupations?: string[];
}>> {
  if (!name) return [];
  const q = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        staff(search: $search) {
          id
          name { full native }
          image { large }
          primaryOccupations
        }
      }
    }`;
  const data = await anilistQuery<{ Page: { staff: any[] } }>(q, { search: name, perPage });
  return (data?.Page?.staff || []).map(s => ({
    id: s.id,
    name: s.name?.full || 'Unknown',
    nativeName: s.name?.native,
    image: s.image?.large,
    primaryOccupations: s.primaryOccupations,
  }));
}
