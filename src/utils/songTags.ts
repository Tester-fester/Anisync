/**
 * Song-oriented tagging system for anime tracks.
 *
 * Tags are based on the SONG itself, not the anime:
 *   - Music genre (Rock, Pop, Electronic, Orchestral, etc.)
 *   - Mood/vibe (Hype, Emotional, Epic, Chill, etc.)
 *   - Tempo (Fast, Mid-tempo, Slow, Ballad)
 *   - Vocal style (Male Vocal, Female Vocal, Group, Instrumental)
 *   - Energy level (High Energy, Building, atmospheric)
 *
 * Sources:
 *   1. Last.fm API — real genre tags from the music database
 *   2. Title/artist keyword analysis — mood + genre detection
 *   3. Audio feature heuristics — tempo/energy from title patterns
 *
 * Does NOT include: OP, ED, OST (those are track types, not song tags)
 * Does NOT include: anime genres, demographics, studios, eras (those are anime-level, not song-level)
 */

export interface SongMetadata {
  lastfmTags?: string[];
  lastfmSimilar?: string[];
}

// ---------------------------------------------------------------------------
// Song-oriented tag vocabulary
// ---------------------------------------------------------------------------

export const SONG_TAG_CATEGORIES = {
  genre: [
    'Rock', 'Pop', 'Electronic', 'Orchestral', 'Acoustic', 'Metal', 'Jazz',
    'Hip-Hop', 'R&B', 'Folk', 'Classical', 'Punk', 'Indie', 'Alternative',
    'Synth', 'Dance', 'Ambient', 'Ska', 'Funk', 'Blues', 'Country',
    'Visual Kei', 'J-Rock', 'J-Pop', 'Anisong', 'Power Metal', 'Progressive Rock',
  ],
  mood: [
    'Hype', 'Epic', 'Emotional', 'Chill', 'Nostalgic', 'Intense', 'Sad',
    'Romantic', 'Dark', 'Uplifting', 'Melancholic', 'Energetic', 'Aggressive',
    'Dreamy', 'Triumphant', 'Bittersweet', 'Hopeful', 'Tense', 'Playful',
    'Mysterious', 'Whimsical', 'Anthemic', 'Brooding', 'Serene',
  ],
  tempo: [
    'Fast', 'Mid-Tempo', 'Slow', 'Ballad', 'Upbeat', 'Driving',
  ],
  vocal: [
    'Male Vocal', 'Female Vocal', 'Group Vocal', 'Instrumental', 'Choir',
    'Duet', 'Rap', 'Screamo', 'Falsetto',
  ],
} as const;

export const ALL_SONG_TAGS = new Set<string>(
  Object.values(SONG_TAG_CATEGORIES).flat()
);

// ---------------------------------------------------------------------------
// Type-tag stripping — OP/ED/OST are track TYPES (own filter), not song tags.
// Legacy data still carries them inside track.tags arrays; every tag FILTER
// UI must strip them or they show up as redundant buttons next to the
// OP/ED/OST type selector.
// ---------------------------------------------------------------------------

const TYPE_TAGS = new Set(['OP', 'ED', 'OST', 'OPENING', 'ENDING', 'SOUNDTRACK']);

/** True when a tag string is really a track type masquerading as a tag. */
export function isTypeTag(tag: string): boolean {
  return TYPE_TAGS.has(tag.trim().toUpperCase());
}

/** Removes OP/ED/OST (and spelled-out variants) from a tag list. */
export function stripTypeTags(tags: string[] | null | undefined): string[] {
  if (!tags) return [];
  return tags.filter(t => !isTypeTag(t));
}

// ---------------------------------------------------------------------------
// Last.fm integration — fetch real genre tags for the song
// ---------------------------------------------------------------------------

const lastfmCache = new Map<string, { tags: string[]; expires: number }>();
const LASTFM_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchLastfmTags(title: string, artist: string): Promise<string[]> {
  const cacheKey = `${title.toLowerCase()}_${artist.toLowerCase()}`;
  const cached = lastfmCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tags;

  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      method: 'track.gettoptags',
      artist: artist,
      track: title,
      api_key: apiKey,
      format: 'json',
      autocorrect: '1',
    });
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'ANISYNC/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rawTags = data?.toptags?.tag;
    if (!rawTags) return [];
    const tagArray = Array.isArray(rawTags) ? rawTags : [rawTags];
    const tags = tagArray
      .map((t: any) => t.name?.toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 10);
    lastfmCache.set(cacheKey, { tags, expires: Date.now() + LASTFM_CACHE_TTL });
    return tags;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Map Last.fm raw tags to our vocabulary
// ---------------------------------------------------------------------------

const LASTFM_TAG_MAP: Record<string, string> = {
  // Genres
  'rock': 'Rock', 'alternative rock': 'Alternative', 'indie rock': 'Indie',
  'punk': 'Punk', 'punk rock': 'Punk', 'metal': 'Metal', 'heavy metal': 'Metal',
  'power metal': 'Power Metal', 'death metal': 'Metal', 'black metal': 'Metal',
  'progressive rock': 'Progressive Rock', 'prog rock': 'Progressive Rock',
  'pop': 'Pop', 'j-pop': 'J-Pop', 'japanese pop': 'J-Pop',
  'j-rock': 'J-Rock', 'japanese rock': 'J-Rock',
  'anime': 'Anisong', 'anisong': 'Anisong', 'anime op': 'Anisong',
  'electronic': 'Electronic', 'electronica': 'Electronic', 'edm': 'Electronic',
  'synth': 'Synth', 'synthpop': 'Synth', 'synthwave': 'Synth',
  'dance': 'Dance', 'house': 'Dance', 'techno': 'Dance',
  'orchestral': 'Orchestral', 'classical': 'Classical', 'symphony': 'Orchestral',
  'soundtrack': 'Orchestral', 'score': 'Orchestral',
  'acoustic': 'Acoustic', 'unplugged': 'Acoustic',
  'jazz': 'Jazz', 'smooth jazz': 'Jazz', 'jazz fusion': 'Jazz',
  'hip hop': 'Hip-Hop', 'hip-hop': 'Hip-Hop', 'rap': 'Hip-Hop', 'r&b': 'R&B',
  'rnb': 'R&B', 'soul': 'R&B',
  'folk': 'Folk', 'folk rock': 'Folk',
  'funk': 'Funk', 'ska': 'Ska', 'blues': 'Blues',
  'country': 'Country', 'indie': 'Indie', 'indie pop': 'Indie',
  'visual kei': 'Visual Kei', 'visual kei rock': 'Visual Kei',
  'ambient': 'Ambient', 'shoegaze': 'Ambient',

  // Moods
  'energetic': 'Energetic', 'energetic rock': 'Energetic',
  'melancholic': 'Melancholic', 'melancholy': 'Melancholic',
  'sad': 'Sad', 'depressing': 'Sad',
  'happy': 'Uplifting', 'upbeat': 'Upbeat',
  'epic': 'Epic', 'cinematic': 'Epic',
  'aggressive': 'Aggressive', 'intense': 'Intense',
  'dark': 'Dark', 'gothic': 'Dark',
  'dreamy': 'Dreamy', 'ethereal': 'Dreamy',
  'romantic': 'Romantic', 'love': 'Romantic',
  'nostalgic': 'Nostalgic', 'nostalgia': 'Nostalgic',
  'chill': 'Chill', 'chillout': 'Chill', 'relaxing': 'Chill',
  'playful': 'Playful', 'fun': 'Playful',
  'mysterious': 'Mysterious', 'trippy': 'Mysterious',
  'whimsical': 'Whimsical',
  'anthemic': 'Anthemic', 'anthem': 'Anthemic',
  'triumphant': 'Triumphant', 'victorious': 'Triumphant',
  'hopeful': 'Hopeful', 'inspiring': 'Hopeful',
  'bittersweet': 'Bittersweet',
  'tense': 'Tense', 'suspenseful': 'Tense',
  'brooding': 'Brooding',
  'serene': 'Serene', 'peaceful': 'Serene',
  'hype': 'Hype', 'hype rock': 'Hype',
};

function mapLastfmTags(rawTags: string[]): string[] {
  const mapped: string[] = [];
  for (const raw of rawTags) {
    const tag = LASTFM_TAG_MAP[raw];
    if (tag && !mapped.includes(tag)) mapped.push(tag);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Keyword-based song analysis — genre + mood + tempo + vocal detection
// ---------------------------------------------------------------------------

interface KeywordRule {
  keywords: string[];
  tag: string;
  category: 'genre' | 'mood' | 'tempo' | 'vocal';
}

const KEYWORD_RULES: KeywordRule[] = [
  // Genre keywords (from title/artist)
  { keywords: ['rock', 'guitar', 'band', 'drums', 'riff'], tag: 'Rock', category: 'genre' },
  { keywords: ['metal', 'heavy', 'screamo', 'breakdown', 'distortion'], tag: 'Metal', category: 'genre' },
  { keywords: ['orchestra', 'symphony', 'philharmonic', 'strings', 'cello', 'violin'], tag: 'Orchestral', category: 'genre' },
  { keywords: ['piano', 'acoustic', 'unplugged', 'stripped'], tag: 'Acoustic', category: 'genre' },
  { keywords: ['electronic', 'synth', 'techno', 'edm', 'digital'], tag: 'Electronic', category: 'genre' },
  { keywords: ['jazz', 'swing', 'blues', 'brass', 'saxophone'], tag: 'Jazz', category: 'genre' },
  { keywords: ['hip hop', 'hip-hop', 'rap', 'beat'], tag: 'Hip-Hop', category: 'genre' },
  { keywords: ['dance', 'club', 'disco', 'house'], tag: 'Dance', category: 'genre' },
  { keywords: ['folk', 'acoustic guitar', 'country'], tag: 'Folk', category: 'genre' },
  { keywords: ['pop', 'catchy', 'hook'], tag: 'Pop', category: 'genre' },
  { keywords: ['ambient', 'atmospheric', 'soundscape', 'drone'], tag: 'Ambient', category: 'genre' },
  { keywords: ['funk', 'groove', 'bass line'], tag: 'Funk', category: 'genre' },
  { keywords: ['punk', 'fast', 'short', 'raw'], tag: 'Punk', category: 'genre' },

  // Mood keywords
  { keywords: ['hikari', 'light', 'hero', 'rise', 'stand up', 'fight', 'break through'], tag: 'Uplifting', category: 'mood' },
  { keywords: ['kanashimi', 'sad', 'tears', 'namida', 'cry', 'goodbye', 'sayonara', 'lost'], tag: 'Sad', category: 'mood' },
  { keywords: ['tatakai', 'battle', 'war', 'fight', 'attack', 'charge', 'assault'], tag: 'Epic', category: 'mood' },
  { keywords: ['love', 'ai', 'koi', 'romance', 'heart', 'kiss', 'together'], tag: 'Romantic', category: 'mood' },
  { keywords: ['yume', 'dream', 'fantasy', 'imagine'], tag: 'Dreamy', category: 'mood' },
  { keywords: ['kurai', 'dark', 'shadow', 'night', 'abyss', 'despair'], tag: 'Dark', category: 'mood' },
  { keywords: ['hope', 'ashita', 'tomorrow', 'future', 'mirai'], tag: 'Hopeful', category: 'mood' },
  { keywords: ['natsukashii', 'memory', 'memories', 'nostalgia', 'past', 'remember'], tag: 'Nostalgic', category: 'mood' },
  { keywords: ['tanoshii', 'fun', 'party', 'celebrate', 'carnival'], tag: 'Playful', category: 'mood' },
  { keywords: ['fushigi', 'mystery', 'enigma', 'secret'], tag: 'Mysterious', category: 'mood' },
  { keywords: ['ikari', 'rage', 'anger', 'fury', 'hate'], tag: 'Aggressive', category: 'mood' },
  { keywords: ['shizuka', 'quiet', 'calm', 'peaceful', 'serene', 'gentle'], tag: 'Serene', category: 'mood' },
  { keywords: ['victory', 'win', 'champion', 'triumph', 'crown'], tag: 'Triumphant', category: 'mood' },
  { keywords: ['bittersweet', 'setsunai', 'longing', 'yearning'], tag: 'Bittersweet', category: 'mood' },
  { keywords: ['hype', 'exciting', 'thrilling', 'adrenaline'], tag: 'Hype', category: 'mood' },
  { keywords: ['brooding', 'ominous', 'foreboding'], tag: 'Brooding', category: 'mood' },
  { keywords: ['anthem', 'rally', 'unite', 'together we'], tag: 'Anthemic', category: 'mood' },
  { keywords: ['tense', 'suspense', 'danger', 'threat'], tag: 'Tense', category: 'mood' },
  { keywords: ['whimsical', 'playful', 'quirky', 'silly'], tag: 'Whimsical', category: 'mood' },
  { keywords: ['melancholy', 'melancholic', 'wistful', 'pensive'], tag: 'Melancholic', category: 'mood' },

  // Tempo keywords
  { keywords: ['fast', 'rapid', 'speed', 'rush', 'sprint'], tag: 'Fast', category: 'tempo' },
  { keywords: ['slow', 'ballad', 'lullaby', 'gentle pace'], tag: 'Slow', category: 'tempo' },
  { keywords: ['upbeat', 'lively', 'bouncy'], tag: 'Upbeat', category: 'tempo' },
  { keywords: ['driving', 'pounding', 'relentless'], tag: 'Driving', category: 'tempo' },
  { keywords: ['ballad', 'slow dance', 'love song'], tag: 'Ballad', category: 'tempo' },

  // Vocal keywords
  { keywords: ['instrumental', 'no vocal', 'bgm', 'background music', 'off vocal'], tag: 'Instrumental', category: 'vocal' },
  { keywords: ['choir', 'chorus', 'chorale', 'ensemble'], tag: 'Choir', category: 'vocal' },
  { keywords: ['duet', 'duo', 'featuring', 'feat.'], tag: 'Duet', category: 'vocal' },
  { keywords: ['rap', 'flow', 'mc'], tag: 'Rap', category: 'vocal' },
  { keywords: ['screamo', 'scream', 'growl', 'harsh vocal'], tag: 'Screamo', category: 'vocal' },
  { keywords: ['falsetto', 'high voice', 'soaring'], tag: 'Falsetto', category: 'vocal' },
];

function analyzeKeywords(title: string, artist: string, animeName: string): string[] {
  const combined = `${title} ${artist} ${animeName}`.toLowerCase();
  const tags = new Set<string>();

  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (combined.includes(kw)) {
        tags.add(rule.tag);
        break; // one match per rule is enough
      }
    }
  }

  // Heuristic: if artist name contains typical band indicators, assume Rock
  const artistLower = artist.toLowerCase();
  if (artistLower.includes('band') || artistLower.includes('project') || artistLower.includes('crew')) {
    tags.add('Rock');
  }

  // Heuristic: Japanese artist names often indicate J-Rock/J-Pop
  if (/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(artist)) {
    // Has Japanese characters — likely J-Rock or J-Pop
    if (tags.has('Rock')) tags.add('J-Rock');
    if (tags.has('Pop')) tags.add('J-Pop');
  }

  // Heuristic: "OP" or "opening" in title → likely Anisong
  if (combined.includes('opening') || combined.includes('op ') || combined.includes('theme')) {
    tags.add('Anisong');
  }

  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Vocal style detection — from artist name patterns
// ---------------------------------------------------------------------------

function detectVocalStyle(artist: string): string[] {
  const tags: string[] = [];
  const lower = artist.toLowerCase();

  // Common female artist indicators in anime music
  const femaleIndicators = ['liSA', 'Aimer', 'Reona', 'Eir Aoi', 'ClariS', 'Roselia',
    'Mika Nakashima', 'Kana Nishino', 'yoasobi', 'Yorushika', 'ZUTOMAYO',
    'Milet', 'milet', 'Hikaru Utada', 'Airi Suzuki', 'Nana Mizuki'];
  const maleIndicators = ['ONE OK ROCK', 'MAN WITH A MISSION', 'UVERworld', 'ASIAN KUNG-FU',
    'FLOW', 'KANA-BOON', 'Kenshi Yonezu', 'Hikaru Utada', 'T.M.Revolution',
    'Hiroyuki Sawano', 'Ling Tosite Sigure', 'The Oral Cigarettes'];
  const groupIndicators = ['band', 'project', 'crew', 'collective', 'ClariS',
    'Roselia', 'Yoasobi', 'Yorushika', 'ZUTOMAYO', 'BUMP OF CHICKEN'];

  if (femaleIndicators.some(f => artist.includes(f))) tags.push('Female Vocal');
  if (maleIndicators.some(m => artist.includes(m))) tags.push('Male Vocal');
  if (groupIndicators.some(g => artist.includes(g))) tags.push('Group Vocal');

  // If artist has "feat." or "&" — likely a duet/collab
  if (lower.includes('feat.') || lower.includes(' & ') || lower.includes(' vs ')) {
    tags.push('Duet');
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Main: generate song-oriented tags for a track
// ---------------------------------------------------------------------------

export async function generateSongTags(
  track: { title: string; artist: string; animeName: string; type: string }
): Promise<string[]> {
  const tags = new Set<string>();

  // 1. Keyword analysis (instant, no API call)
  const keywordTags = analyzeKeywords(track.title, track.artist, track.animeName);
  keywordTags.forEach(t => tags.add(t));

  // 2. Vocal style detection
  const vocalTags = detectVocalStyle(track.artist);
  vocalTags.forEach(t => tags.add(t));

  // 3. Last.fm real genre tags (if API key configured)
  const lastfmTags = await fetchLastfmTags(track.title, track.artist);
  const mappedLastfm = mapLastfmTags(lastfmTags);
  mappedLastfm.forEach(t => tags.add(t));

  // 4. Default mood tag if nothing was found
  if (tags.size === 0) {
    tags.add('Hype'); // safe default for anime themes
  }

  // 5. Cap at 8 tags to avoid clutter
  return Array.from(tags).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Batch: generate tags for multiple tracks (with rate limiting for Last.fm)
// ---------------------------------------------------------------------------

export async function generateSongTagsForTracks(
  tracks: Array<{ title: string; artist: string; animeName: string; type: string }>
): Promise<string[][]> {
  const results: string[][] = [];
  for (let i = 0; i < tracks.length; i++) {
    const tags = await generateSongTags(tracks[i]);
    results.push(tags);
    // Rate limit: Last.fm allows ~5 req/sec, wait 200ms between calls
    if (i < tracks.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return results;
}
