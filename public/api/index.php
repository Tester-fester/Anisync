<?php
// CLI & Server Environment Bridge
if (getenv("REQUEST_URI")) $_SERVER["REQUEST_URI"] = getenv("REQUEST_URI");
if (getenv("REQUEST_METHOD")) $_SERVER["REQUEST_METHOD"] = getenv("REQUEST_METHOD");
if (getenv("HTTP_AUTHORIZATION")) $_SERVER["HTTP_AUTHORIZATION"] = getenv("HTTP_AUTHORIZATION");
if (getenv("HTTP_CONTENT_TYPE")) $_SERVER["HTTP_CONTENT_TYPE"] = getenv("HTTP_CONTENT_TYPE");
/**
 * Anisync MBL — API entry point (single router for /api/* + /health).
 *
 * lighttpd rewrites every /api/* request here; REQUEST_URI holds the
 * original path. Static files (React build) are served directly by
 * lighttpd from ../public/.
 */

require_once dirname(__FILE__) . '/lib.php';
require_once dirname(__FILE__) . '/routes_auth.php';
require_once dirname(__FILE__) . '/routes_db.php';
require_once dirname(__FILE__) . '/routes_google.php';
require_once dirname(__FILE__) . '/routes_meta.php';

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------
$uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$parts = explode('?', $uri, 2);
$path = $parts[0];
if (isset($parts[1])) {
    parse_str($parts[1], $query_params);
    $_GET = array_merge($_GET, $query_params);
    $_REQUEST = array_merge($_REQUEST, $query_params);
}
$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';

// Basic security headers on every API response.
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

try {
    // ---- /health (probe target; no auth, no rate limit) --------------------
    if ($path === '/health' || $path === '/api/health') {
        json_out(array(
            'status' => 'ok',
            // v12.1: engine stamp — deploy verification asserts this so a
            // stale docroot (old code still being served) is caught in one
            // curl instead of "thing still aint working" archaeology.
            'engine' => ANISYNC_ENGINE,
            'uptime' => (int)(microtime(true) - ANI_START_TS),
            'ts' => now_ms(),
            'gemini' => GEMINI_API_KEY !== '',
        ), 200);
    }

    // ---- /api/* routing ----------------------------------------------------
    if (strpos($path, '/api/') === 0) {
        $sub = substr($path, 5); // after "/api/"

        // Auth endpoints: strict-ish limiter (30/min — brute-force slowdown).
        if (strpos($sub, 'auth/') === 0) {
            rate_limit(30);
            route_auth($method, substr($sub, 5));
        }

        // DB CRUD endpoints.
        if (strpos($sub, 'db/') === 0) {
            rate_limit(120);
            route_db($method, substr($sub, 3));
        }

        // Google OAuth + YouTube export (mounted at BOTH paths).
        if (strpos($sub, 'google/') === 0) {
            rate_limit(120);
            route_google($method, substr($sub, 7));
        }
        if (strpos($sub, 'youtube/') === 0) {
            rate_limit(120);
            $act = substr($sub, 8);
            if ($act === 'export-playlist') { route_google($method, 'export-playlist'); }
            err_out(404, 'Not found', 'Unknown youtube endpoint');
        }

        // Everything else: metadata / AI / proxy endpoints (rate-limited
        // individually inside route_meta with per-endpoint tiers).
        route_meta($method, $sub);
    }

    // Non-API path reaching PHP → not expected (lighttpd serves static);
    // respond as the SPA fallback would.
    err_out(404, 'Not found', 'Not an API endpoint');
} catch (PDOException $e) {
    json_out(array('error' => 'Internal', 'message' => 'Database error: ' . $e->getMessage()), 500);
} catch (Exception $e) {
    json_out(array('error' => 'Internal', 'message' => $e->getMessage()), 500);
}
