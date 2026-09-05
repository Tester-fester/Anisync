#!/bin/sh
# =============================================================================
# Anisync dev launcher (v4).
#
# The single-threaded `php -S` server was the cause of the "UI freezes ~4s
# when I search during a stream audit": every request — including static
# chunk fetches for the search palette — queued behind the audit's long
# verify-batch/resolve-batch calls. PHP 7.4+ supports worker pools via
# PHP_CLI_SERVER_WORKERS, so the audit runs in one worker while the UI
# keeps getting instant responses from the others.
#
# Usage:   ./serve.sh            (port 8080, 8 workers)
#          PORT=3000 ./serve.sh
# =============================================================================
cd "$(dirname "$0")" || exit 1

if ! command -v php >/dev/null 2>&1; then
    echo "error: php not found in PATH" >&2
    exit 1
fi

PORT="${PORT:-8080}"
WORKERS="${PHP_CLI_SERVER_WORKERS:-8}"

# Older PHP (< 7.4) ignores the variable and stays single-threaded — warn.
PHPVER=$(php -r 'echo PHP_VERSION;' 2>/dev/null)
case "$PHPVER" in
    5.*|7.0.*|7.1.*|7.2.*|7.3.*) echo "note: PHP $PHPVER has no worker pool; consider lighttpd for concurrency" ;;
esac

echo "Anisync dev server → http://localhost:$PORT  (workers: $WORKERS)"
# v4 FIX: docroot MUST be public/ — with `-t .` every /assets/* request
# missed the filesystem and fell through to the SPA fallback, so the JS
# bundle (and the app itself) never actually loaded in dev.
PHP_CLI_SERVER_WORKERS="$WORKERS" exec php -S 0.0.0.0:"$PORT" -t public dev_router.php
