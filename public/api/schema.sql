-- ============================================================================
-- Anisync — SQLite schema (mirrors firebase-blueprint.json collections)
-- ============================================================================
-- This file is auto-applied on first boot by src/server/db.ts.
-- To re-apply after edits: bump user_version in db.ts and add a migration
-- block. NEVER run this against a populated DB without backing up first.
--
-- PRAGMAs are set at runtime in db.ts (journal_mode, foreign_keys, busy_timeout,
-- synchronous, temp_store, mmap_size, cache_size). Don't set them here —
-- PRAGMA statements don't survive in a .sql file executed via db.exec() in
-- the way you'd expect for journal_mode (it's a database-level persistent
-- setting but better to set it explicitly in code for clarity).
--
-- Memory budget at 100MB RAM:
--   cache_size = -20000 → 20MB SQLite page cache (negative = KB)
--   mmap_size = 268435456 → 256MB virtual mmap (only resident pages count
--                            toward RAM; the OS pages in/out as needed)
--   WAL mode lets readers proceed concurrently with the single writer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users (replaces /users/{uid})
-- ----------------------------------------------------------------------------
-- Mirrors UserAccount in src/types.ts. Fields the client reads/writes are
-- explicit columns; array/object fields use *_json TEXT columns. The
-- schema is intentionally wide — Firestore user docs were free-form and
-- many fields carried over (bio, banner, malUser, gamification, etc.).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                          TEXT PRIMARY KEY,                  -- generateId('usr') 20-char, OR firebase uid (during migration)
  email                       TEXT NOT NULL UNIQUE,
  password_hash               TEXT,                              -- nullable: null if Google-only auth
  google_sub                  TEXT UNIQUE,                       -- Google subject ID (Option C only)
  role                        TEXT NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user','admin')),
  display_name                TEXT,
  avatar_url                  TEXT,
  banner_url                  TEXT,
  bio                         TEXT,
  mal_user                    TEXT,
  -- Display + identity fields:
  displayed_badge_ids_json     TEXT,                              -- JSON array of badge ids the user chose to display
  active_crest                TEXT,
  subscription_tier           TEXT NOT NULL DEFAULT 'free',
  -- Stats:
  votes_count                 INTEGER NOT NULL DEFAULT 0,
  elo                         INTEGER,                           -- aggregate user ELO (separate from per-track)
  followers_count             INTEGER NOT NULL DEFAULT 0,
  -- Activity / streaks:
  last_clash_date             TEXT,                              -- ISO date 'YYYY-MM-DD'
  streak_count                INTEGER NOT NULL DEFAULT 0,
  last_streak_update_date     TEXT,
  best_streak                 INTEGER NOT NULL DEFAULT 0,
  streak_freeze_count          INTEGER NOT NULL DEFAULT 0,
  -- Gamification:
  total_xp                    INTEGER NOT NULL DEFAULT 0,
  weekly_xp                   INTEGER NOT NULL DEFAULT 0,
  weekly_xp_week              TEXT,                              -- ISO week id 'YYYY-Www'
  daily_goal_date             TEXT,
  daily_goal_votes            INTEGER NOT NULL DEFAULT 0,
  -- JSON-array / object fields:
  badges_json                 TEXT,                              -- JSON array of badge ids earned
  completed_collections_json  TEXT,                              -- JSON array of anime names (completist badge tracker)
  follows_json                TEXT,                              -- JSON array of user ids this user follows
  favorites_json              TEXT,                              -- JSON array of track ids (favoriteTrackIds)
  saved_track_ids_json        TEXT,                              -- JSON array of track ids (savedTrackIds)
  voted_track_ids_json        TEXT,                              -- JSON array of track ids voted on in arena
  vibe_spectrum_json          TEXT,                              -- JSON radar data (nostalgia/hype/atmospheric/symphonic/vocalIntensity)
  custom_lists_json           TEXT,                              -- JSON: user-defined playlists
  arena_diary_json            TEXT,                              -- JSON array of arena activity entries
  custom_tournaments_json     TEXT,                              -- JSON array of user-created tournament brackets
  created_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at                  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ----------------------------------------------------------------------------
-- tracks (replaces /tracks/{id})
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  artist            TEXT NOT NULL,
  anime_name        TEXT NOT NULL,
  anime_part        TEXT,                              -- e.g., "Season 1 Part 2" — optional
  type              TEXT NOT NULL CHECK (type IN ('OP','ED','OST')),
  youtube_id        TEXT NOT NULL,
  elo               INTEGER NOT NULL DEFAULT 1200 CHECK (elo BETWEEN 100 AND 4000),
  matches_played    INTEGER NOT NULL DEFAULT 0,
  wins              INTEGER NOT NULL DEFAULT 0,
  losses            INTEGER NOT NULL DEFAULT 0,
  draws             INTEGER NOT NULL DEFAULT 0,
  added_by_user     INTEGER NOT NULL DEFAULT 0,       -- bool
  tags_json         TEXT,                             -- JSON array of tag strings
  custom_image_url  TEXT,                             -- optional override of the YouTube thumbnail
  created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_tracks_elo       ON tracks(elo DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_anime     ON tracks(anime_name);
CREATE INDEX IF NOT EXISTS idx_tracks_matches   ON tracks(matches_played DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_type      ON tracks(type);
-- v4: embed-fallback track lookup + verify-batch title-flagging both filter
-- on youtube_id (was a full table scan per player error).
CREATE INDEX IF NOT EXISTS idx_tracks_yt        ON tracks(youtube_id);

-- ----------------------------------------------------------------------------
-- history (replaces /history/{id})
-- We denormalize track_a_id / track_b_id out of the JSON for fast indexing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS history (
  id                TEXT PRIMARY KEY,
  timestamp         INTEGER NOT NULL,                  -- epoch ms
  track_a_id        TEXT NOT NULL,
  track_b_id        TEXT NOT NULL,
  track_a_json      TEXT NOT NULL,                     -- snapshot of track at vote time
  track_b_json      TEXT NOT NULL,
  winner_id         TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('arena','tournament')),
  is_quarantined    INTEGER NOT NULL DEFAULT 0,
  voter_coefficient REAL    NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_history_ts        ON history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_track_a   ON history(track_a_id);
CREATE INDEX IF NOT EXISTS idx_history_track_b   ON history(track_b_id);
CREATE INDEX IF NOT EXISTS idx_history_winner    ON history(winner_id);

-- ----------------------------------------------------------------------------
-- proposals (replaces /proposals/{id})
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('add_track','fix_link')),
  submitted_by      TEXT NOT NULL,                    -- user id (no FK: legacy firebase uids ok)
  submitted_at      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  track_data_json   TEXT NOT NULL,
  old_track_id      TEXT,
  proposed_yt_id    TEXT,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_submitter ON proposals(submitted_by);
CREATE INDEX IF NOT EXISTS idx_proposals_status    ON proposals(status, submitted_at DESC);

-- ----------------------------------------------------------------------------
-- tournaments (replaces /tournaments/{id})
-- ----------------------------------------------------------------------------
-- Mirrors the Tournament type in src/types.ts. The matches array (with all
-- the bracket state) is stored as a single JSON blob; the top-level
-- status/owner/created_by columns are denormalized for fast queries.
CREATE TABLE IF NOT EXISTS tournaments (
  id                    TEXT PRIMARY KEY,
  owner_id              TEXT NOT NULL,
  name                  TEXT NOT NULL,
  format                TEXT,                          -- the typeFilter string ("OP", "ED", "all", etc.)
  size                  INTEGER,                       -- 4 | 8 | 16 | 32
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','completed')),
  current_round         INTEGER NOT NULL DEFAULT 0,
  current_match_index   INTEGER NOT NULL DEFAULT 0,
  matches_json          TEXT NOT NULL,                 -- JSON array of TournamentMatch objects
  is_online             INTEGER NOT NULL DEFAULT 0,    -- bool
  voting_duration       INTEGER,                       -- seconds per match (online only)
  match_end_time        INTEGER,                       -- epoch ms when current match ends (online only)
  created_by            TEXT,                          -- user id of creator (same as owner_id, kept for compat)
  created_by_username   TEXT,                          -- display name of creator (denormalized)
  winner_id             TEXT,
  privacy               TEXT,                          -- 'public' | 'private'
  lobby_password        TEXT,
  currently_playing_id TEXT,                          -- track id currently being played in lobby
  history_log_json      TEXT NOT NULL DEFAULT '[]',    -- JSON array of {matchId, trackA, trackB, winner, eloChanges}
  created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tournaments_owner  ON tournaments(owner_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- ----------------------------------------------------------------------------
-- franchise_cache (replaces /franchise_cache/{key})
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_cache (
  key               TEXT PRIMARY KEY,
  status            TEXT,
  data_json         TEXT NOT NULL,                     -- { animeTitle, relatedMalIds }
  updated_at        INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- artist_profiles (replaces /artist_profiles/{id})
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artist_profiles (
  id                TEXT PRIMARY KEY,
  artist_name       TEXT NOT NULL,
  image_url         TEXT,
  bio               TEXT,
  birthday          TEXT,
  website           TEXT,
  mal_url           TEXT,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artist_profiles(artist_name);

-- ----------------------------------------------------------------------------
-- reviews (replaces /reviews/{id})
-- One review per user per track (unique index enforces).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  track_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  user_name         TEXT NOT NULL,
  user_avatar       TEXT,
  content           TEXT NOT NULL,
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  source            TEXT,                              -- 'arena' | 'tournament' | 'direct' (nullable for legacy)
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_track ON reviews(track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user  ON reviews(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_user_track ON reviews(user_id, track_id);

-- ----------------------------------------------------------------------------
-- pokedex_collectibles (replaces /pokedex_collectibles/{id})
-- ----------------------------------------------------------------------------
-- Mirrors PokedexCollectible in src/types.ts. The Firebase doc shape used
-- animeName / iconType / iconValue / visualEffect / requiredTrackIds — NOT
-- the rarity/criteria fields the previous schema had.
CREATE TABLE IF NOT EXISTS pokedex_collectibles (
  id                          TEXT PRIMARY KEY,        -- lowercased sanitized animeName
  anime_name                  TEXT NOT NULL,
  description                 TEXT NOT NULL DEFAULT '',
  icon_type                   TEXT NOT NULL DEFAULT 'emoji' CHECK (icon_type IN ('emoji','image')),
  icon_value                  TEXT NOT NULL DEFAULT '',  -- emoji string OR image URL
  visual_effect               TEXT NOT NULL DEFAULT 'none',
  required_track_ids_json     TEXT NOT NULL DEFAULT '[]',  -- JSON array of track ids
  created_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_pokedex_anime ON pokedex_collectibles(anime_name);

-- ----------------------------------------------------------------------------
-- sessions (NEW — JWT auth sessions; replaces Firebase Auth's cookie store)
-- We use stateful sessions (token → user_id in DB) so we can revoke instantly.
-- The JWT itself is stateless; the DB row is the revocation knob.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token             TEXT PRIMARY KEY,                  -- 64-char hex (crypto.randomBytes)
  user_id           TEXT NOT NULL,
  expires_at        INTEGER NOT NULL,
  created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- ----------------------------------------------------------------------------
-- api_cache (replaces Firestore api_cache collection)
-- Keyed by hash(endpoint + sorted params), same as src/utils/apiCache.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_cache (
  key               TEXT PRIMARY KEY,
  response_json     TEXT NOT NULL,
  cached_at         INTEGER NOT NULL,
  ttl_ms            INTEGER NOT NULL DEFAULT 86400000  -- 24h default
);
CREATE INDEX IF NOT EXISTS idx_api_cache_cached ON api_cache(cached_at);

-- ----------------------------------------------------------------------------
-- rate_buckets (NEW — replaces the in-memory Map in server.ts)
-- Lets rate-limit state survive restarts and be shared across instances.
-- Single-row upsert per (ip, path_bucket, minute_window).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key        TEXT PRIMARY KEY,                  -- `${ip}:${pathBucket}:${minuteWindow}`
  count             INTEGER NOT NULL DEFAULT 0,
  reset_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_buckets_reset ON rate_buckets(reset_at);

-- ----------------------------------------------------------------------------
-- schema_migrations (NEW — track which migrations have been applied)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version           INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  applied_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- Mark v1 (initial schema) as applied.
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (1, 'initial');

-- embed_feedback (v4 — browser-reported YouTube player errors)
-- The iframe player is the ground truth for embeddability: embed-blocked
-- videos answer oEmbed 200 yet refuse to play inside iframes. Browsers
-- report failures to /api/embed-fallback, which upserts them here; the
-- stream audit then flags those IDs even when the server-side oEmbed
-- check (bot-flagged datacenter/NAS IPs often are) says "ok".
CREATE TABLE IF NOT EXISTS embed_feedback (
    yt_id                TEXT PRIMARY KEY,
    error_code           INTEGER NOT NULL DEFAULT 0,   -- YT player error (101/150 = embed blocked, 100 = dead, 2/5 = player)
    reports              INTEGER NOT NULL DEFAULT 1,
    first_reported_at    INTEGER NOT NULL,
    last_reported_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embed_feedback_last ON embed_feedback(last_reported_at);
