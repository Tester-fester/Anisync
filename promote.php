<?php
/**
 * promote.php — first-admin helper for Anisync MBL (PHP 5.3 compatible).
 *
 * Usage (from the project root, or anywhere):
 *   php promote.php alice@example.com                    # promote to admin
 *   php promote.php alice@example.com --password SECRET # promote + reset password
 *   php promote.php --seed                               # seed starter tracks only
 *   php promote.php alice@example.com --seed             # both
 *
 * The --password flag is NEW (FIX): it also (re)sets the account's password,
 * which is the supported way to recover an admin account whose password was
 * lost. The password must be 8+ chars with at least one letter and one digit.
 *
 * After promoting, the user must log out and back in inside the app
 * (the JWT role is re-read on every request, but the client caches
 * the profile until refresh).
 */

$APP = '/DataVolume/anisync/public/api';
if (is_file(__DIR__ . '/public/api/lib.php')) {
    // Running from the extracted bundle.
    $APP = __DIR__ . '/public/api';
}
require_once $APP . '/lib.php';
require_once $APP . '/routes_db.php'; // an_insert_track lives here (function defs only)

$args = array_slice($_SERVER['argv'], 1);
$email = null;
$seed = false;
$newPassword = null;
$argCount = count($args);
for ($i = 0; $i < $argCount; $i++) {
    $a = $args[$i];
    if ($a === '--seed') { $seed = true; }
    elseif ($a === '--password' && isset($args[$i + 1])) { $newPassword = $args[$i + 1]; $i++; }
    elseif ($a !== '' && $a[0] !== '-') { $email = strtolower($a); }
}

if ($email === null && !$seed) {
    echo "usage: php promote.php [email] [--password SECRET] [--seed]\n";
    echo "  email     promote this user to admin\n";
    echo "  --password SECRET   also reset the user's password (8+ chars, letter + number)\n";
    echo "  --seed    load the starter tracks (if the tracks table is empty)\n";
    exit(1);
}

if ($newPassword !== null) {
    if (!is_string($newPassword) || strlen($newPassword) < 8 || strlen($newPassword) > 200
        || !preg_match('/[a-zA-Z]/', $newPassword) || !preg_match('/\d/', $newPassword)) {
        fwrite(STDERR, "password must be 8+ chars with at least one letter and one number\n");
        exit(1);
    }
}

if ($email !== null) {
    $row = db_one('SELECT id, email, role FROM users WHERE email = ?', array($email));
    if ($row === null) {
        fwrite(STDERR, "no user with email {$email} — register through the web UI first\n");
        exit(1);
    }
    db_run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', array('admin', now_ms(), $row['id']));
    echo "promoted {$email} to admin (log out + back in inside the app)\n";

    if ($newPassword !== null) {
        $hash = pbkdf2_hash($newPassword);
        db_run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', array($hash, now_ms(), $row['id']));
        // Revoke all existing sessions for this user (password reset = forced logout).
        db_run('DELETE FROM sessions WHERE user_id = ?', array($row['id']));
        echo "password for {$email} has been reset (all active sessions revoked)\n";
    }
}

if ($seed) {
    $row = db_one('SELECT COUNT(*) AS n FROM tracks', array()); $count = $row ? (int)$row['n'] : 0;
    if ($count > 0) {
        echo "tracks table already has {$count} rows — skipping seed\n";
        exit(0);
    }
    $seedFile = $APP . '/seed.json';
    if (!is_file($seedFile)) {
        fwrite(STDERR, "seed.json not found next to the api directory\n");
        exit(1);
    }
    $tracks = safe_json_parse(file_get_contents($seedFile), null);
    if (!is_array($tracks)) {
        fwrite(STDERR, "seed.json is corrupted\n");
        exit(1);
    }
    db()->beginTransaction();
    $n = 0;
    foreach ($tracks as $t) {
        if (empty($t['id']) || empty($t['title']) || empty($t['youtubeId'])) {
            // SEEDED_TRACKS entries have no id — generate one.
            $t['id'] = generate_id('tr');
        }
        an_insert_track($t, false);
        $n++;
    }
    db()->commit();
    echo "seeded {$n} starter tracks\n";
}

exit(0);

