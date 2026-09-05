<?php

if (!function_exists("get_json_body")) {
    function get_json_body() {
        // v12: delegates to the shared, single-read body cache (an_raw_input).
        $raw = an_raw_input();
        $d = json_decode($raw, true);
        return is_array($d) ? $d : array();
    }
}

/**
 * routes_db.php — /api/db/* endpoints (dataRoutes.ts port, all 42 routes).
 *
 * Response shapes are camelCase (client-facing); DB rows are snake_case.
 * rowToTrack / rowToHistory / rowToProposal / rowToTournament / rowToReview /
 * rowToArtist / rowToPokedex / rowToUser mirror the TS helpers exactly.
 */

// ---------------------------------------------------------------------------
// Row → client shape helpers
// ---------------------------------------------------------------------------
function row_to_track($row) {
    $out = array(
        'id' => $row['id'],
        'title' => $row['title'],
        'artist' => $row['artist'],
        'animeName' => $row['anime_name'],
        'type' => $row['type'],
        'youtubeId' => $row['youtube_id'],
        'elo' => (int)$row['elo'],
        'matchesPlayed' => (int)$row['matches_played'],
        'wins' => (int)$row['wins'],
        'losses' => (int)$row['losses'],
        'draws' => (int)$row['draws'],
        'addedByUser' => ((int)$row['added_by_user']) === 1,
    );
    if ($row['anime_part'] !== null && $row['anime_part'] !== '') $out['animePart'] = $row['anime_part'];
    $tags = safe_json_parse($row['tags_json'], null);
    if ($tags !== null) $out['tags'] = $tags;
    if ($row['custom_image_url'] !== null && $row['custom_image_url'] !== '') $out['customImageUrl'] = $row['custom_image_url'];
    return $out;
}

function row_to_history($row) {
    $a = safe_json_parse($row['track_a_json'], array());
    $b = safe_json_parse($row['track_b_json'], array());
    return array(
        'id' => $row['id'],
        'timestamp' => ms_to_iso($row['timestamp'] !== null ? (int)$row['timestamp'] : now_ms()),
        'trackA' => array(
            'id' => $row['track_a_id'],
            'title' => isset($a['title']) ? $a['title'] : '',
            'animeName' => isset($a['animeName']) ? $a['animeName'] : (isset($a['anime_name']) ? $a['anime_name'] : ''),
            'eloBefore' => isset($a['eloBefore']) ? $a['eloBefore'] : (isset($a['elo_before']) ? $a['elo_before'] : 0),
            'eloAfter' => isset($a['eloAfter']) ? $a['eloAfter'] : (isset($a['elo_after']) ? $a['elo_after'] : 0),
        ),
        'trackB' => array(
            'id' => $row['track_b_id'],
            'title' => isset($b['title']) ? $b['title'] : '',
            'animeName' => isset($b['animeName']) ? $b['animeName'] : (isset($b['anime_name']) ? $b['anime_name'] : ''),
            'eloBefore' => isset($b['eloBefore']) ? $b['eloBefore'] : (isset($b['elo_before']) ? $b['elo_before'] : 0),
            'eloAfter' => isset($b['eloAfter']) ? $b['eloAfter'] : (isset($b['elo_after']) ? $b['elo_after'] : 0),
        ),
        'winnerId' => $row['winner_id'],
        'source' => $row['source'],
    );
}

function row_to_proposal($row) {
    $td = safe_json_parse($row['track_data_json'], array());
    $out = array(
        'id' => $row['id'],
        'type' => $row['type'],
        'submittedBy' => $row['submitted_by'],
        'submittedAt' => ms_to_iso($row['submitted_at'] !== null ? (int)$row['submitted_at'] : now_ms()),
        'status' => $row['status'],
        'trackData' => array(
            'title' => isset($td['title']) ? $td['title'] : '',
            'artist' => isset($td['artist']) ? $td['artist'] : '',
            'animeName' => isset($td['animeName']) ? $td['animeName'] : (isset($td['anime_name']) ? $td['anime_name'] : ''),
            'type' => isset($td['type']) ? $td['type'] : 'OP',
            'youtubeId' => isset($td['youtubeId']) ? $td['youtubeId'] : (isset($td['youtube_id']) ? $td['youtube_id'] : ''),
        ),
    );
    if (isset($td['customImageUrl'])) $out['trackData']['customImageUrl'] = $td['customImageUrl'];
    elseif (isset($td['custom_image_url'])) $out['trackData']['customImageUrl'] = $td['custom_image_url'];
    if ($row['old_track_id'] !== null) $out['oldTrackId'] = $row['old_track_id'];
    if ($row['proposed_yt_id'] !== null) $out['proposedYtId'] = $row['proposed_yt_id'];
    if ($row['notes'] !== null) $out['notes'] = $row['notes'];
    return $out;
}

function row_to_tournament($row) {
    return array(
        'id' => $row['id'],
        'name' => $row['name'],
        'size' => $row['size'] === null ? 8 : (int)$row['size'],
        'typeFilter' => $row['format'] === null ? '' : $row['format'],
        'currentRound' => (int)$row['current_round'],
        'currentMatchIndex' => (int)$row['current_match_index'],
        'matches' => safe_json_parse($row['matches_json'], array()),
        'status' => $row['status'],
        'isOnline' => ((int)$row['is_online']) === 1,
        'votingDuration' => $row['voting_duration'],
        'matchEndTime' => $row['match_end_time'],
        'createdBy' => $row['created_by'],
        'createdByUsername' => $row['created_by_username'],
        'winnerId' => $row['winner_id'],
        'privacy' => $row['privacy'],
        'lobbyPassword' => $row['lobby_password'],
        'currentlyPlayingId' => $row['currently_playing_id'],
        'historyLog' => safe_json_parse($row['history_log_json'], array()),
    );
}

function row_to_review($row) {
    $out = array(
        'id' => $row['id'],
        'trackId' => $row['track_id'],
        'userId' => $row['user_id'],
        'username' => $row['user_name'],
        'rating' => (int)$row['rating'],
        'comment' => $row['content'],
        'createdAt' => ms_to_iso($row['created_at'] !== null ? (int)$row['created_at'] : now_ms()),
    );
    if ($row['user_avatar'] !== null && $row['user_avatar'] !== '') $out['userPicture'] = $row['user_avatar'];
    if ($row['source'] !== null && $row['source'] !== '') $out['source'] = $row['source'];
    return $out;
}

function row_to_artist($row) {
    $out = array(
        'id' => $row['id'],
        'artistName' => $row['artist_name'],
        'updatedAt' => ms_to_iso($row['updated_at']),
    );
    if ($row['image_url'] !== null) $out['imageUrl'] = $row['image_url'];
    if ($row['bio'] !== null) $out['bio'] = $row['bio'];
    if ($row['birthday'] !== null) $out['birthday'] = $row['birthday'];
    if ($row['website'] !== null) $out['websiteUrl'] = $row['website'];
    if ($row['mal_url'] !== null) $out['malUrl'] = $row['mal_url'];
    return $out;
}

function row_to_pokedex($row) {
    return array(
        'id' => $row['id'],
        'animeName' => $row['anime_name'],
        'description' => $row['description'] === null ? '' : $row['description'],
        'iconType' => $row['icon_type'] === null ? 'emoji' : $row['icon_type'],
        'iconValue' => $row['icon_value'] === null ? '' : $row['icon_value'],
        'visualEffect' => $row['visual_effect'] === null ? 'none' : $row['visual_effect'],
        'requiredTrackIds' => safe_json_parse($row['required_track_ids_json'], array()),
        'createdAt' => ms_to_iso($row['created_at']),
    );
}

function row_to_user($row) {
    $username = $row['display_name'];
    if ($username === null || $username === '') {
        $email = $row['email'];
        $username = ($email !== null && strpos($email, '@') !== false) ? substr($email, 0, strpos($email, '@')) : '';
    }
    $out = array(
        'id' => $row['id'],
        'username' => $username,
        'email' => $row['email'],
        'role' => $row['role'],
        'badges' => safe_json_parse($row['badges_json'], array()),
        'following' => safe_json_parse($row['follows_json'], array()),
        'favoriteTrackIds' => safe_json_parse($row['favorites_json'], array()),
        'customLists' => safe_json_parse($row['custom_lists_json'], array()),
        'createdAt' => ms_to_iso($row['created_at']),
        'updatedAt' => ms_to_iso($row['updated_at']),
    );
    if ($row['avatar_url'] !== null && $row['avatar_url'] !== '') $out['picture'] = $row['avatar_url'];
    $vibe = safe_json_parse($row['vibe_spectrum_json'], null);
    if ($vibe !== null) $out['vibeSpectrum'] = $vibe;
    return $out;
}

/** Shared insert logic for tracks (POST /tracks, /bulk, /seed, /reset). */
function an_insert_track($t, $orIgnore) {
    $animePart = null;
    if (isset($t['animePart']) && $t['animePart'] !== null && $t['animePart'] !== '') $animePart = $t['animePart'];
    $tags = isset($t['tags']) && is_array($t['tags']) ? $t['tags'] : array();
    $img = null;
    if (isset($t['customImageUrl']) && $t['customImageUrl'] !== null && $t['customImageUrl'] !== '') $img = $t['customImageUrl'];
    $sql = ($orIgnore ? 'INSERT OR IGNORE INTO tracks' : 'INSERT INTO tracks') .
        ' (id, title, artist, anime_name, anime_part, type, youtube_id, elo, matches_played, wins, losses, draws, added_by_user, tags_json, custom_image_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    return db_run($sql, array(
        (string)$t['id'],
        (string)$t['title'],
        (string)(isset($t['artist']) && $t['artist'] !== '' ? $t['artist'] : 'Unknown'),
        (string)(isset($t['animeName']) ? $t['animeName'] : ''),
        $animePart,
        (string)(isset($t['type']) && $t['type'] !== '' ? $t['type'] : 'OP'),
        (string)$t['youtubeId'],
        isset($t['elo']) ? (int)$t['elo'] : 1200,
        isset($t['matchesPlayed']) ? (int)$t['matchesPlayed'] : 0,
        isset($t['wins']) ? (int)$t['wins'] : 0,
        isset($t['losses']) ? (int)$t['losses'] : 0,
        isset($t['draws']) ? (int)$t['draws'] : 0,
        (!empty($t['addedByUser'])) ? 1 : 0,
        json_encode($tags),
        $img,
        now_ms(),
    ));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
// FIX LOGIC (why the router changed):
//  1. `db_proposal_status_update` / `db_user_toggle_follow` did not exist
//     (the handlers are named db_proposal_status / db_user_follow) — every
//     proposal approval/rejection and follow toggle crashed with a PHP fatal
//     "Call to undefined function" error. Both are fixed below.
//  2. The React client's POST helper ALWAYS uses POST and ignores the HTTP
//     verb (see apiFetch/Be() in the bundle), so "update track" and "save
//     collectible" requests were falling into the DELETE handlers. For
//     POST /tracks/{id} and POST /pokedex/{id} we now discriminate on the
//     request BODY: a non-empty JSON body = save/update, an empty body =
//     delete (exactly the shapes the client emits).
//  3. GET /users/{id} now returns the profile (was: ran the update handler
//     and replied {ok:true}), GET /artist-profiles/{name} now reads (was:
//     performed a write!).
// ---------------------------------------------------------------------------
function an_request_has_body() {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        // CLI SAPI: php://input is empty — non-blocking stdin check.
        $raw = an_stdin_data_available();
    }
    if ($raw === false) $raw = '';
    $raw = trim((string)$raw);
    if ($raw === '') return false;
    $decoded = json_decode($raw, true);
    return is_array($decoded) && count($decoded) > 0;
}

function route_db($method, $path) {
    $parts = array();
    if ($path !== "") $parts = explode("/", trim($path, "/"));

    $p0 = isset($parts[0]) ? $parts[0] : "";
    $p1 = isset($parts[1]) ? $parts[1] : "";
    $p2 = isset($parts[2]) ? $parts[2] : "";

    if ($p0 === "tracks") {
        if ($p1 === "seed") { return db_tracks_seed(); }                 // public, idempotent (empty-only)
        if ($p1 === "reset") { require_admin(); return db_tracks_reset(); }
        if ($p1 === "bulk") { require_admin(); return db_tracks_bulk(); }
        if ($p1 === "bulk-update") { require_auth(); return db_tracks_bulk_update(); }
        if ($p1 === "batch-delete") { require_admin(); return db_tracks_batch_delete(); }
        if ($p1 === "batch-anime-name") { require_admin(); return db_tracks_batch_anime_name(); }

        if ($p2 === "yt") { require_auth(); return db_track_update_yt($p1); }
        if ($p2 === "tags") { require_auth(); return db_track_update_tags($p1); }
        if ($p2 === "image") { require_auth(); return db_track_update_image($p1); }
        if ($p2 === "anime-name") { require_auth(); return db_track_update_anime_name($p1); }

        if ($p1 !== "") {
            if ($method === "GET") return db_track_get($p1);
            // FIX: the client's POST helper is used for BOTH update and
            // delete. Body present → update; body absent → delete.
            if ($method === "POST") {
                if (an_request_has_body()) return db_track_update($p1);
                return db_track_delete($p1);
            }
            return db_track_update($p1);
        }

        if ($method === "GET") return db_tracks_list();
        require_auth();
        return db_track_create();
    }

    if ($p0 === "match-vote") { require_auth(); return db_match_vote(); }
    if ($p0 === "match-votes" && $p1 === "batch") { require_auth(); return db_match_vote_batch(); }
    if ($p0 === "history") return db_history_list();

    if ($p0 === "proposals") {
        if ($p2 === "status") { require_admin(); return db_proposal_status($p1); } // FIX: was db_proposal_status_update (undefined!)
        if ($p1 === "batch-delete") { require_admin(); return db_proposals_batch_delete(); }
        if ($p1 !== "") return db_proposal_get($p1);
        if ($method === "POST") { require_auth(); return db_proposal_create(); }
        require_auth();
        return db_proposals_list();
    }

    if ($p0 === "tournaments") {
        if ($p1 !== "") {
            if ($method === "POST") { require_auth(); return db_tournament_delete($p1); }
            return db_tournament_get($p1);
        }
        if ($method === "POST") { require_auth(); return db_tournament_upsert(); }
        return db_tournaments_list();
    }

    if ($p0 === "reviews") {
        if ($p1 === "check-completist") return db_review_check_completist();
        if ($p1 !== "") {
            if ($method === "POST") return db_review_delete($p1);
            return db_review_get($p1);
        }
        if ($method === "POST") return db_review_create();
        return db_reviews_list();
    }

    if ($p0 === "pokedex") {
        if ($p1 !== "") {
            if ($method === "GET") return db_pokedex_get($p1);
            // FIX: POST + body = save collectible, POST without body = delete
            // (was: every POST deleted — saving a collectible erased it).
            if ($method === "POST" && an_request_has_body()) { require_admin(); return db_pokedex_put($p1); }
            require_admin();
            return db_pokedex_delete($p1);
        }
        return db_pokedex_list();
    }

    if ($p0 === "artist-profiles" || $p0 === "artists") {
        if ($p1 !== "") {
            if ($method === "GET") return db_artist_get($p1);  // FIX: GET used to trigger a write
            require_auth();
            return db_artist_put($p1);
        }
        return db_artist_profiles_list();
    }

    if ($p0 === "users") {
        if ($p2 === "follow") { require_auth(); return db_user_follow($p1); } // FIX: was db_user_toggle_follow (undefined!)
        if ($p1 !== "") {
            if ($method === "GET") return db_user_get($p1);   // FIX: GET used to run the update handler
            require_auth();
            return db_user_update($p1);
        }
        return db_users_list();
    }

    if ($p0 === "franchise-cache") {
        if ($method === "POST" || $method === "PUT") { require_auth(); return db_franchise_cache_put($p1); }
        return db_franchise_cache_get($p1);
    }

    err_out(404, "Not found", "Unknown db endpoint: " . $path);
}

// ---------------------------------------------------------------------------
// TRACKS handlers
// ---------------------------------------------------------------------------
function db_tracks_list() {
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 500;
    if ($limit <= 0) $limit = 500;
    if ($limit > 5000) $limit = 5000;
    // v12.1 NAS: ETag revalidation via the shared helper — the SPA polls
    // /api/db/tracks on every tab mount; within max-age the browser answers
    // from its own cache (no request at all), after that a 304 costs one
    // aggregate query instead of a full 43 KB re-download + re-parse.
    an_list_version_etag(
        'tracks-' . $limit,
        'SELECT COUNT(*) AS c, COALESCE(SUM(matches_played + wins + losses + draws), 0) AS s, COALESCE(MAX(rowid), 0) AS m FROM tracks',
        array(),
        30 // votes reorder tracks — short shelf life
    );
    try {
        $rows = db_all('SELECT * FROM tracks ORDER BY matches_played DESC LIMIT ?', array($limit));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_track($r);
    json_out($out, 200);
}

function db_track_get($id) {
    $row = db_one('SELECT * FROM tracks WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Track not found');
    json_out(row_to_track($row), 200);
}

function db_track_create() {
    $t = json_body();
    if (!$t || empty($t['id']) || empty($t['title']) || empty($t['youtubeId'])) {
        err_out(400, 'Bad request', 'id, title, youtubeId required');
    }
    try {
        an_insert_track($t, false);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) err_out(409, 'Conflict', 'Track id exists');
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'id' => $t['id']), 201);
}

function db_track_update($id) {
    $patch = json_body();
    $cur = db_one('SELECT id FROM tracks WHERE id = ?', array($id));
    if ($cur === null) err_out(404, 'Not found', 'Track not found');
    $allowed = array(
        'title' => 'title', 'artist' => 'artist', 'animeName' => 'anime_name',
        'animePart' => 'anime_part', 'type' => 'type', 'youtubeId' => 'youtube_id',
        'elo' => 'elo', 'matchesPlayed' => 'matches_played', 'wins' => 'wins',
        'losses' => 'losses', 'draws' => 'draws', 'addedByUser' => 'added_by_user',
        'customImageUrl' => 'custom_image_url',
    );
    $sets = array(); $vals = array();
    foreach ($allowed as $camel => $snake) {
        if (array_key_exists($camel, $patch)) {
            $v = $patch[$camel];
            if ($camel === 'addedByUser') $v = $v ? 1 : 0;
            $sets[] = $snake . ' = ?';
            $vals[] = $v;
        }
    }
    if (array_key_exists('tags', $patch)) {
        $sets[] = 'tags_json = ?';
        $vals[] = json_encode(is_array($patch['tags']) ? $patch['tags'] : array());
    }
    if (count($sets) === 0) json_out(array('ok' => true, 'updated' => 0), 200);
    $vals[] = $id;
    try {
        db_run('UPDATE tracks SET ' . implode(', ', $sets) . ' WHERE id = ?', $vals);
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true, 'updated' => count($sets)), 200);
}

function db_track_update_yt($id) {
    // v12: uses the shared cached body reader (an_raw_input) instead of a
    // private triple-fallback read of php://input.
    $body = json_decode(an_raw_input(), true);
    if (!is_array($body)) $body = array();

    $yt = isset($body["youtubeId"]) ? trim($body["youtubeId"]) : (isset($body["youtube_id"]) ? trim($body["youtube_id"]) : "");

    if ($id === "" || $yt === "") {
        err_out(400, "Bad request", "youtubeId required");
    }

    // FIX: previously opened its own PDO connection to the HARDCODED NAS path
    // /DataVolume/anisync/data/anisync.sqlite — the stream auditor's "save
    // repaired video id" call failed everywhere except that exact NAS layout.
    // Now uses the shared db() singleton (respects ANISYNC_DB_PATH).
    try {
        $stmt = db()->prepare("UPDATE tracks SET youtube_id = :yt WHERE id = :id");
        $stmt->execute(array(":yt" => $yt, ":id" => $id));

        json_out(array("success" => true, "id" => $id, "youtubeId" => $yt), 200);
    } catch (Exception $e) {
        err_out(500, "Internal", $e->getMessage());
    }
}

function db_track_update_tags($id) {
    $tags = body_get('tags', null);
    if (!is_array($tags)) err_out(400, 'Bad request', 'tags array required');
    $n = db_run('UPDATE tracks SET tags_json = ? WHERE id = ?', array(json_encode($tags), $id));
    if ($n === 0) err_out(404, 'Not found', 'Track not found');
    json_out(array('ok' => true), 200);
}

function db_track_update_image($id) {
    $img = body_get('customImageUrl', null);
    if (!$img) err_out(400, 'Bad request', 'customImageUrl required');
    $n = db_run('UPDATE tracks SET custom_image_url = ? WHERE id = ?', array($img, $id));
    if ($n === 0) err_out(404, 'Not found', 'Track not found');
    json_out(array('ok' => true), 200);
}

function db_track_update_anime_name($id) {
    $animeName = body_get('animeName', null);
    $animePart = body_get('animePart', null);
    if (!$animeName) err_out(400, 'Bad request', 'animeName required');
    if ($animePart !== null && $animePart !== '') {
        $n = db_run('UPDATE tracks SET anime_name = ?, anime_part = ? WHERE id = ?', array($animeName, $animePart, $id));
    } else {
        $n = db_run('UPDATE tracks SET anime_name = ? WHERE id = ?', array($animeName, $id));
    }
    if ($n === 0) err_out(404, 'Not found', 'Track not found');
    json_out(array('ok' => true), 200);
}

function db_track_delete($id) {
    try { db_run('DELETE FROM tracks WHERE id = ?', array($id)); }
    catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true), 200);
}

function db_tracks_batch_delete() {
    $ids = body_get('ids', null);
    if (!is_array($ids)) err_out(400, 'Bad request', 'ids array required');
    try {
        db()->beginTransaction();
        foreach ($ids as $id) db_run('DELETE FROM tracks WHERE id = ?', array($id));
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'deleted' => count($ids)), 200);
}

function db_tracks_bulk() {
    $tracks = body_get('tracks', null);
    if (!is_array($tracks)) err_out(400, 'Bad request', 'tracks array required');
    $inserted = 0;
    try {
        db()->beginTransaction();
        foreach ($tracks as $t) {
            if (empty($t['id']) || empty($t['title'])) continue;
            $n = an_insert_track($t, true);
            $inserted += $n;
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'inserted' => $inserted), 200);
}

function db_tracks_batch_anime_name() {
    $items = body_get('items', null);
    if (!is_array($items)) err_out(400, 'Bad request', 'items array required');
    $updated = 0;
    try {
        db()->beginTransaction();
        foreach ($items as $item) {
            if (empty($item['id']) || empty($item['animeName'])) continue;
            $n = db_run('UPDATE tracks SET anime_name = ? WHERE id = ?', array($item['animeName'], $item['id']));
            $updated += $n;
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'updated' => $updated), 200);
}

function db_tracks_seed() {
    $tracks = body_get('tracks', null);
    if (!is_array($tracks)) err_out(400, 'Bad request', 'tracks array required');
    $row = db_one('SELECT COUNT(*) AS n FROM tracks', array()); $count = $row ? (int)$row['n'] : 0;
    if ($count > 0) json_out(array('ok' => true, 'seeded' => 0, 'message' => 'tracks table not empty'), 200);
    try {
        db()->beginTransaction();
        foreach ($tracks as $t) {
            if (empty($t['id']) || empty($t['title'])) continue;
            an_insert_track($t, false);
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'seeded' => count($tracks)), 200);
}

function db_tracks_reset() {
    $tracks = body_get('tracks', null);
    if (!is_array($tracks)) err_out(400, 'Bad request', 'tracks array required');
    try {
        db()->beginTransaction();
        db_run('DELETE FROM tracks', array());
        db_run('DELETE FROM history', array());
        foreach ($tracks as $t) {
            if (empty($t['id']) || empty($t['title'])) continue;
            an_insert_track($t, false);
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'seeded' => count($tracks)), 200);
}

// ---------------------------------------------------------------------------
// MATCH VOTES handlers (ELO race fix — single transaction)
// ---------------------------------------------------------------------------
function an_insert_history_row($v) {
    $hist = $v['newHistItem'];
    $ts = isset($hist['timestamp']) ? iso_to_ms($hist['timestamp']) : null;
    if ($ts === null) $ts = now_ms();
    $vc = isset($v['voterCoefficient']) ? $v['voterCoefficient'] : 1.0;
    $isQ = ($vc < 0.4) ? 1 : 0;
    db_run('INSERT INTO history (id, timestamp, track_a_id, track_b_id, track_a_json, track_b_json, winner_id, source, is_quarantined, voter_coefficient)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array(
        (string)$hist['id'],
        $ts,
        (string)$v['trackAId'],
        (string)$v['trackBId'],
        json_encode(isset($hist['trackA']) ? $hist['trackA'] : array()),
        json_encode(isset($hist['trackB']) ? $hist['trackB'] : array()),
        (string)$hist['winnerId'],
        isset($hist['source']) && $hist['source'] !== '' ? $hist['source'] : 'arena',
        $isQ,
        (double)$vc,
    ));
    return $isQ;
}

function an_update_track_elo($elo, $matches, $wins, $losses, $draws, $id) {
    $elo = max(100, min(4000, (int)$elo));
    db_run('UPDATE tracks SET elo = ?, matches_played = ?, wins = ?, losses = ?, draws = ? WHERE id = ?',
        array($elo, (int)$matches, (int)$wins, (int)$losses, (int)$draws, $id));
}

function db_match_vote() {
    $body = function_exists("get_json_body") ? get_json_body() : json_decode(file_get_contents("php://input"), true);
    if (!is_array($body)) $body = array();

    // FIX: the React client's single-vote payload (saveMatchVote → Be POST)
    // sends {trackAId, trackBId, eloA/B, winsA/B, …, newHistItem:{winnerId},
    // voterCoefficient} — WITHOUT top-level winnerId/loserId. The old stub
    // demanded winnerId+loserId at the top level, so EVERY real client vote
    // was rejected with "Missing fields" (and the stub never wrote anything
    // anyway). Derive winner/loser from either shape.
    $winner_id = isset($body["winnerId"]) ? $body["winnerId"] : (isset($body["winner_id"]) ? $body["winner_id"] : null);
    $loser_id = isset($body["loserId"]) ? $body["loserId"] : (isset($body["loser_id"]) ? $body["loser_id"] : null);
    $source = isset($body["source"]) ? $body["source"] : "arena";

    $trackAId = isset($body["trackAId"]) ? (string)$body["trackAId"] : '';
    $trackBId = isset($body["trackBId"]) ? (string)$body["trackBId"] : '';
    if ($winner_id === null && isset($body["newHistItem"]["winnerId"])) {
        $winner_id = $body["newHistItem"]["winnerId"];
    }
    if ($winner_id === null && $trackAId !== '' && $trackBId !== '') {
        // No winner info at all → treat as A-vs-B draw is NOT safe; reject.
        $winner_id = null;
    }
    if ($loser_id === null && $winner_id !== null && $trackAId !== '' && $trackBId !== '') {
        $loser_id = ((string)$winner_id === $trackAId) ? $trackBId : $trackAId;
    }

    if (!$winner_id || !$loser_id) {
        err_out(400, "Bad request", "Missing fields");
    }

    // FIX: this handler used to be a STUB — it echoed {success:true} and
    // never wrote anything, so single arena votes silently vanished. It now
    // persists exactly like the batch variant: one transaction, history row
    // + ELO/wins/losses/draws bookkeeping for both tracks.
    if ($trackAId === '') $trackAId = (string)$winner_id;
    if ($trackBId === '') $trackBId = (string)$loser_id;
    try {
        db()->beginTransaction();
        if (isset($body["newHistItem"]) && is_array($body["newHistItem"])) {
            an_insert_history_row($body);
        } else {
            $hist = array(
                'id' => generate_id('hist'),
                'timestamp' => ms_to_iso(now_ms()),
                'trackA' => array('id' => $trackAId),
                'trackB' => array('id' => $trackBId),
                'winnerId' => $winner_id,
                'source' => $source,
            );
            $body['newHistItem'] = $hist;
            an_insert_history_row($body);
        }
        if (isset($body["eloA"])) {
            an_update_track_elo($body["eloA"],
                isset($body["matchesPlayedA"]) ? $body["matchesPlayedA"] : 0,
                isset($body["winsA"]) ? $body["winsA"] : 0,
                isset($body["lossesA"]) ? $body["lossesA"] : 0,
                isset($body["drawsA"]) ? $body["drawsA"] : 0,
                $trackAId);
        }
        if (isset($body["eloB"])) {
            an_update_track_elo($body["eloB"],
                isset($body["matchesPlayedB"]) ? $body["matchesPlayedB"] : 0,
                isset($body["winsB"]) ? $body["winsB"] : 0,
                isset($body["lossesB"]) ? $body["lossesB"] : 0,
                isset($body["drawsB"]) ? $body["drawsB"] : 0,
                $trackBId);
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, "Internal", $e->getMessage());
    }

    json_out(array("success" => true, "winnerId" => $winner_id, "loserId" => $loser_id, "source" => $source), 200);
}

function db_match_vote_batch() {
    $votes = body_get('votes', null);
    if (!is_array($votes)) err_out(400, 'Bad request', 'votes array required');
    try {
        db()->beginTransaction();
        $latest = array();
        foreach ($votes as $v) {
            if (!is_array($v)) continue;
            $latest[$v['trackAId']] = array(
                'elo' => $v['eloA'], 'wins' => $v['winsA'], 'losses' => $v['lossesA'],
                'draws' => $v['drawsA'], 'matches' => $v['matchesPlayedA'],
            );
            $latest[$v['trackBId']] = array(
                'elo' => $v['eloB'], 'wins' => $v['winsB'], 'losses' => $v['lossesB'],
                'draws' => $v['drawsB'], 'matches' => $v['matchesPlayedB'],
            );
            an_insert_history_row($v);
        }
        foreach ($latest as $trackId => $s) {
            an_update_track_elo($s['elo'], $s['matches'], $s['wins'], $s['losses'], $s['draws'], $trackId);
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'count' => count($votes)), 200);
}

// ---------------------------------------------------------------------------
// HISTORY / PROPOSALS / USERS handlers
// ---------------------------------------------------------------------------
function db_history_list() {
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 150;
    if ($limit <= 0) $limit = 150;
    if ($limit > 1000) $limit = 1000;
    // v12.1 NAS: history is the second entry of the poll storm — same
    // conditional-GET treatment as tracks (new history rows bump MAX(rowid)).
    an_list_version_etag(
        'history-' . $limit,
        'SELECT COUNT(*) AS c, COALESCE(MAX(rowid), 0) AS m FROM history',
        array(),
        15
    );
    try {
        $rows = db_all('SELECT * FROM history ORDER BY timestamp DESC LIMIT ?', array($limit));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_history($r);
    json_out($out, 200);
}

function db_proposals_list() {
    $email = isset($_GET['email']) ? $_GET['email'] : null;
    // v12.1 NAS: the moderation tab re-polls this on every visit; the
    // submissions queue rarely changes, so the ETag revalidation is nearly
    // always a 304.
    if ($email !== null && $email !== '') {
        an_list_version_etag(
            'proposals-' . md5((string)$email),
            'SELECT COUNT(*) AS c, COALESCE(MAX(rowid), 0) AS m FROM proposals WHERE submitted_by = ?',
            array($email),
            20
        );
    } else {
        an_list_version_etag(
            'proposals',
            'SELECT COUNT(*) AS c, COALESCE(MAX(rowid), 0) AS m FROM proposals',
            array(),
            20
        );
    }
    try {
        if ($email !== null && $email !== '') {
            $rows = db_all('SELECT * FROM proposals WHERE submitted_by = ? ORDER BY submitted_at DESC', array($email));
        } else {
            $rows = db_all('SELECT * FROM proposals ORDER BY submitted_at DESC LIMIT 200', array());
        }
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_proposal($r);
    json_out($out, 200);
}

function db_proposal_create() {
    $p = json_body();
    if (empty($p['id']) || empty($p['type']) || empty($p['submittedBy'])) {
        err_out(400, 'Bad request', 'id, type, submittedBy required');
    }
    $submittedAt = isset($p['submittedAt']) ? iso_to_ms($p['submittedAt']) : null;
    if ($submittedAt === null) $submittedAt = now_ms();
    try {
        db_run('INSERT INTO proposals (id, type, submitted_by, submitted_at, status, track_data_json, old_track_id, proposed_yt_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', array(
            (string)$p['id'], (string)$p['type'], (string)$p['submittedBy'], $submittedAt,
            (isset($p['status']) && $p['status'] !== '') ? $p['status'] : 'pending',
            json_encode(isset($p['trackData']) ? $p['trackData'] : array()),
            array_key_exists('oldTrackId', $p) ? $p['oldTrackId'] : null,
            array_key_exists('proposedYtId', $p) ? $p['proposedYtId'] : null,
            array_key_exists('notes', $p) ? $p['notes'] : null,
        ));
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) err_out(409, 'Conflict', 'Proposal id exists');
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'id' => $p['id']), 201);
}

function db_proposal_status($id) {
    $status = body_get('status', null);
    $notes = body_get('notes', null);
    if (!$status || !in_array($status, array('approved', 'rejected', 'pending'), true)) {
        err_out(400, 'Bad request', 'status required (approved|rejected|pending)');
    }
    try {
        if ($notes !== null) {
            db_run('UPDATE proposals SET status = ?, notes = ? WHERE id = ?', array($status, $notes, $id));
        } else {
            db_run('UPDATE proposals SET status = ? WHERE id = ?', array($status, $id));
        }
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true), 200);
}

function db_proposal_get($id) {
    // FIX: NEWLY DEFINED — the router referenced this function but it never
    // existed, so GET /api/db/proposals/{id} crashed with a fatal error.
    $row = db_one('SELECT * FROM proposals WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Proposal not found');
    json_out(row_to_proposal($row), 200);
}

function db_proposals_batch_delete() {
    $ids = body_get('ids', null);
    if (!is_array($ids)) err_out(400, 'Bad request', 'ids array required');
    $deleted = 0;
    try {
        db()->beginTransaction();
        foreach ($ids as $id) { $deleted += db_run('DELETE FROM proposals WHERE id = ?', array($id)); }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'deleted' => $deleted), 200);
}

function db_users_list() {
    // FIX: this endpoint used to be fully PUBLIC and exposed every user's
    // email address. It stays reachable for anonymous visitors (the app polls
    // user profiles on boot for the leaderboard cards), but emails are now
    // only included for admin callers or the user's own row.
    $viewer = current_user();
    // v12.1 NAS: poll-storm member. NOTE: the payload is VIEWER-DEPENDENT
    // (emails), so 'private' caching is mandatory (never a shared cache) and
    // the ETag is per-browser anyway thanks to private max-age.
    an_list_version_etag(
        'users',
        'SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS u FROM users',
        array(),
        30
    );
    try {
        $rows = db_all('SELECT * FROM users ORDER BY updated_at DESC LIMIT 200', array());
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) {
        $u = row_to_user($r);
        $isSelf = ($viewer !== null && $viewer['id'] === $r['id']);
        $isAdmin = ($viewer !== null && $viewer['role'] === 'admin');
        if (!$isSelf && !$isAdmin) unset($u['email']);
        $out[] = $u;
    }
    json_out($out, 200);
}

function db_user_get($id) {
    // FIX: newly routed — GET /api/db/users/{id} previously ran the UPDATE
    // handler and returned {ok:true,updated:0} instead of the profile.
    // Emails are only exposed to the profile owner or an admin.
    $row = db_one('SELECT * FROM users WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'User not found');
    $u = row_to_user($row);
    $viewer = current_user();
    $isSelf = ($viewer !== null && $viewer['id'] === $row['id']);
    $isAdmin = ($viewer !== null && $viewer['role'] === 'admin');
    if (!$isSelf && !$isAdmin) unset($u['email']);
    json_out($u, 200);
}

function db_user_update($id) {
    // FIX: was current_user() + manual check — a null user caused PHP 8
    // "array offset on null" warnings and a 403 instead of a clean 401.
    $u = require_auth();
    if ($u['id'] !== $id && $u['role'] !== 'admin') {
        err_out(403, 'Forbidden', 'Can only edit your own profile');
    }
    $patch = json_body();
    $allowed = array(
        'displayName' => 'display_name', 'picture' => 'avatar_url', 'banner' => 'banner_url',
        'bio' => 'bio', 'malUser' => 'mal_user', 'displayedBadgeIds' => 'displayed_badge_ids_json',
        'votesCount' => 'votes_count', 'elo' => 'elo', 'lastClashPlayedDate' => 'last_clash_date',
        'streakCount' => 'streak_count', 'lastStreakUpdateDate' => 'last_streak_update_date',
        'bestStreak' => 'best_streak', 'followersCount' => 'followers_count',
        'completedCollections' => 'completed_collections_json', 'subscriptionTier' => 'subscription_tier',
        'activeCrest' => 'active_crest', 'votedTrackIds' => 'voted_track_ids_json',
        'savedTrackIds' => 'saved_track_ids_json', 'arenaDiary' => 'arena_diary_json',
        'customTournaments' => 'custom_tournaments_json', 'totalXp' => 'total_xp',
        'weeklyXp' => 'weekly_xp', 'weeklyXpWeek' => 'weekly_xp_week',
        'dailyGoalDate' => 'daily_goal_date', 'dailyGoalVotes' => 'daily_goal_votes',
        'streakFreezeCount' => 'streak_freeze_count',
    );
    $sets = array(); $vals = array();
    foreach ($allowed as $camel => $snake) {
        if (array_key_exists($camel, $patch) && $patch[$camel] !== null) {
            $v = $patch[$camel];
            if (substr($snake, -5) === '_json' && !is_string($v)) {
                $v = json_encode($v === null ? array() : $v);
            }
            $sets[] = $snake . ' = ?';
            $vals[] = $v;
        }
    }
    // JSON-array fields handled separately (prepared-statement whitelist in TS).
    $jsonFields = array(
        'badges' => 'badges_json', 'following' => 'follows_json',
        'favoriteTrackIds' => 'favorites_json', 'customLists' => 'custom_lists_json',
        'vibeSpectrum' => 'vibe_spectrum_json',
    );
    foreach ($jsonFields as $camel => $snake) {
        if (array_key_exists($camel, $patch) && $patch[$camel] !== null) {
            $sets[] = $snake . ' = ?';
            $vals[] = json_encode($patch[$camel]);
        }
    }
    if (count($sets) === 0) json_out(array('ok' => true, 'updated' => 0), 200);
    $sets[] = 'updated_at = ?';
    $vals[] = now_ms();
    $vals[] = $id;
    try {
        db_run('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?', $vals);
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true, 'updated' => count($sets) - 1), 200);
}

function db_user_follow($id) {
    // FIX: was current_user() without a null check (PHP 8 warnings + broken
    // 401 semantics); now requires auth. Also updates the target's
    // followers_count atomically (the schema column was previously ignored).
    $u = require_auth();
    if ($u['id'] !== $id) err_out(403, 'Forbidden', 'Can only toggle follows for yourself');
    $target = body_get('targetUserId', null);
    $isFollowing = body_get('isFollowing', null);
    if (!$target) err_out(400, 'Bad request', 'targetUserId required');
    $changed = 0;
    try {
        db()->beginTransaction();
        $curRow = db_one('SELECT * FROM users WHERE id = ?', array($id));
        $tgtRow = db_one('SELECT id, followers_count FROM users WHERE id = ?', array($target));
        if ($curRow === null || $tgtRow === null) throw new Exception('User does not exist');
        $following = safe_json_parse($curRow['follows_json'], array());
        if (!is_array($following)) $following = array();
        if ($isFollowing) {
            // isFollowing=true → currently following → this call UNfollows.
            if (!in_array($target, $following, true)) throw new Exception('no-op');
            $newFollowing = array();
            foreach ($following as $fid) if ($fid !== $target) $newFollowing[] = $fid;
            $delta = -1;
        } else {
            if (in_array($target, $following, true)) throw new Exception('no-op');
            $following[] = $target;
            $newFollowing = $following;
            $delta = 1;
        }
        db_run('UPDATE users SET follows_json = ?, updated_at = ? WHERE id = ?',
            array(json_encode($newFollowing), now_ms(), $id));
        db_run('UPDATE users SET followers_count = MAX(0, followers_count + ?), updated_at = ? WHERE id = ?',
            array($delta, now_ms(), $target));
        $changed = 1;
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        if ($e->getMessage() === 'no-op') { $changed = 0; }
        else { err_out(500, 'Internal', $e->getMessage()); }
    }
    json_out(array('ok' => true, 'changed' => $changed), 200);
}

// ---------------------------------------------------------------------------
// TOURNAMENTS handlers
// ---------------------------------------------------------------------------
function db_tournaments_list() {
    // v12.1 NAS: third member of the poll storm — matches_json is fat, so the
    // 304 win here is the biggest of the three.
    an_list_version_etag(
        'tournaments-active',
        "SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS u FROM tournaments WHERE status = 'active'",
        array(),
        30
    );
    try {
        $rows = db_all("SELECT * FROM tournaments WHERE status = 'active' ORDER BY updated_at DESC", array());
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_tournament($r);
    json_out($out, 200);
}

function db_tournament_get($id) {
    $row = db_one('SELECT * FROM tournaments WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Tournament not found');
    json_out(row_to_tournament($row), 200);
}

function db_tournament_upsert() {
    // FIX: require_auth (was current_user() — null user → PHP 8 warnings).
    $u = require_auth();
    $t = json_body();
    if (empty($t['id']) || empty($t['name'])) err_out(400, 'Bad request', 'id, name required');
    $now = now_ms();
    $createdBy = isset($t['createdBy']) ? $t['createdBy'] : $u['id'];
    try {
        db_run('INSERT INTO tournaments (
                    id, owner_id, name, format, size, status, current_round, current_match_index,
                    matches_json, is_online, voting_duration, match_end_time, created_by,
                    created_by_username, winner_id, privacy, lobby_password, currently_playing_id,
                    history_log_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_id = excluded.owner_id, name = excluded.name, format = excluded.format,
                    size = excluded.size, status = excluded.status,
                    current_round = excluded.current_round, current_match_index = excluded.current_match_index,
                    matches_json = excluded.matches_json, is_online = excluded.is_online,
                    voting_duration = excluded.voting_duration, match_end_time = excluded.match_end_time,
                    created_by = excluded.created_by, created_by_username = excluded.created_by_username,
                    winner_id = excluded.winner_id, privacy = excluded.privacy,
                    lobby_password = excluded.lobby_password, currently_playing_id = excluded.currently_playing_id,
                    history_log_json = excluded.history_log_json, updated_at = excluded.updated_at', array(
            (string)$t['id'],
            (string)$createdBy,
            (string)$t['name'],
            isset($t['typeFilter']) ? (string)$t['typeFilter'] : '',
            isset($t['size']) ? (int)$t['size'] : 8,
            isset($t['status']) ? (string)$t['status'] : 'active',
            isset($t['currentRound']) ? (int)$t['currentRound'] : 0,
            isset($t['currentMatchIndex']) ? (int)$t['currentMatchIndex'] : 0,
            json_encode(isset($t['matches']) && is_array($t['matches']) ? $t['matches'] : array()),
            !empty($t['isOnline']) ? 1 : 0,
            array_key_exists('votingDuration', $t) ? $t['votingDuration'] : null,
            array_key_exists('matchEndTime', $t) ? $t['matchEndTime'] : null,
            isset($t['createdBy']) ? $t['createdBy'] : null,
            array_key_exists('createdByUsername', $t) ? $t['createdByUsername'] : null,
            array_key_exists('winnerId', $t) ? $t['winnerId'] : null,
            array_key_exists('privacy', $t) ? $t['privacy'] : null,
            array_key_exists('lobbyPassword', $t) ? $t['lobbyPassword'] : null,
            array_key_exists('currentlyPlayingId', $t) ? $t['currentlyPlayingId'] : null,
            json_encode(isset($t['historyLog']) && is_array($t['historyLog']) ? $t['historyLog'] : array()),
            $now, $now,
        ));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true, 'id' => $t['id']), 201);
}

function db_tournament_delete($id) {
    // FIX: require_auth (was current_user() — null user → PHP 8 warnings).
    $u = require_auth();
    $row = db_one('SELECT owner_id FROM tournaments WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Tournament not found');
    if ($u['role'] !== 'admin' && $row['owner_id'] !== $u['id']) {
        err_out(403, 'Forbidden', 'Not the tournament owner');
    }
    db_run('DELETE FROM tournaments WHERE id = ?', array($id));
    json_out(array('ok' => true), 200);
}

// ---------------------------------------------------------------------------
// FRANCHISE CACHE
// ---------------------------------------------------------------------------
function db_franchise_cache_get($key) {
    $key = strtolower(trim($key));
    $row = db_one('SELECT data_json FROM franchise_cache WHERE key = ?', array($key));
    if ($row === null) err_out(404, 'Not found', 'Cache miss');
    $data = safe_json_parse($row['data_json'], array());
    $related = array();
    if (isset($data['relatedMalIds']) && is_array($data['relatedMalIds'])) $related = $data['relatedMalIds'];
    $out = array('relatedMalIds' => $related);
    if (isset($data['animeTitle'])) $out['animeTitle'] = $data['animeTitle'];
    json_out($out, 200);
}

function db_franchise_cache_put($key) {
    $key = strtolower(trim($key));
    $related = body_get('relatedMalIds', null);
    $title = body_get('animeTitle', null);
    if (!is_array($related)) err_out(400, 'Bad request', 'relatedMalIds array required');
    $data = json_encode(array('animeTitle' => ($title !== null && $title !== '') ? $title : $key, 'relatedMalIds' => $related));
    try {
        db_run('INSERT INTO franchise_cache (key, status, data_json, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET status = excluded.status, data_json = excluded.data_json, updated_at = excluded.updated_at',
            array($key, 'ok', $data, now_ms()));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true), 200);
}

// ---------------------------------------------------------------------------
// REVIEWS
// ---------------------------------------------------------------------------
function db_reviews_list() {
    $trackId = isset($_GET['trackId']) ? $_GET['trackId'] : null;
    if (!$trackId) err_out(400, 'Bad request', 'trackId required');
    try {
        $rows = db_all('SELECT * FROM reviews WHERE track_id = ? ORDER BY created_at DESC LIMIT 200', array($trackId));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_review($r);
    json_out($out, 200);
}

function db_review_create() {
    $u = require_auth();
    $r = json_body();
    if (empty($r['trackId']) || empty($r['userId']) || empty($r['username']) || !isset($r['rating'])) {
        err_out(400, 'Bad request', 'trackId, userId, username, rating required');
    }
    if ($r['userId'] !== $u['id']) err_out(403, 'Forbidden', 'userId must match your auth');
    $id = $r['trackId'] . '-' . $r['userId'] . '-' . now_ms();
    try {
        db_run('INSERT INTO reviews (id, track_id, user_id, user_name, user_avatar, content, rating, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)', array(
            $id, (string)$r['trackId'], (string)$r['userId'], (string)$r['username'],
            array_key_exists('userPicture', $r) ? $r['userPicture'] : null,
            isset($r['comment']) ? (string)$r['comment'] : '',
            (int)$r['rating'], now_ms(),
        ));
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            err_out(409, 'Conflict', 'You already reviewed this track — edit it instead');
        }
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array('ok' => true, 'id' => $id), 201);
}

function db_review_delete($id) {
    $u = require_auth();
    $row = db_one('SELECT user_id FROM reviews WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Review not found');
    if ($row['user_id'] !== $u['id'] && $u['role'] !== 'admin') err_out(403, 'Forbidden', 'Not your review');
    db_run('DELETE FROM reviews WHERE id = ?', array($id));
    json_out(array('ok' => true), 200);
}

function db_review_check_completist() {
    $u = require_auth();
    $userId = body_get('userId', null);
    $target = body_get('targetAnimeName', null);
    $allTracks = body_get('allTracksOfAnime', null);
    if (!$userId || !$target || !is_array($allTracks)) {
        err_out(400, 'Bad request', 'userId, targetAnimeName, allTracksOfAnime required');
    }
    if ($userId !== $u['id'] && $u['role'] !== 'admin') err_out(403, 'Forbidden', 'Not allowed');
    $result = array('awarded' => false);
    try {
        db()->beginTransaction();
        $userRow = db_one('SELECT * FROM users WHERE id = ?', array($userId));
        if ($userRow === null) { $result['reason'] = 'user not found'; }
        else {
            $completed = safe_json_parse($userRow['completed_collections_json'], array());
            if (!is_array($completed)) $completed = array();
            if (in_array($target, $completed, true)) { $result['reason'] = 'already awarded'; }
            else {
                $rows = db_all('SELECT track_id FROM reviews WHERE user_id = ?', array($userId));
                $reviewed = array();
                foreach ($rows as $row) $reviewed[$row['track_id']] = true;
                $hasAll = count($allTracks) > 0;
                foreach ($allTracks as $tid) { if (!isset($reviewed[$tid])) { $hasAll = false; break; } }
                if (!$hasAll) { $result['reason'] = 'not all reviewed'; }
                else {
                    $completed[] = $target;
                    db_run('UPDATE users SET completed_collections_json = ?, updated_at = ? WHERE id = ?',
                        array(json_encode($completed), now_ms(), $userId));
                    $result = array('awarded' => true);
                }
            }
        }
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, 'Internal', $e->getMessage());
    }
    json_out(array_merge(array('ok' => true), $result), 200);
}

function db_review_get($id) {
    // FIX: NEWLY DEFINED — the router referenced this function but it never
    // existed, so GET /api/db/reviews/{id} crashed with a fatal error.
    $row = db_one('SELECT * FROM reviews WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Review not found');
    json_out(row_to_review($row), 200);
}

// ---------------------------------------------------------------------------
// ARTIST PROFILES
// ---------------------------------------------------------------------------
function db_artists_list() {
    try {
        $rows = db_all('SELECT * FROM artist_profiles ORDER BY updated_at DESC LIMIT 200', array());
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_artist($r);
    json_out($out, 200);
}

function db_artist_get($name) {
    $name = strtolower(trim($name));
    $row = db_one('SELECT * FROM artist_profiles WHERE artist_name = ? COLLATE NOCASE', array($name));
    if ($row === null) err_out(404, 'Not found', 'Artist not found');
    json_out(row_to_artist($row), 200);
}

function db_artist_put($name) {
    $profile = json_body();
    $name = strtolower(trim($name));
    $id = isset($profile['id']) && $profile['id'] !== '' ? $profile['id'] : generate_id('art');
    try {
        db_run('INSERT INTO artist_profiles (id, artist_name, image_url, bio, birthday, website, mal_url, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET artist_name = excluded.artist_name, image_url = excluded.image_url,
                  bio = excluded.bio, birthday = excluded.birthday, website = excluded.website,
                  mal_url = excluded.mal_url, updated_at = excluded.updated_at', array(
            $id,
            (isset($profile['artistName']) && $profile['artistName'] !== '') ? $profile['artistName'] : $name,
            array_key_exists('imageUrl', $profile) ? $profile['imageUrl'] : null,
            array_key_exists('bio', $profile) ? $profile['bio'] : null,
            array_key_exists('birthday', $profile) ? $profile['birthday'] : null,
            array_key_exists('websiteUrl', $profile) ? $profile['websiteUrl'] : null,
            array_key_exists('malUrl', $profile) ? $profile['malUrl'] : null,
            now_ms(),
        ));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true, 'id' => $id), 200);
}

// ---------------------------------------------------------------------------
// POKEDEX
// ---------------------------------------------------------------------------
function db_pokedex_list() {
    try {
        $rows = db_all('SELECT * FROM pokedex_collectibles ORDER BY anime_name ASC', array());
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_pokedex($r);
    json_out($out, 200);
}

function db_pokedex_get($id) {
    $row = db_one('SELECT * FROM pokedex_collectibles WHERE id = ?', array($id));
    if ($row === null) err_out(404, 'Not found', 'Collectible not found');
    json_out(row_to_pokedex($row), 200);
}

function db_pokedex_put($id) {
    $p = json_body();
    if (empty($p['animeName'])) err_out(400, 'Bad request', 'animeName required');
    if ($id === '' || $id === null) {
        $id = strtolower(preg_replace('/\s+/', '-', (string)(isset($p['id']) && $p['id'] !== '' ? $p['id'] : $p['animeName'])));
    }
    $required = (isset($p['requiredTrackIds']) && is_array($p['requiredTrackIds'])) ? $p['requiredTrackIds'] : array();
    $createdAt = isset($p['createdAt']) ? $p['createdAt'] : now_ms();
    try {
        db_run('INSERT INTO pokedex_collectibles (id, anime_name, description, icon_type, icon_value, visual_effect, required_track_ids_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  anime_name = excluded.anime_name, description = excluded.description,
                  icon_type = excluded.icon_type, icon_value = excluded.icon_value,
                  visual_effect = excluded.visual_effect, required_track_ids_json = excluded.required_track_ids_json', array(
            $id,
            (string)$p['animeName'],
            isset($p['description']) ? (string)$p['description'] : '',
            isset($p['iconType']) ? (string)$p['iconType'] : 'emoji',
            isset($p['iconValue']) ? (string)$p['iconValue'] : '',
            isset($p['visualEffect']) ? (string)$p['visualEffect'] : 'none',
            json_encode($required),
            $createdAt,
        ));
    } catch (Exception $e) { err_out(500, 'Internal', $e->getMessage()); }
    json_out(array('ok' => true, 'id' => $id), 200);
}

function db_pokedex_delete($id) {
    db_run('DELETE FROM pokedex_collectibles WHERE id = ?', array($id));
    json_out(array('ok' => true), 200);
}


function db_tracks_bulk_update() {
    $body = function_exists("get_json_body") ? get_json_body() : json_decode(file_get_contents("php://input"), true);
    if (!is_array($body)) $body = array();

    $tracks = isset($body["tracks"]) ? $body["tracks"] : $body;
    if (!is_array($tracks) || empty($tracks)) {
        err_out(400, "Bad request", "No tracks array provided");
    }

    // FIX: previously opened its own PDO connection to the HARDCODED NAS path
    // /DataVolume/anisync/data/anisync.sqlite — failed on every other host.
    // Now uses the shared db() singleton (respects ANISYNC_DB_PATH) and is
    // routed at POST /api/db/tracks/bulk-update.
    try {
        db()->beginTransaction();

        $stmt = db()->prepare("UPDATE tracks SET youtube_id = :yt WHERE id = :id");
        $updated = 0;

        foreach ($tracks as $t) {
            $id = isset($t["id"]) ? $t["id"] : "";
            $yt = isset($t["youtube_id"]) ? $t["youtube_id"] : (isset($t["youtubeId"]) ? $t["youtubeId"] : "");
            if ($id !== "" && $yt !== "") {
                $stmt->execute(array(":yt" => $yt, ":id" => $id));
                $updated++;
            }
        }

        db()->commit();
        json_out(array("success" => true, "updatedCount" => $updated), 200);
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        err_out(500, "Database error", $e->getMessage());
    }
}



function db_artist_profiles_list() {
    // FIX: previously opened its own PDO connection to the HARDCODED NAS path
    // AND returned raw snake_case rows (the client expects the camelCase
    // ArtistProfile shape that every other endpoint emits). Now uses db() and
    // row_to_artist().
    // v12.1 NAS: slow-changing reference data — long private shelf life.
    an_list_version_etag(
        'artist-profiles',
        'SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS u FROM artist_profiles',
        array(),
        300
    );
    try {
        $rows = db_all('SELECT * FROM artist_profiles ORDER BY updated_at DESC LIMIT 200', array());
    } catch (Exception $e) {
        json_out(array(), 200);
    }
    $out = array();
    foreach ($rows as $r) $out[] = row_to_artist($r);
    json_out($out, 200);
}
