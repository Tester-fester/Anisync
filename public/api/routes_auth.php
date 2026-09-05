<?php
/**
 * routes_auth.php — /api/auth/* endpoints (authRoutes.ts + auth.ts port).
 *
 *   POST /api/auth/register  → 201 + JWT
 *   POST /api/auth/login     → 200 + JWT
 *   POST /api/auth/logout    → 204
 *   GET  /api/auth/me        → 200 + profile
 *   POST /api/auth/refresh   → 200 + new JWT (same session row)
 */

function route_auth($method, $action) {
    if ($action === 'register' && $method === 'POST') { auth_register(); }
    if ($action === 'login' && $method === 'POST') { auth_login(); }
    if ($action === 'logout' && $method === 'POST') { auth_logout(); }
    if ($action === 'me' && $method === 'GET') { auth_me(); }
    if ($action === 'refresh' && $method === 'POST') { auth_refresh(); }
    // migrate-from-firebase was removed in PR5 — 404 like the Node server.
    err_out(404, 'Not found', 'Unknown auth endpoint');
}

function an_valid_email($email) {
    if (!is_string($email)) return false;
    if (strlen($email) > 254) return false;
    return (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email);
}

function an_valid_password($pw) {
    if (!is_string($pw)) return false;
    if (strlen($pw) < 8 || strlen($pw) > 200) return false;
    $hasLetter = (bool)preg_match('/[a-zA-Z]/', $pw);
    $hasDigit = (bool)preg_match('/\d/', $pw);
    return $hasLetter && $hasDigit;
}

function sanitize_display_name($name) {
    return substr(trim((string)$name), 0, 50);
}

function auth_register() {
    $email = body_get('email', null);
    $password = body_get('password', null);
    $displayName = body_get('display_name', null);

    if (!$email || !$password) err_out(400, 'Bad request', 'Email and password required');
    if (!an_valid_email($email)) err_out(400, 'Bad request', 'Invalid email');
    if (!an_valid_password($password)) err_out(400, 'Bad request', 'Password must be 8+ chars with a letter and a number');
    $name = sanitize_display_name($displayName !== null && $displayName !== '' ? $displayName : substr($email, 0, strpos($email, '@')));
    if ($name === '') $name = 'user';

    $emailLower = strtolower($email);
    $existing = db_one('SELECT id FROM users WHERE email = ?', array($emailLower));
    if ($existing !== null) err_out(409, 'Conflict', 'Email already registered');

    $userId = generate_id('usr');
    $now = now_ms();
    $hash = pbkdf2_hash($password);
    try {
        db()->beginTransaction();
        db_run('INSERT INTO users (id, email, password_hash, google_sub, role, display_name, avatar_url, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?)',
            array($userId, $emailLower, $hash, 'user', $name, $now, $now));
        $sid = create_session($userId);
        db()->commit();
    } catch (Exception $e) {
        if (db()->inTransaction()) db()->rollBack();
        if (strpos($e->getMessage(), 'UNIQUE') !== false) {
            err_out(409, 'Conflict', 'Email already registered');
        }
        err_out(500, 'Internal', 'Failed to create account');
    }

    $user = array('id' => $userId, 'email' => $emailLower, 'role' => 'user');
    $token = jwt_sign($user['id'], $user['email'], $user['role'], $sid);
    json_out(array(
        'token' => $token,
        'user' => array(
            'id' => $userId, 'email' => $emailLower, 'role' => 'user',
            'display_name' => $name, 'avatar_url' => null,
            'badges' => array(), 'follows' => array(), 'favorites' => array(),
        ),
    ), 201);
}

function auth_login() {
    $email = body_get('email', null);
    $password = body_get('password', null);
    if (!$email || !$password) err_out(400, 'Bad request', 'Email and password required');

    // FIX: trim stray whitespace on the email (copy-paste artefacts caused
    // mysterious "Invalid credentials" failures).
    $emailLower = strtolower(trim((string)$email));

    // FIX: opportunistic GC — purge expired session rows on login so the
    // sessions table does not grow forever on quiet installs.
    try {
        db_run('DELETE FROM sessions WHERE expires_at <= ?', array(now_ms()));
    } catch (Exception $e) { /* non-fatal */ }

    $row = db_one('SELECT * FROM users WHERE email = ?', array($emailLower));
    if ($row === null || $row['password_hash'] === null || $row['password_hash'] === '') {
        err_out(401, 'Unauthorized', 'Invalid credentials');
    }
    if (!pbkdf2_verify((string)$password, $row['password_hash'])) {
        err_out(401, 'Unauthorized', 'Invalid credentials');
    }

    $sid = create_session($row['id']);
    $token = jwt_sign($row['id'], $row['email'], $row['role'], $sid);
    json_out(array(
        'token' => $token,
        'user' => array(
            'id' => $row['id'],
            'email' => $row['email'],
            'role' => $row['role'],
            'display_name' => $row['display_name'],
            'avatar_url' => $row['avatar_url'],
            'badges' => safe_json_parse($row['badges_json'], array()),
            'follows' => safe_json_parse($row['follows_json'], array()),
            'favorites' => safe_json_parse($row['favorites_json'], array()),
        ),
    ), 200);
}

function auth_logout() {
    require_auth();
    $hdr = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
    $token = trim(substr($hdr, 7));
    $payload = jwt_verify_token($token);
    if ($payload !== null && isset($payload['sid'])) {
        revoke_session($payload['sid']);
    }
    http_response_code(204);
    exit;
}

function auth_me() {
    $u = require_auth();
    $row = db_one('SELECT * FROM users WHERE id = ?', array($u['id']));
    if ($row === null) err_out(404, 'Not found', 'User not found');
    json_out(array(
        'id' => $row['id'],
        'email' => $row['email'],
        'role' => $row['role'],
        'display_name' => $row['display_name'],
        'avatar_url' => $row['avatar_url'],
        'badges' => safe_json_parse($row['badges_json'], array()),
        'follows' => safe_json_parse($row['follows_json'], array()),
        'favorites' => safe_json_parse($row['favorites_json'], array()),
        'custom_lists' => safe_json_parse($row['custom_lists_json'], array()),
        'vibe_spectrum' => safe_json_parse($row['vibe_spectrum_json'], null),
        'created_at' => $row['created_at'],
    ), 200);
}

function auth_refresh() {
    $u = require_auth();
    $row = db_one('SELECT * FROM users WHERE id = ?', array($u['id']));
    if ($row === null) err_out(404, 'Not found', 'User no longer exists');
    $role = ($row['role'] === null || $row['role'] === '') ? 'user' : $row['role'];
    $hdr = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
    $token = trim(substr($hdr, 7));
    $payload = jwt_verify_token($token);
    if ($payload !== null && isset($payload['sid'])) {
        $newToken = jwt_sign($row['id'], $row['email'], $role, $payload['sid']);
        json_out(array('token' => $newToken, 'user' => array('id' => $row['id'], 'email' => $row['email'], 'role' => $role)), 200);
    }
    err_out(400, 'Bad request', 'Cannot refresh');
}
