<?php
// Router for PHP built-in dev server — mimics the lighttpd rewrite rules:
//   ^/api(/.*)?$  => /api/index.php
//   ^/health$     => /api/index.php
// Everything else: static file from public/, SPA fallback to index.html.
//
// v12.1: under `php -S` (the serve.sh NAS topology) the built-in server sends
// NO cache headers for static files, so every visit re-fetches/revalidates
// the whole 2.5 MB bundle and — worse — index.html + anisync-patches.js can
// be held by heuristic browser caching for DAYS after a deploy (the exact
// mechanism that kept the old v4 engine alive in clients after upgrading).
// Known asset classes are now served from PHP with explicit policy:
//   - Vite content-hashed chunks  -> immutable, 1 year
//   - anisync-patches.js          -> 5 minutes (hot-fixable)
//   - index.html                  -> no-cache (must always revalidate so new
//                                    deploys are picked up instantly)
$uri = $_SERVER['REQUEST_URI'];
$path = explode('?', $uri, 2)[0];

if (preg_match('#^/api(/.*)?$#', $path) || $path === '/health') {
    require __DIR__ . '/public/api/index.php';
    return true;
}

// Static assets
$file = __DIR__ . '/public' . $path;
if ($path !== '/' && is_file($file) && pathinfo($file, PATHINFO_EXTENSION) !== 'php') {
    $assetCache = null;
    if (preg_match('#^/assets/.+-[A-Za-z0-9_-]{8}\.(js|css)$#', $path)) {
        $assetCache = 'public, max-age=31536000, immutable';
    } elseif ($path === '/assets/anisync-patches.js') {
        $assetCache = 'public, max-age=300';
    }
    if ($assetCache !== null) {
        // Serve from PHP so we control the headers (php -S would not).
        // Plain readfile, no gzip: on a LAN the wire is cheap, the NAS CPU
        // is not. The immutable/max-age policy means each client fetches a
        // given chunk exactly once, ever.
        $mtime = @filemtime($file);
        $size = @filesize($file);
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $types = array(
            'js' => 'application/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8',
        );
        $etag = '"' . dechex($size) . '-' . dechex($mtime) . '"';
        header('Cache-Control: ' . $assetCache);
        header('ETag: ' . $etag);
        $ifNone = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
        if ($ifNone !== '' && $ifNone === $etag) {
            http_response_code(304);
            return true;
        }
        if (isset($types[$ext])) header('Content-Type: ' . $types[$ext]);
        header('Content-Length: ' . $size);
        header('X-Content-Type-Options: nosniff');
        @readfile($file);
        return true;
    }
    return false; // let the built-in server serve it (images, fonts, ...)
}

// SPA fallback — never let the browser cache the entry document.
header('Cache-Control: no-cache');
require __DIR__ . '/public/index.html';
return true;
