<?php
/**
 * routes_google.php — /api/google/* + /api/youtube/* (googleAuth.ts port).
 *
 *   GET  /api/google/auth             → 302 to Google consent (requires auth)
 *   GET  /api/google/auth/callback    → token exchange, 302 back to app
 *   GET  /api/google/auth/status      → {configured, connected, scope, has_refresh}
 *   POST /api/google/auth/disconnect  → {ok:true}
 *   POST /api/google/export-playlist  → create YouTube playlist + insert items
 *       (also mounted at /api/youtube/export-playlist for older clients)
 */

function google_configured() {
    return GOOGLE_OAUTH_CLIENT_ID !== '' && GOOGLE_OAUTH_CLIENT_SECRET !== '';
}

function google_redirect_uri() {
    if (APP_URL !== '') return rtrim(APP_URL, '/') . '/api/google/auth/callback';
    $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    return $scheme . '://' . $host . '/api/google/auth/callback';
}

function route_google($method, $action) {
    if ($action === 'auth' && $method === 'GET') { require_auth(); return google_auth_start(); }
    if ($action === 'auth/callback' && $method === 'GET') { return google_auth_callback(); }
    if ($action === 'auth/status' && $method === 'GET') { require_auth(); return google_auth_status(); }
    if ($action === 'auth/disconnect' && $method === 'POST') { require_auth(); return google_auth_disconnect(); }
    if ($action === 'export-playlist' && $method === 'POST') { require_auth(); return google_export_playlist(); }
    err_out(404, 'Not found', 'Unknown google endpoint');
}

function google_auth_start() {
    if (!google_configured()) {
        err_out(503, 'YouTube export is disabled on this server.',
            'Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET to enable.');
    }
    $u = current_user();
    $returnTo = isset($_GET['return_to']) ? (string)$_GET['return_to'] : '/';
    if (strpos($returnTo, '://') !== false || strpos($returnTo, '//') === 0) $returnTo = '/';
    $state = $u['id'] . ':' . $returnTo;
    $params = array(
        'client_id' => GOOGLE_OAUTH_CLIENT_ID,
        'redirect_uri' => google_redirect_uri(),
        'response_type' => 'code',
        'scope' => GOOGLE_OAUTH_SCOPES,
        'access_type' => 'offline',
        'prompt' => 'consent',
        'state' => $state,
    );
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params));
    http_response_code(302);
    exit;
}

function google_auth_callback() {
    if (!google_configured()) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'YouTube export is disabled on this server.';
        exit;
    }
    $code = isset($_GET['code']) ? (string)$_GET['code'] : '';
    $state = isset($_GET['state']) ? (string)$_GET['state'] : '';
    $err = isset($_GET['error']) ? (string)$_GET['error'] : '';
    if ($err === 'access_denied') { header('Location: /?yt_error=declined'); exit; }
    if ($err !== '') { header('Location: /?yt_error=' . urlencode($err)); exit; }
    if ($code === '' || $state === '') {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Missing code or state in OAuth callback.';
        exit;
    }
    $colon = strpos($state, ':');
    if ($colon === false || $colon < 1) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Malformed state.';
        exit;
    }
    $userId = substr($state, 0, $colon);
    $returnTo = substr($state, $colon + 1);
    if ($returnTo === '') $returnTo = '/';
    if (strpos($returnTo, '://') !== false || strpos($returnTo, '//') === 0) $returnTo = '/';
    $userRow = db_one('SELECT id FROM users WHERE id = ?', array($userId));
    if ($userRow === null) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'User not found — restart the YouTube export flow from the app.';
        exit;
    }
    // Exchange the code for tokens.
    $r = an_curl('https://oauth2.googleapis.com/token', array(
        'method' => 'POST',
        'headers' => array('Content-Type: application/x-www-form-urlencoded'),
        'form' => array(
            'code' => $code,
            'client_id' => GOOGLE_OAUTH_CLIENT_ID,
            'client_secret' => GOOGLE_OAUTH_CLIENT_SECRET,
            'redirect_uri' => google_redirect_uri(),
            'grant_type' => 'authorization_code',
        ),
        'timeout' => 15,
    ));
    if (!$r['ok']) {
        header('Location: /?yt_error=' . urlencode('token_exchange_failed'));
        exit;
    }
    $tokens = safe_json_parse($r['body'], null);
    if ($tokens === null || empty($tokens['access_token'])) {
        header('Location: /?yt_error=' . urlencode('token_exchange_failed'));
        exit;
    }
    $stored = array(
        'access_token' => $tokens['access_token'],
        'expiry_date' => now_ms() + (((int)$tokens['expires_in']) - 30) * 1000,
        'scope' => isset($tokens['scope']) && $tokens['scope'] !== '' ? $tokens['scope'] : GOOGLE_OAUTH_SCOPES,
    );
    if (!empty($tokens['refresh_token'])) $stored['refresh_token'] = $tokens['refresh_token'];
    db_run('UPDATE users SET google_oauth_token_json = ?, updated_at = ? WHERE id = ?',
        array(json_encode($stored), now_ms(), $userId));
    $sep = strpos($returnTo, '?') !== false ? '&' : '?';
    header('Location: ' . $returnTo . $sep . 'yt_connected=1');
    exit;
}

function google_auth_status() {
    $u = current_user();
    if (!google_configured()) json_out(array('configured' => false, 'connected' => false), 200);
    $row = db_one('SELECT google_oauth_token_json FROM users WHERE id = ?', array($u['id']));
    $json = ($row !== null) ? $row['google_oauth_token_json'] : null;
    if ($json === null || $json === '') json_out(array('configured' => true, 'connected' => false), 200);
    $parsed = safe_json_parse($json, null);
    if ($parsed === null || !is_array($parsed)) json_out(array('configured' => true, 'connected' => false), 200);
    json_out(array(
        'configured' => true,
        'connected' => true,
        'scope' => isset($parsed['scope']) ? $parsed['scope'] : '',
        'has_refresh' => !empty($parsed['refresh_token']),
    ), 200);
}

function google_auth_disconnect() {
    $u = current_user();
    db_run('UPDATE users SET google_oauth_token_json = NULL, updated_at = ? WHERE id = ?', array(now_ms(), $u['id']));
    json_out(array('ok' => true), 200);
}

/** getValidGoogleAccessToken port — refresh if expired, clear if unrefreshable. */
function google_valid_access_token($userId) {
    $row = db_one('SELECT google_oauth_token_json FROM users WHERE id = ?', array($userId));
    $json = ($row !== null) ? $row['google_oauth_token_json'] : null;
    if ($json === null || $json === '') return null;
    $stored = safe_json_parse($json, null);
    if ($stored === null || !is_array($stored) || empty($stored['access_token'])) return null;
    if ((int)$stored['expiry_date'] > now_ms() + 60000) return $stored['access_token'];
    if (empty($stored['refresh_token'])) {
        db_run('UPDATE users SET google_oauth_token_json = NULL, updated_at = ? WHERE id = ?', array(now_ms(), $userId));
        return null;
    }
    $r = an_curl('https://oauth2.googleapis.com/token', array(
        'method' => 'POST',
        'headers' => array('Content-Type: application/x-www-form-urlencoded'),
        'form' => array(
            'client_id' => GOOGLE_OAUTH_CLIENT_ID,
            'client_secret' => GOOGLE_OAUTH_CLIENT_SECRET,
            'refresh_token' => $stored['refresh_token'],
            'grant_type' => 'refresh_token',
        ),
        'timeout' => 15,
    ));
    if (!$r['ok']) {
        db_run('UPDATE users SET google_oauth_token_json = NULL, updated_at = ? WHERE id = ?', array(now_ms(), $userId));
        return null;
    }
    $refreshed = safe_json_parse($r['body'], null);
    if ($refreshed === null || empty($refreshed['access_token'])) return null;
    $updated = array(
        'access_token' => $refreshed['access_token'],
        'refresh_token' => $stored['refresh_token'],
        'expiry_date' => now_ms() + (((int)$refreshed['expires_in']) - 30) * 1000,
        'scope' => isset($refreshed['scope']) && $refreshed['scope'] !== '' ? $refreshed['scope'] : $stored['scope'],
    );
    db_run('UPDATE users SET google_oauth_token_json = ?, updated_at = ? WHERE id = ?',
        array(json_encode($updated), now_ms(), $userId));
    return $updated['access_token'];
}

function google_export_playlist() {
    $u = current_user();
    if (!google_configured()) {
        err_out(503, 'YouTube export is disabled on this server.',
            'Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET to enable.');
    }
    $name = body_get('name', null);
    $description = body_get('description', '');
    $trackIds = body_get('trackIds', null);
    if (!$name || !is_array($trackIds) || count($trackIds) === 0) {
        err_out(400, 'Bad request', 'Missing name or trackIds.');
    }
    $accessToken = google_valid_access_token($u['id']);
    if ($accessToken === null) {
        err_out(401, 'YouTube not connected.', 'Re-connect your Google account via the YouTube export button.');
    }
    // Resolve YouTube video IDs from internal track IDs.
    $videoIds = array();
    foreach ($trackIds as $tid) {
        $row = db_one('SELECT youtube_id FROM tracks WHERE id = ?', array((string)$tid));
        if ($row !== null && $row['youtube_id'] !== null && $row['youtube_id'] !== '') $videoIds[] = $row['youtube_id'];
    }
    if (count($videoIds) === 0) err_out(404, 'Not found', 'None of the requested tracks have a YouTube ID.');

    // Step 1 — create the playlist (private).
    $createBody = json_encode(array(
        'snippet' => array(
            'title' => substr((string)$name, 0, 150),
            'description' => substr((string)$description, 0, 5000),
        ),
        'status' => array('privacyStatus' => 'private'),
    ));
    $r = an_curl('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', array(
        'method' => 'POST',
        'headers' => array('Content-Type: application/json', 'Authorization: Bearer ' . $accessToken),
        'body' => $createBody,
        'timeout' => 15,
    ));
    if (!$r['ok']) {
        err_out(502, 'YouTube rejected the playlist creation.', substr($r['body'], 0, 500));
    }
    $created = safe_json_parse($r['body'], array());
    $playlistId = isset($created['id']) ? $created['id'] : '';

    // Step 2 — insert each video sequentially (quota-friendly).
    $inserted = 0; $failed = 0;
    foreach ($videoIds as $videoId) {
        $itemBody = json_encode(array('snippet' => array(
            'playlistId' => $playlistId,
            'resourceId' => array('kind' => 'youtube#video', 'videoId' => $videoId),
        )));
        $ir = an_curl('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', array(
            'method' => 'POST',
            'headers' => array('Content-Type: application/json', 'Authorization: Bearer ' . $accessToken),
            'body' => $itemBody,
            'timeout' => 15,
        ));
        if ($ir['ok']) $inserted++; else $failed++;
    }
    json_out(array(
        'ok' => true,
        'playlistId' => $playlistId,
        'playlistUrl' => 'https://www.youtube.com/playlist?list=' . $playlistId,
        'inserted' => $inserted,
        'failed' => $failed,
        'totalRequested' => count($videoIds),
    ), 200);
}
