<?php

if (!function_exists("get_json_body")) {
    function get_json_body() {
        $raw = file_get_contents("php://input");
        // FIX: stdin fallback is now non-blocking + cached (see
        // an_stdin_data_available in lib.php) — no TTY hang, single read.
        if (!$raw || $raw === "") $raw = an_stdin_data_available();
        if (!$raw || $raw === "") $raw = isset($GLOBALS["HTTP_RAW_POST_DATA"]) ? $GLOBALS["HTTP_RAW_POST_DATA"] : "";
        $d = json_decode($raw, true);
        return is_array($d) ? $d : array();
    }
}

if (!function_exists("http_response_code")) {
    function http_response_code($code = NULL) {
        static $last = 200;
        if ($code !== NULL) {
            $last = (int)$code;
            header("HTTP/1.1 " . $last, true, $last);
        }
        return $last;
    }
}
/**
 * Anisync MBL — lib.php
 * Core library for the PHP 5.3 port (WD My Book Live, PowerPC, lighttpd).
 *
 * Everything here is written for PHP 5.3 compatibility:
 *   - array() syntax only (no short arrays)
 *   - isset() ternaries (no ??)
 *   - PBKDF2-SHA256 implemented manually (no hash_pbkdf2, no password_hash)
 *   - Random bytes from /dev/urandom (no openssl ext required)
 *   - json_encode without 5.4+ flags
 */

error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
ini_set('display_errors', '0');

// Request start timestamp (for /health uptime).
define('ANI_START_TS', isset($_SERVER['REQUEST_TIME_FLOAT']) ? (float)$_SERVER['REQUEST_TIME_FLOAT'] : microtime(true));

// v12.1: engine stamp — /health reports it and deploy checks assert it, so
// "did the new code actually land on the NAS?" is a one-line curl away.
// Bump on every engine change (see FIXES.md §20).
define('ANISYNC_ENGINE', '12.2');

// ---------------------------------------------------------------------------
// Config — loaded from config.php next to this file (created by install.sh).
// FIX: every constant now gets an individual fallback. Previously the whole
// fallback block only ran when ANISYNC_DB_PATH was missing, so a partial
// config.php (missing e.g. GEMINI_API_KEY) caused FATAL "undefined constant"
// errors on PHP 7/8.
// ---------------------------------------------------------------------------
$ANI_CONFIG_FILE = dirname(__FILE__) . '/config.php';
if (is_file($ANI_CONFIG_FILE)) {
    require_once $ANI_CONFIG_FILE;
}
if (!defined('ANISYNC_DB_PATH')) {
    define('ANISYNC_DB_PATH', dirname(__FILE__) . '/../../data/anisync.sqlite');
}
if (!defined('APP_URL'))                define('APP_URL', '');
if (!defined('GEMINI_API_KEY'))         define('GEMINI_API_KEY', '');
if (!defined('GEMINI_MODEL'))           define('GEMINI_MODEL', 'gemini-2.0-flash');
if (!defined('LASTFM_API_KEY'))         define('LASTFM_API_KEY', '');
// FIX (v12.2): YOUTUBE_API_KEY had NO fallback define. When config.php is
// absent (fresh checkout — config.php is created by install.sh and is NOT
// committed), an_embed_probe() hits an undefined constant and the PHP
// process dies SILENTLY mid-audit. This killed the Stream Auditor, the CLI
// sweeper (bulk_stream_repair.php), and /api/verify-video on every fresh
// install. Empty string = the Data API signal is skipped gracefully and the
// probe falls back to oEmbed + InnerTube (exactly how config-less hosts
// already run). Same fix class as the GEMINI_API_KEY fallback added in v6.
if (!defined('YOUTUBE_API_KEY'))        define('YOUTUBE_API_KEY', '');
if (!defined('GOOGLE_OAUTH_CLIENT_ID')) define('GOOGLE_OAUTH_CLIENT_ID', '');
if (!defined('GOOGLE_OAUTH_CLIENT_SECRET')) define('GOOGLE_OAUTH_CLIENT_SECRET', '');
if (!defined('GOOGLE_OAUTH_SCOPES'))    define('GOOGLE_OAUTH_SCOPES', 'https://www.googleapis.com/auth/youtube');
if (!defined('ANISYNC_HTTP_PROXY'))     define('ANISYNC_HTTP_PROXY', '');
if (!defined('ANISYNC_INSECURE_TLS'))   define('ANISYNC_INSECURE_TLS', false);
if (!defined('JWT_SECRET'))             define('JWT_SECRET', '');

// FIX: if JWT_SECRET is empty, auto-generate one and persist it next to the
// database (data/jwt_secret.key) so login keeps working on sloppy installs.
// Rotating that file invalidates issued tokens — same as rotating the secret.
if (JWT_SECRET === '') {
    $aniJwtKeyFile = dirname(ANISYNC_DB_PATH) . '/jwt_secret.key';
    $aniJwtKey = '';
    if (is_file($aniJwtKeyFile)) {
        $aniJwtKey = trim((string)@file_get_contents($aniJwtKeyFile));
    }
    if (strlen($aniJwtKey) !== 64) {
        $aniJwtKey = rand_hex(32);
        @file_put_contents($aniJwtKeyFile, $aniJwtKey);
    }
    define('JWT_SECRET_RESOLVED', $aniJwtKey);
} else {
    define('JWT_SECRET_RESOLVED', JWT_SECRET);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function now_ms() { return round(microtime(true) * 1000); }

/** v12.1 NAS: shared conditional-GET for the hot read endpoints.
 *
 * The SPA polls /api/db/tracks + /history (+ tournaments/users/proposals/
 * artist-profiles) every few seconds, and each 200 rebuilds a full payload
 * (the 350-1000ms latencies in the field log). This helper computes a CHEAP
 * row-signature ETag (one aggregate query); on an If-None-Match hit it
 * answers 304 WITHOUT building the payload, and the short max-age lets the
 * browser serve the cached body without touching the NAS at all between
 * revalidations. A poll storm then costs ~zero bytes and one aggregate
 * query instead of a full serialize.
 *
 * MUST be called before any output. Returns nothing; call sites just build
 * + json_out() the full payload afterwards (only reached on mismatch).
 */
function an_list_version_etag($tag, $verSql, $verParams, $maxAge) {
    $sig = '0';
    try {
        $sum = db_one($verSql, $verParams);
        if (is_array($sum) && count($sum) > 0) {
            $vals = array();
            foreach (array_values($sum) as $v) $vals[] = (string)$v;
            $sig = implode('-', $vals);
        }
    } catch (Exception $e) { $sig = 'err'; }
    $etag = 'W/"' . $tag . '-' . $sig . '"';
    header('ETag: ' . $etag);
    header('Cache-Control: private, max-age=' . (int)$maxAge);
    $ifNone = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
    if ($ifNone !== '' && $ifNone === $etag) {
        http_response_code(304);
        exit;
    }
}

function json_out($data, $status) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    $json = json_encode($data);
    // v12 NAS: gzip JSON when the client accepts it. The tracks payload alone
    // drops from ~43 KB to ~7 KB (-84%); lighttpd's mod_compress only covers
    // static files, so API responses must compress here. Cheap even on the
    // PPC NAS (~10-20ms for 40KB at level 5) versus transmit + re-parse.
    if (function_exists('gzencode') && is_string($json) && strlen($json) > 512
        && isset($_SERVER['HTTP_ACCEPT_ENCODING'])
        && strpos($_SERVER['HTTP_ACCEPT_ENCODING'], 'gzip') !== false
        && !headers_sent()) {
        $gz = gzencode($json, 5);
        if ($gz !== false && strlen($gz) < strlen($json)) {
            header('Content-Encoding: gzip');
            header('Vary: Accept-Encoding');
            echo $gz;
            exit;
        }
    }
    echo $json;
    exit;
}

function err_out($status, $error, $message) {
    json_out(array('error' => $error, 'message' => $message), $status);
}

/** Read + decode the JSON request body (works for POST/PATCH/PUT/DELETE).
 * v12: both json_body() and body_get() now share ONE raw read through
 * an_raw_input() — on PHP < 5.6 a second file_get_contents('php://input')
 * returns empty, which silently corrupted handlers that ran after another
 * reader had already consumed the stream. */
function json_body() {
    static $cache = null;
    if ($cache !== null) return $cache;
    $raw = an_raw_input();
    if ($raw === '') { $cache = array(); return $cache; }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) $decoded = array();
    $cache = $decoded;
    return $cache;
}

/** The single canonical request-body read (web SAPI, CLI stdin, raw-post
 * fallback), cached for the lifetime of the request. */
$GLOBALS['_ANI_RAW_INPUT'] = null;
function an_raw_input() {
    if ($GLOBALS['_ANI_RAW_INPUT'] !== null) return $GLOBALS['_ANI_RAW_INPUT'];
    $raw = @file_get_contents('php://input');
    if ($raw === '' || $raw === false) $raw = an_stdin_data_available();
    if ($raw === '' || $raw === false) $raw = isset($GLOBALS['HTTP_RAW_POST_DATA']) ? $GLOBALS['HTTP_RAW_POST_DATA'] : '';
    $GLOBALS['_ANI_RAW_INPUT'] = (string)$raw;
    return $GLOBALS['_ANI_RAW_INPUT'];
}

/** Piped stdin data if available (non-blocking); '' otherwise. Safe on web SAPIs.
 * Result is cached — the raw stream can only be read once, and both the
 * router (an_request_has_body) and the handlers (json_body) need it. */
$GLOBALS['_ANI_STDIN_RAW'] = null;
function an_stdin_data_available() {
    if ($GLOBALS['_ANI_STDIN_RAW'] !== null) return $GLOBALS['_ANI_STDIN_RAW'];
    $data = '';
    if ((PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg') && defined('STDIN')) {
        $read = array(STDIN);
        $write = array();
        $except = array();
        // 0-second timeout: only read when the pipe already has data (or EOF).
        $ready = @stream_select($read, $write, $except, 0);
        if ($ready === 1) {
            $got = @stream_get_contents(STDIN);
            if ($got !== false) $data = $got;
        }
    }
    $GLOBALS['_ANI_STDIN_RAW'] = $data;
    return $data;
}

/** Fetch a key from the JSON body with a default (PHP 5.3 — no ??). */

function body_get($key = null, $default = null) {
    global $AN_BODY_CACHE;
    if ($AN_BODY_CACHE === null) {
        $raw = an_raw_input();
        $parsed = safe_json_parse($raw, null);
        $AN_BODY_CACHE = is_array($parsed) ? $parsed : array();
    }
    if ($key === null) return $AN_BODY_CACHE;
    return isset($AN_BODY_CACHE[$key]) ? $AN_BODY_CACHE[$key] : $default;
}


/** Random bytes from /dev/urandom (no openssl ext on the MBL PHP build). */
function an_random_bytes($n) {
    $fp = @fopen('/dev/urandom', 'rb');
    if ($fp) {
        $buf = '';
        while (strlen($buf) < $n) {
            $chunk = fread($fp, $n - strlen($buf));
            if ($chunk === false || $chunk === '') break;
            $buf .= $chunk;
        }
        fclose($fp);
        if (strlen($buf) === $n) return $buf;
    }
    // Fallback (should never happen on Linux)
    $buf = '';
    for ($i = 0; $i < $n; $i++) $buf .= chr(mt_rand(0, 255));
    return $buf;
}

function rand_hex($bytes) { return bin2hex(an_random_bytes($bytes)); }

/** 20-char alphanumeric id, Firestore-style — matches the Node generateId(). */
function generate_id($prefix) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $bytes = an_random_bytes(20);
    $id = '';
    for ($i = 0; $i < 20; $i++) $id .= $chars[ord($bytes[$i]) % 62];
    if ($prefix !== '') return $prefix . '_' . $id;
    return $id;
}

function b64url_encode($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64url_decode($s) { return base64_decode(strtr($s, '-_', '+/')); }

/** Parse an ISO-8601-ish timestamp to epoch ms (returns null on failure). */
function iso_to_ms($s) {
    if ($s === null || $s === '') return null;
    $t = strtotime((string)$s);
    if ($t === false || $t === -1) return null;
    return $t * 1000;
}

/** Epoch ms → ISO 8601 string (UTC), like JS new Date(ms).toISOString(). */
function ms_to_iso($ms) {
    if ($ms === null || $ms === '') return null;
    $sec = floor(((int)$ms) / 1000);
    $usec = ((int)$ms) % 1000;
    return gmdate('Y-m-d\TH:i:s', $sec) . sprintf('.%03dZ', $usec);
}

function safe_json_parse($s, $fallback) {
    if ($s === null || $s === '' || $s === false) return $fallback;
    $d = json_decode($s, true);
    if ($d === null && json_last_error() !== JSON_ERROR_NONE) return $fallback;
    return $d;
}

// ---------------------------------------------------------------------------
// Password hashing — PBKDF2-SHA256, 20000 rounds (same scheme family as the
// user's MyBook Cloud app; Squeeze glibc crypt() has no bcrypt and PHP 5.3
// has no password_hash). Format: pbkdf2$<iters>$<salt-hex>$<hash-hex>
// ---------------------------------------------------------------------------
define('PBKDF2_ITERS', 20000);

function pbkdf2_hash($password) {
    $salt = an_random_bytes(16);
    $hash = pbkdf2_derive($password, $salt, PBKDF2_ITERS);
    return 'pbkdf2$' . PBKDF2_ITERS . '$' . bin2hex($salt) . '$' . bin2hex($hash);
}

function pbkdf2_verify($password, $stored) {
    if (!$stored) return false;
    $parts = explode('$', $stored);
    if (count($parts) !== 4 || $parts[0] !== 'pbkdf2') return false;
    $iters = (int)$parts[1];
    $salt = pack('H*', $parts[2]);
    $expected = pack('H*', $parts[3]);
    $got = pbkdf2_derive($password, $salt, $iters);
    return strlen($got) === strlen($expected) && an_equal($got, $expected);
}

function pbkdf2_derive($password, $salt, $iters) {
    // Pure-PHP PBKDF2 using hash_hmac (constant-time inner loop by construction).
    $hlen = strlen(hash('sha256', '', true));
    $blocks = 1; // 32 bytes < 64-byte HMAC-SHA256 block size
    $dk = '';
    for ($b = 1; $b <= $blocks; $b++) {
        $u = hash_hmac('sha256', $salt . pack('N', $b), $password, true);
        $t = $u;
        for ($i = 1; $i < $iters; $i++) {
            $u = hash_hmac('sha256', $u, $password, true);
            $t ^= $u; // XOR
        }
        $dk .= $t;
    }
    return substr($dk, 0, 32);
}

/** Timing-safe string comparison (hash_equals is PHP 5.6+). */
function an_equal($a, $b) {
    if (strlen($a) !== strlen($b)) return false;
    $r = 0;
    for ($i = 0; $i < strlen($a); $i++) { $r |= ord($a[$i]) ^ ord($b[$i]); }
    return $r === 0;
}

// ---------------------------------------------------------------------------
// JWT — HS256, shape-compatible with the Node jsonwebtoken tokens.
// ---------------------------------------------------------------------------
define('JWT_EXPIRES_SECONDS', 7 * 24 * 60 * 60); // "7d"
define('SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000);

function jwt_sign($user_id, $email, $role, $sid) {
    $header = b64url_encode(json_encode(array('alg' => 'HS256', 'typ' => 'JWT')));
    $payload = b64url_encode(json_encode(array(
        'sub' => $user_id,
        'email' => $email,
        'role' => $role,
        'sid' => $sid,
        'iat' => time(),
        'exp' => time() + JWT_EXPIRES_SECONDS,
    )));
    $sig = b64url_encode(hash_hmac('sha256', $header . '.' . $payload, JWT_SECRET_RESOLVED, true));
    return $header . '.' . $payload . '.' . $sig;
}

/** Returns the payload array or null. */
function jwt_verify_token($token) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    list($h, $p, $s) = $parts;
    $expected = b64url_encode(hash_hmac('sha256', $h . '.' . $p, JWT_SECRET_RESOLVED, true));
    if (!an_equal($expected, $s)) return null;
    $payload = safe_json_parse(b64url_decode($p), null);
    if (!is_array($payload)) return null;
    if (isset($payload['exp']) && (int)$payload['exp'] < time()) return null;
    return $payload;
}

// ---------------------------------------------------------------------------
// Database — PDO SQLite singleton + schema bootstrap (mirrors db.ts exactly:
# schema.sql for v1, additive ALTERs for v2, google_oauth_token_json for v3).
// ---------------------------------------------------------------------------
$GLOBALS['_ANI_PDO'] = null;

function db() {
    if ($GLOBALS['_ANI_PDO'] !== null) return $GLOBALS['_ANI_PDO'];
    $path = ANISYNC_DB_PATH;
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $pdo = new PDO('sqlite:' . $path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA synchronous = NORMAL');
    // v12 NAS tuning: 8 MB page cache (default 2 MB), temp tables/sorters in
    // memory instead of flash, and smoother WAL checkpoints spread over
    // 2000 pages instead of the 1000-page default stall.
    $pdo->exec('PRAGMA cache_size = -8000');
    $pdo->exec('PRAGMA temp_store = MEMORY');
    $pdo->exec('PRAGMA wal_autocheckpoint = 2000');
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
    an_init_schema($pdo);
    $GLOBALS['_ANI_PDO'] = $pdo;
    an_lazy_gc();
    return $pdo;
}

/** v12: lazy garbage collection (1-in-100 dice on db() boot). Runs wherever
 * the DB boots — LAN requests no longer pass through rate_limit() — and now
 * also GCs api_cache, the only table that grew without bound (expired
 * embverify/embedrepair/embeddone cooldown rows piled up forever on flash). */
function an_lazy_gc() {
    if (mt_rand(1, 100) !== 1) return;
    try {
        $now = now_ms();
        db_run('DELETE FROM api_cache WHERE (cached_at + ttl_ms) <= ?', array($now));
        db_run('DELETE FROM rate_buckets WHERE reset_at <= ?', array($now));
        db_run('DELETE FROM sessions WHERE expires_at <= ?', array($now));
    } catch (Exception $e) { /* GC is best-effort */ }
}

function db_one($sql, $params) {
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $st->closeCursor();
    return $row === false ? null : $row;
}

function db_all($sql, $params) {
    $st = db()->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $st->closeCursor();
    return $rows;
}

function db_run($sql, $params) {
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
}

function db_last_id() { return db()->lastInsertId(); }

function an_init_schema($pdo) {
    $ver = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($ver === 0) {
        $schema = file_get_contents(dirname(__FILE__) . '/schema.sql');
        if ($schema !== false) $pdo->exec($schema);
        $pdo->exec('PRAGMA user_version = 1');
        $ver = 1;
    }
    if ($ver < 2) {
        // v2 — additive columns (same list as db.ts migration v2).
        $adds = array(
            array('users', 'banner_url', 'TEXT'),
            array('users', 'bio', 'TEXT'),
            array('users', 'mal_user', 'TEXT'),
            array('users', 'displayed_badge_ids_json', 'TEXT'),
            array('users', 'active_crest', 'TEXT'),
            array('users', 'subscription_tier', "TEXT NOT NULL DEFAULT 'free'"),
            array('users', 'votes_count', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'elo', 'INTEGER'),
            array('users', 'followers_count', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'last_clash_date', 'TEXT'),
            array('users', 'streak_count', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'last_streak_update_date', 'TEXT'),
            array('users', 'best_streak', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'streak_freeze_count', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'total_xp', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'weekly_xp', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'weekly_xp_week', 'TEXT'),
            array('users', 'daily_goal_date', 'TEXT'),
            array('users', 'daily_goal_votes', 'INTEGER NOT NULL DEFAULT 0'),
            array('users', 'completed_collections_json', 'TEXT'),
            array('users', 'saved_track_ids_json', 'TEXT'),
            array('users', 'voted_track_ids_json', 'TEXT'),
            array('users', 'arena_diary_json', 'TEXT'),
            array('users', 'custom_tournaments_json', 'TEXT'),
            array('tracks', 'anime_part', 'TEXT'),
            array('tracks', 'custom_image_url', 'TEXT'),
            array('tournaments', 'size', 'INTEGER'),
            array('tournaments', 'current_round', 'INTEGER NOT NULL DEFAULT 0'),
            array('tournaments', 'current_match_index', 'INTEGER NOT NULL DEFAULT 0'),
            array('tournaments', 'is_online', 'INTEGER NOT NULL DEFAULT 0'),
            array('tournaments', 'voting_duration', 'INTEGER'),
            array('tournaments', 'match_end_time', 'INTEGER'),
            array('tournaments', 'created_by', 'TEXT'),
            array('tournaments', 'created_by_username', 'TEXT'),
            array('tournaments', 'winner_id', 'TEXT'),
            array('tournaments', 'privacy', 'TEXT'),
            array('tournaments', 'lobby_password', 'TEXT'),
            array('tournaments', 'currently_playing_id', 'TEXT'),
            array('tournaments', 'history_log_json', "TEXT NOT NULL DEFAULT '[]'"),
            array('reviews', 'source', 'TEXT'),
            array('pokedex_collectibles', 'anime_name', 'TEXT'),
            array('pokedex_collectibles', 'icon_type', "TEXT NOT NULL DEFAULT 'emoji'"),
            array('pokedex_collectibles', 'icon_value', "TEXT NOT NULL DEFAULT ''"),
            array('pokedex_collectibles', 'visual_effect', "TEXT NOT NULL DEFAULT 'none'"),
            array('pokedex_collectibles', 'required_track_ids_json', "TEXT NOT NULL DEFAULT '[]'"),
        );
        an_add_columns($pdo, $adds);
        $pdo->exec('PRAGMA user_version = 2');
    }
    if ($ver < 3) {
        an_add_columns($pdo, array(array('users', 'google_oauth_token_json', 'TEXT')));
        $pdo->exec('PRAGMA user_version = 3');
    }
    if ($ver < 4) {
        // v4 — embed-fallback's track lookup runs WHERE youtube_id = ? on
        // every player error; verify-batch's title-flagging runs an IN(...)
        // over the same column. Both were full table scans.
        try { $pdo->exec('CREATE INDEX IF NOT EXISTS idx_tracks_yt ON tracks(youtube_id)'); }
        catch (Exception $e) { /* index failures are non-fatal */ }
        try { $pdo->exec('PRAGMA user_version = 4'); } catch (Exception $e) {}
    }
}

function an_add_columns($pdo, $adds) {
    foreach ($adds as $a) {
        list($table, $col, $type) = $a;
        $has = false;
        foreach ($pdo->query('PRAGMA table_info(' . $table . ')') as $row) {
            if ($row['name'] === $col) { $has = true; break; }
        }
        if (!$has) {
            try { $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $col . ' ' . $type); }
            catch (Exception $e) { /* column add failures are non-fatal, same as db.ts */ }
        }
    }
}

// ---------------------------------------------------------------------------
// Sessions (stateful JWT revocation — sessions table, sid claim = token).
// ---------------------------------------------------------------------------
function create_session($user_id) {
    $token = rand_hex(32); // 64-char hex, same as Node
    $expires = now_ms() + SESSION_TTL_MS;
    db_run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
        array($token, $user_id, $expires));
    return $token;
}

function session_valid($token) {
    $row = db_one('SELECT token FROM sessions WHERE token = ? AND expires_at > ?',
        array($token, now_ms()));
    return $row !== null;
}

function revoke_session($token) {
    db_run('DELETE FROM sessions WHERE token = ?', array($token));
}

// ---------------------------------------------------------------------------
// Auth resolution — Bearer token → verified JWT → session row → fresh user row.
// Returns array('id','email','role') or null. (authMiddleware.ts port.)
// ---------------------------------------------------------------------------
$GLOBALS['_ANI_USER'] = null;
$GLOBALS['_ANI_USER_DONE'] = false;

function current_user() {
    if ($GLOBALS['_ANI_USER_DONE']) return $GLOBALS['_ANI_USER'];
    $GLOBALS['_ANI_USER_DONE'] = true;
    $GLOBALS['_ANI_USER'] = null;
    $hdr = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
    if ($hdr === '') {
        // Some CGI/FastCGI frontends expose the header under alternate names.
        if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $hdr = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        elseif (isset($_SERVER['CGI_HTTP_AUTHORIZATION'])) $hdr = $_SERVER['CGI_HTTP_AUTHORIZATION'];
        elseif (isset($_SERVER['HTTP_X_AUTH_TOKEN'])) $hdr = 'Bearer ' . $_SERVER['HTTP_X_AUTH_TOKEN'];
    }
    if ($hdr === '' && function_exists('apache_request_headers')) {
        // Some CGI setups expose it under a different casing.
        $h = apache_request_headers();
        if (is_array($h) && isset($h['Authorization'])) $hdr = $h['Authorization'];
        elseif (is_array($h) && isset($h['authorization'])) $hdr = $h['authorization'];
    }
    if (strpos($hdr, 'Bearer ') !== 0) return null;
    $token = trim(substr($hdr, 7));
    if ($token === '') return null;
    $payload = jwt_verify_token($token);
    if ($payload === null) return null;
    if (isset($payload['sid']) && !session_valid($payload['sid'])) return null;
    if (empty($payload['sub'])) return null;
    $row = db_one('SELECT * FROM users WHERE id = ?', array($payload['sub']));
    if ($row === null) return null;
    $role = $row['role'];
    if ($role === null || $role === '') $role = isset($payload['role']) ? $payload['role'] : 'user';
    $GLOBALS['_ANI_USER'] = array('id' => $row['id'], 'email' => $row['email'], 'role' => $role);
    return $GLOBALS['_ANI_USER'];
}

function require_auth() {
    $u = current_user();
    if ($u === null) err_out(401, 'Unauthorized', 'Sign in required.');
    return $u;
}

function require_admin() {
    $u = current_user();
    if ($u === null) err_out(401, 'Unauthorized', 'Sign in required.');
    if ($u['role'] !== 'admin') err_out(403, 'Forbidden', 'Admin access required.');
    return $u;
}

// ---------------------------------------------------------------------------
// Rate limiting — rate_buckets table (survives restarts; the Node server
// uses an in-memory Map with the same limits: 120/min default, 30/min AI).
// v12 NAS: RFC1918/ULA clients (the LAN this box lives on) skip the counter
// entirely — the old INSERT..ON CONFLICT + SELECT burned ONE SQLite WAL
// write transaction on EVERY /api request, which is pure flash wear and CPU
// for a single-user box behind NAT. Public-internet clients (if the box is
// ever exposed) still get the full DB-backed limiter.
// ---------------------------------------------------------------------------
function an_is_private_ip($ip) {
    if (!is_string($ip) || $ip === '' || $ip === 'unknown') return false;
    // IPv6 loopback, link-local and unique-local ranges.
    if ($ip === '::1') return true;
    $ip6 = strtolower($ip);
    if (strpos($ip6, 'fc') === 0 || strpos($ip6, 'fd') === 0 || strpos($ip6, 'fe80') === 0) return true;
    // IPv4 RFC1918 + loopback (IPv4-mapped IPv6 too, e.g. ::ffff:192.168.1.4).
    if (strpos($ip6, '::ffff:') === 0) $ip = substr($ip6, 7);
    $long = ip2long($ip);
    if ($long === false) return false;
    return ($long & 0xFF000000) === 0x0A000000    // 10.0.0.0/8
        || ($long & 0xFFF00000) === 0xAC100000    // 172.16.0.0/12
        || ($long & 0xFFFF0000) === 0xC0A80000    // 192.168.0.0/16
        || ($long & 0xFF000000) === 0x7F000000;   // 127.0.0.0/8
}

function rate_limit($maxPerMinute) {
    // /health bypasses (probe-friendly, same as the Go port).
    $path = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
    if ($path === '/health') return;
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    if (an_is_private_ip($ip)) return;
    $window = (int)floor(now_ms() / 60000); // minute window
    $bucketKey = $ip . ':' . an_path_bucket() . ':' . $window;
    try {
        $now = now_ms();
        $resetAt = ($window + 1) * 60000;
        db_run('INSERT INTO rate_buckets (bucket_key, count, reset_at) VALUES (?, 1, ?)
                ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1',
            array($bucketKey, $resetAt));
        $row = db_one('SELECT count, reset_at FROM rate_buckets WHERE bucket_key = ?', array($bucketKey));
        // Lazy GC (LAN requests skip this path entirely — GC lives in
        // an_lazy_gc() on db() boot now).
        if (mt_rand(1, 100) === 1) {
            db_run('DELETE FROM rate_buckets WHERE reset_at <= ?', array($now));
        }
        if ($row !== null && (int)$row['count'] > $maxPerMinute) {
            $retry = max(1, (int)ceil(((int)$row['reset_at'] - $now) / 1000));
            header('Retry-After: ' . $retry);
            json_out(array('error' => 'Too many requests. Slow down.'), 429);
        }
    } catch (Exception $e) {
        // Rate limiting must never break the request path.
    }
}

function an_path_bucket() {
    $path = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
    $parts = explode('?', $path, 2);
    $segs = explode('/', trim($parts[0], '/'));
    $take = array_slice($segs, 0, 3);
    return implode('/', $take);
}

// ---------------------------------------------------------------------------
// HTTP helpers (cURL — module verified present on the MBL).
// FIX: requests are now DIRECT-first with the (optional) proxy as a fallback.
// Previously EVERY http(s) URL was forced through a third-party Cloudflare
// Worker — a single point of failure for the stream auditor, scrapers and all
// metadata lookups. With ANISYNC_HTTP_PROXY empty (default) no proxy is used
// at all; set it in config.php only if your host blocks outbound traffic.
// TLS: certs are verified by default; on certificate failures (old NAS CA
// bundles) the request is retried once unverified. ANISYNC_INSECURE_TLS=true
// skips verification entirely (legacy MBL builds).
// ---------------------------------------------------------------------------
$GLOBALS['_ANI_CURL'] = null;

/** Core single request. $opts: method, headers(array), body, timeout, form, useragent */
function an_curl_core($url, $opts) {
    $ch = curl_init($url);
    $method = isset($opts['method']) ? $opts['method'] : 'GET';
    $headers = isset($opts['headers']) ? $opts['headers'] : array();
    $timeout = isset($opts['timeout']) ? $opts['timeout'] : 10;
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_USERAGENT,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    if (isset($opts['useragent'])) curl_setopt($ch, CURLOPT_USERAGENT, $opts['useragent']);
    if (!empty($headers)) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $verifyTls = !ANISYNC_INSECURE_TLS;
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $verifyTls);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $verifyTls ? 2 : 0);
    if ($method !== 'GET') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if (isset($opts['form'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($opts['form']));
        } elseif (isset($opts['body'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
        }
    }
    $body = curl_exec($ch);
    if ($body === false) {
        $errNo  = (int)curl_errno($ch);
        $errMsg = curl_error($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        // 60 = SSL cert problem, 59 = bad cipher suite, 35 = TLS handshake
        // failure, 77 = CA file unreadable — typical of ancient CA bundles.
        // Retry once without verification (the old build skipped verification
        // unconditionally; now it is only a fallback).
        if ($verifyTls && in_array($errNo, array(35, 59, 60, 77), true)) {
            $r = an_curl_insecure($url, $opts);
            if ($r !== null) return $r;
        }
        return array('ok' => false, 'status' => $status, 'body' => '', 'error' => "curl({$errNo}) {$errMsg}");
    }
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return array('ok' => ($status >= 200 && $status < 300), 'status' => $status, 'body' => (string)$body, 'error' => '');
}

/** Same as an_curl_core but with TLS verification disabled. Returns null on hard failure. */
function an_curl_insecure($url, $opts) {
    $ch = curl_init($url);
    $method = isset($opts['method']) ? $opts['method'] : 'GET';
    $timeout = isset($opts['timeout']) ? $opts['timeout'] : 10;
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_USERAGENT,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    if (isset($opts['useragent'])) curl_setopt($ch, CURLOPT_USERAGENT, $opts['useragent']);
    if (!empty($opts['headers'])) curl_setopt($ch, CURLOPT_HTTPHEADER, $opts['headers']);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    if ($method !== 'GET') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if (isset($opts['form'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($opts['form']));
        } elseif (isset($opts['body'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
        }
    }
    $body = curl_exec($ch);
    if ($body === false) { curl_close($ch); return null; }
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return array('ok' => ($status >= 200 && $status < 300), 'status' => $status, 'body' => (string)$body, 'error' => '');
}

/** Public entry: direct first, optional proxy fallback (see config.php). */
function an_curl($url, $opts) {
    if (strpos($url, 'http') === 0) {
        $r = an_curl_core($url, $opts);
        if ($r['ok']) return $r;
        // A non-zero status (or non-empty body) means the host actually
        // answered — do not retry through the proxy in that case.
        if ($r['status'] > 0 || $r['body'] !== '') return $r;
        if (ANISYNC_HTTP_PROXY !== '') {
            $proxyUrl = ANISYNC_HTTP_PROXY . (strpos(ANISYNC_HTTP_PROXY, '?') === false ? '?url=' : '&url=') . urlencode($url);
            $rp = an_curl_core($proxyUrl, $opts);
            if ($rp['ok'] || $rp['status'] > 0) return $rp;
        }
        return $r;
    }
    return an_curl_core($url, $opts);
}

function http_get_json($url, $timeout, $useragent) {
    $r = an_curl($url, array('timeout' => $timeout, 'useragent' => $useragent));
    if (!$r['ok']) return null;
    $d = json_decode($r['body'], true);
    return $d;
}

function http_get_html($url, $timeout) {
    $r = an_curl($url, array('timeout' => $timeout));
    return $r['ok'] ? $r['body'] : '';
}

/** Parallel GET via curl_multi (PHP 5.3 compatible). Returns array of results.
 * FIX: no more forced proxy — direct requests (used by the stream auditor's
 * verify-batch). TLS verification follows the same rules as an_curl(). */
function an_curl_multi($urls, $timeout) {
    $mh = curl_multi_init();
    $handles = array();
    $results = array_fill(0, count($urls), array('ok' => false, 'status' => 0, 'body' => ''));
    $i = 0;
    foreach ($urls as $idx => $url) {
    $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        $verifyTls = !ANISYNC_INSECURE_TLS;
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $verifyTls);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $verifyTls ? 2 : 0);
        curl_multi_add_handle($mh, $ch);
        $handles[] = array($ch, $idx);
        $i++;
    }
    $active = null;
    do {
        $mrc = curl_multi_exec($mh, $active);
        if ($active) curl_multi_select($mh, 0.2);
    } while ($active && $mrc == CURLM_OK);
    foreach ($handles as $h) {
        list($ch, $idx) = $h;
        $body = curl_multi_getcontent($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $results[$idx] = array('ok' => ($status >= 200 && $status < 300), 'status' => $status, 'body' => $body === null ? '' : $body);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $results;
}

/** v5: parallel GET/POST via curl_multi. Each request is
 * array('url' =>, 'method' => 'GET'|'POST', 'body' => raw string,
 *        'headers' => array, 'useragent' => string). Returns results in the
 * SAME ORDER as the input array with array('ok','status','body'). Used by the
 * embed health prober (oEmbed GETs + InnerTube player POSTs together). */
function an_curl_multi_generic($requests, $timeout = 8) {
    $mh = curl_multi_init();
    $handles = array();
    $results = array_fill(0, count($requests), array('ok' => false, 'status' => 0, 'body' => ''));
    $i = 0;
    foreach ($requests as $idx => $req) {
        $ch = curl_init($req['url']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_USERAGENT,
            isset($req['useragent']) ? $req['useragent']
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        if (!empty($req['headers'])) curl_setopt($ch, CURLOPT_HTTPHEADER, $req['headers']);
        $verifyTls = !ANISYNC_INSECURE_TLS;
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $verifyTls);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $verifyTls ? 2 : 0);
        if (isset($req['method']) && $req['method'] !== 'GET') {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $req['method']);
            if (isset($req['body'])) curl_setopt($ch, CURLOPT_POSTFIELDS, $req['body']);
        }
        curl_multi_add_handle($mh, $ch);
        $handles[] = array($ch, $idx);
        $i++;
    }
    $active = null;
    do {
        $mrc = curl_multi_exec($mh, $active);
        if ($active) curl_multi_select($mh, 0.2);
    } while ($active && $mrc == CURLM_OK);
    foreach ($handles as $h) {
        list($ch, $idx) = $h;
        $body = curl_multi_getcontent($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $results[$idx] = array('ok' => ($status >= 200 && $status < 300), 'status' => $status, 'body' => $body === null ? '' : (string)$body);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $results;
}

// ---------------------------------------------------------------------------
// api_cache-backed TTL cache (replaces the Node in-memory LRU caches).
// ---------------------------------------------------------------------------
function cache_get($key) {
    try {
        $row = db_one('SELECT response_json, cached_at, ttl_ms FROM api_cache WHERE key = ?', array($key));
        if ($row === null) return null;
        if (((int)$row['cached_at'] + (int)$row['ttl_ms']) <= now_ms()) return null;
        return safe_json_parse($row['response_json'], null);
    } catch (Exception $e) { return null; }
}

function cache_set($key, $value, $ttlMs) {
    try {
        db_run('INSERT INTO api_cache (key, response_json, cached_at, ttl_ms) VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET response_json = excluded.response_json, cached_at = excluded.cached_at, ttl_ms = excluded.ttl_ms',
            array($key, json_encode($value), now_ms(), $ttlMs));
    } catch (Exception $e) { /* cache failures are non-fatal */ }
}

// ---------------------------------------------------------------------------
// Gemini REST helper (replaces @google/genai SDK). Key-gated; falls back to
// the caller's deterministic fallback on any failure. Quota flag persists
// for 1h in a small state file (PHP is shared-nothing).
// ---------------------------------------------------------------------------
function gemini_quota_exceeded() {
    $f = dirname(ANISYNC_DB_PATH) . '/gemini_quota.flag';
    if (!is_file($f)) return false;
    $ts = (int)@file_get_contents($f);
    if ($ts === 0) return false;
    if ((now_ms() - $ts) > 3600000) { @unlink($f); return false; } // 1h reset
    return true;
}

function gemini_mark_quota() {
    $f = dirname(ANISYNC_DB_PATH) . '/gemini_quota.flag';
    @file_put_contents($f, (string)now_ms());
}

/** Generate content; returns parsed array/object or null. $schema is a JSON-schema array. */
function gemini_generate($prompt, $schema, $temperature) {
    if (GEMINI_API_KEY === '' ) return null;
    if (gemini_quota_exceeded()) return null;
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . GEMINI_MODEL . ':generateContent?key=' . GEMINI_API_KEY;
    $gen = array('responseMimeType' => 'application/json');
    if ($schema !== null) $gen['responseSchema'] = $schema;
    if ($temperature !== null) $gen['temperature'] = $temperature;
    $payload = array(
        'contents' => array(array('parts' => array(array('text' => $prompt)))),
        'generationConfig' => $gen,
    );
    $r = an_curl($url, array(
        'method' => 'POST',
        'headers' => array('Content-Type: application/json'),
        'body' => json_encode($payload),
        'timeout' => 20,
        'useragent' => 'ANISYNC/1.0',
    ));
    if (!$r['ok']) {
        if ($r['status'] === 429 || strpos($r['body'], 'quota') !== false || strpos($r['body'], 'RESOURCE_EXHAUSTED') !== false) {
            gemini_mark_quota();
        }
        return null;
    }
    $data = safe_json_parse($r['body'], null);
    if ($data === null) return null;
    $text = '';
    if (isset($data['candidates'][0]['content']['parts'][0]['text'])) {
        $text = (string)$data['candidates'][0]['content']['parts'][0]['text'];
    }
    $text = str_replace('```json', '', $text);
    $text = str_replace('```', '', $text);
    $text = trim($text);
    $parsed = json_decode($text, true);
    if ($parsed === null) return null;
    return $parsed;
}

// ---------------------------------------------------------------------------
// Prompt sanitization (server.ts port)
// ---------------------------------------------------------------------------
$GLOBALS['_ANI_INJECT'] = array(
    '/ignore (?:all )?(?:previous|prior) instructions/i',
    '/you are (?:now )?(?:a|an) (?:different|new)/i',
    '/system prompt/i',
    '/<\/?(?:system|assistant|user)>/i',
);

function sanitize_for_prompt($input, $maxLen) {
    if ($input === null) return '';
    $s = is_string($input) ? $input : json_encode($input);
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s);
    foreach ($GLOBALS['_ANI_INJECT'] as $p) $s = preg_replace($p, '[filtered]', $s);
    if (strlen($s) > $maxLen) $s = substr($s, 0, $maxLen) . '…';
    return $s;
}

function sanitize_array_for_prompt($arr, $maxItems, $itemMaxLen) {
    if (!is_array($arr)) return array();
    $out = array();
    $slice = array_slice(array_values($arr), 0, $maxItems);
    foreach ($slice as $item) {
        if (is_string($item)) { $out[] = sanitize_for_prompt($item, $itemMaxLen); }
        elseif (is_array($item)) {
            $o = array();
            foreach ($item as $k => $v) {
                $o[$k] = is_string($v) ? sanitize_for_prompt($v, $itemMaxLen) : $v;
            }
            $out[] = $o;
        } else { $out[] = $item; }
    }
    return $out;
}

// ---------------------------------------------------------------------------
// Anime-name search variants (server.ts getSearchVariants port)
// ---------------------------------------------------------------------------
function clean_search_query($query) {
    if (!$query) return '';
    $q = preg_replace('/[ä]/i', 'a', (string)$query);
    $q = preg_replace('/[ö]/i', 'o', $q);
    $q = preg_replace('/[ü]/i', 'u', $q);
    $q = preg_replace('/[éêè]/i', 'e', $q);
    $q = preg_replace('/[^\x00-\x7F]/', ' ', $q);
    $q = preg_replace('/[?.:;!]/', ' ', $q);
    $q = preg_replace('/\s+/', ' ', $q);
    return trim($q);
}

function get_search_variants($name) {
    $cleaned = clean_search_query($name);
    $variants = array($name, $cleaned);
    $variants[] = trim(preg_replace('/Season \d+ Part \d+/i', '', $name));
    $variants[] = trim(preg_replace('/Season \d+/i', '', $name));
    $variants[] = trim(preg_replace('/[0-9]+$/', '', $name));
    $parts = preg_split('/:|\(|-/', $name);
    $variants[] = trim($parts[0]);
    $words = preg_split('/\s+/', $cleaned);
    $variants[] = implode(' ', array_slice($words, 0, 4));
    $seen = array();
    $out = array();
    foreach ($variants as $v) {
        $v = trim((string)$v);
        if ($v !== '' && strlen($v) > 3 && !isset($seen[$v])) { $seen[$v] = true; $out[] = $v; }
    }
    return $out;
}
