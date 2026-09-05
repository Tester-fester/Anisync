<?php
// AniSync SQLite Stream Auditor & Permanent DB Fixer (PHP 5.3+ Compatible)
//
// FIX: the DB path is no longer hardcoded to /DataVolume/anisync/data/
// anisync.sqlite — the script now boots the API's lib.php (which honours
// public/api/config.php → ANISYNC_DB_PATH) so it works on ANY host, and
// shares the same PDO singleton + schema bootstrap as the web API.
//
// v12: this CLI auditor now uses EXACTLY the same engine as the web Stream
// Auditor — an_embed_probe() (oEmbed + InnerTube + Data API, SQLite-cached)
// for verification and an_resolve_candidates() (points system + verified
// embeddability) for repairs. The old body used a bare oEmbed check and
// picked the FIRST regex-matched videoId from a search results page, which
// is precisely the "broken link selection" the v12 round fixed everywhere
// else. Repairs only ever save probe-verified, above-floor candidates.
//
// Usage:
//   php bulk_stream_repair.php            # audit + auto-repair dead streams
//   php bulk_stream_repair.php --dry-run  # audit only, no writes

$APP = __DIR__ . '/public/api';
if (!is_file($APP . '/lib.php')) {
    // Allow running from inside public/ as well.
    $alt = dirname(__FILE__) . '/api';
    if (is_file($alt . '/lib.php')) { $APP = $alt; }
    else { die("[ERROR] Could not locate public/api/lib.php — run this from the project root.\n"); }
}
require_once $APP . '/lib.php';
require_once $APP . '/routes_meta.php';   // v12: an_embed_probe + an_resolve_candidates

@set_time_limit(0);   // CLI sweep over the whole library

$dryRun = false;
foreach (array_slice(isset($_SERVER['argv']) ? $_SERVER['argv'] : array(), 1) as $a) {
    if ($a === '--dry-run') $dryRun = true;
}

echo "====================================================\n";
echo "   ANISYNC SQLITE STREAM AUDITOR & AUTO-SAVER (v12) \n";
echo "====================================================\n\n";
echo "[*] Database: " . ANISYNC_DB_PATH . "\n";
if (!file_exists(ANISYNC_DB_PATH)) {
    echo "[*] Database file not found — the shared db() bootstrap will create it.\n";
}
if ($dryRun) echo "[*] DRY RUN — no writes will be made.\n\n";

// Open through the shared singleton (creates schema if missing).
$pdo = db();

// v12: verify in CHUNKS via the multi-signal prober (curl_multi + cache),
// not one oEmbed curl per track.
$verify_chunk = 20;
$repair_chunk = 8;

// 2. Discover track table structure
$tables_stmt = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tracks', 'track')");
$table_name = $tables_stmt->fetchColumn();

if (!$table_name) {
    $t_stmt = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    $table_name = $t_stmt->fetchColumn();
}

if (!$table_name) {
    die("[ERROR] No tracks table found in SQLite database.\n");
}

echo "[*] Using table: " . $table_name . "\n";

// Get columns (PHP 5.4-safe loop instead of array_column)
$col_stmt = $pdo->query("PRAGMA table_info(" . $table_name . ")");
$cols = $col_stmt->fetchAll(PDO::FETCH_ASSOC);
$col_names = array();
foreach ($cols as $col) {
    if (isset($col['name'])) {
        $col_names[] = $col['name'];
    }
}

$id_col = in_array('id', $col_names) ? 'id' : $col_names[0];
$yt_col = in_array('youtube_id', $col_names) ? 'youtube_id' : (in_array('youtubeId', $col_names) ? 'youtubeId' : 'youtube_id');
$title_col = in_array('title', $col_names) ? 'title' : (in_array('name', $col_names) ? 'name' : 'title');
$artist_col = in_array('artist', $col_names) ? 'artist' : 'artist';
$anime_col = in_array('anime_name', $col_names) ? 'anime_name' : '';
$type_col = in_array('type', $col_names) ? 'type' : '';

echo "[*] ID column: " . $id_col . " | Video column: " . $yt_col . "\n\n";

// 3. Fetch all tracks
$stmt = $pdo->query("SELECT * FROM " . $table_name);
$tracks = $stmt->fetchAll(PDO::FETCH_ASSOC);

$updated_count = 0;
$verified_count = 0;
$failed_count = 0;

$update_stmt = $pdo->prepare("UPDATE " . $table_name . " SET " . $yt_col . " = :yt WHERE " . $id_col . " = :id");

$total = count($tracks);
echo "[*] Auditing " . $total . " tracks with the v12 multi-signal prober...\n\n";

for ($base = 0; $base < $total; $base += $verify_chunk) {
    $chunk = array_slice($tracks, $base, $verify_chunk);

    // ---- Phase 1: batched verification (probe cache makes repeat sweeps fast)
    $ids = array();
    foreach ($chunk as $track) {
        $yt = isset($track[$yt_col]) ? $track[$yt_col] : '';
        if (is_string($yt) && preg_match('/^[A-Za-z0-9_-]{11}$/', $yt)) $ids[] = $yt;
    }
    $verdicts = an_embed_probe($ids);

    $deadTracks = array();
    foreach ($chunk as $track) {
        $tid = $track[$id_col];
        $title = isset($track[$title_col]) ? $track[$title_col] : 'Unknown';
        $current_yt = isset($track[$yt_col]) ? $track[$yt_col] : '';
        echo "Auditing [" . $tid . "] " . $title . " ... ";

        // v10 title-purification: an alive track whose own TITLE marks it as a
        // cover/remix/TV-size is still routed to repair.
        $titleTier = an_derivative_hit($title);

        $v = isset($verdicts[$current_yt]) ? $verdicts[$current_yt] : null;
        $state = ($v !== null && isset($v['state'])) ? $v['state'] : 'unknown';
        $alive = in_array($state, array('ok', 'unknown'), true);

        if ($alive && $titleTier === '') {
            echo "[ALIVE via " . $state . "]\n";
            $verified_count++;
        } else {
            echo "[" . ($titleTier !== '' ? 'NON-ORIGINAL' : 'DEAD (' . $state . ')') . "] -> queueing repair... ";
            $deadTracks[] = $track;
            echo "\n";
        }
    }

    // ---- Phase 2: repairs in small batches (points system + verification)
    for ($r = 0; $r < count($deadTracks); $r += $repair_chunk) {
        $repairSet = array_slice($deadTracks, $r, $repair_chunk);

        // Exclusions: every OTHER track's current id (reuse prevention).
        $excluded = array();
        foreach ($tracks as $t2) {
            $yt2 = isset($t2[$yt_col]) ? $t2[$yt_col] : '';
            if (is_string($yt2) && $yt2 !== '') $excluded[] = $yt2;
        }

        foreach ($repairSet as $track) {
            $tid = $track[$id_col];
            $title = isset($track[$title_col]) ? $track[$title_col] : 'Unknown';
            $artist = isset($track[$artist_col]) ? $track[$artist_col] : '';
            $anime = $anime_col !== '' && isset($track[$anime_col]) ? $track[$anime_col] : '';
            $type = $type_col !== '' && isset($track[$type_col]) ? $track[$type_col] : 'OP';
            $current_yt = isset($track[$yt_col]) ? $track[$yt_col] : '';

            $cands = an_resolve_candidates($title, $artist, $anime, $type, $excluded, 3);
            if (count($cands) === 0) {
                echo "  [FAILED TO MATCH] " . $title . " — nothing above the points floor / verified\n";
                $failed_count++;
                continue;
            }
            $best = $cands[0];
            $receipt = (is_array($best['points']) && count($best['points']) > 0) ? implode(', ', $best['points']) : 'no receipt';
            if ($dryRun) {
                echo "  [WOULD FIX: " . $best['videoId'] . "] " . $title . "\n" .
                     "      -> " . $best['title'] . " | score " . $best['score'] . " | " . $receipt . "\n";
                $updated_count++;
            } else {
                $update_stmt->execute(array(':yt' => $best['videoId'], ':id' => $tid));
                // Keep the exclusion list current so the next repair can't reuse it.
                $excluded[] = $best['videoId'];
                echo "  [FIXED & SAVED: " . $best['videoId'] . "] " . $title . "\n" .
                     "      -> " . $best['title'] . " | score " . $best['score'] . " | " . $receipt . "\n";
                $updated_count++;
            }
        }
    }
}

echo "\n----------------------------------------------------\n";
echo "AUDIT SUMMARY: " . $verified_count . " Alive | " . $updated_count . ($dryRun ? " Would replace" : " Replaced & Saved to SQLite") . " | " . $failed_count . " Unresolved\n";
echo "====================================================\n";
