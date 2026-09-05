#!/bin/sh
# =============================================================================
# deploy/verify-deploy.sh — v12.1 one-command deployment self-check.
#
# After copying the new tree to the NAS and (re)starting serve.sh, run this
# ON THE NAS (or point BASE at it from another box):
#
#     sh deploy/verify-deploy.sh                 # defaults to :8080
#     BASE=http://127.0.0.1:8080 sh deploy/verify-deploy.sh
#
# It answers the question that cost us a whole debugging round last time:
# "is the NAS actually serving the new code, or is the old copy still live?"
# (The browser console line "[AniSync] v12.1 engine online" is the
# client-side half of the same check.)
# =============================================================================
BASE="${BASE:-http://127.0.0.1:8080}"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  [OK]   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

echo "AniSync v12.1 deploy check against $BASE"
echo "---------------------------------------------------------"

# 1) Engine stamp (new in v12.1) — the definitive "is the new code live" test.
HEALTH=$(curl -s -m 8 "$BASE/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"engine":"12.1"'; then
    ok "/health reports engine 12.1"
else
    bad "/health engine stamp missing (got: $(echo "$HEALTH" | head -c 120)) — the OLD code is still being served"
fi

# 2) API gzip is active (json_out).
ENC=$(curl -s -o /dev/null -m 8 -H 'Accept-Encoding: gzip' -D - "$BASE/api/db/tracks?limit=5" 2>/dev/null | grep -i '^content-encoding: gzip' | head -1)
if [ -n "$ENC" ]; then
    ok "API responses are gzipped"
else
    bad "API responses are NOT gzipped"
fi

# 3) Conditional-GET: second fetch with the ETag must be a 304.
ETAG=$(curl -s -o /dev/null -m 8 -D - "$BASE/api/db/tracks?limit=5" 2>/dev/null | grep -i '^etag:' | head -1 | sed 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//' | tr -d '\r')
if [ -z "$ETAG" ]; then
    bad "tracks endpoint sends no ETag"
else
    CODE=$(curl -s -o /dev/null -m 8 -H "If-None-Match: $ETAG" -w '%{http_code}' "$BASE/api/db/tracks?limit=5" 2>/dev/null)
    if [ "$CODE" = "304" ]; then
        ok "tracks ETag revalidation -> 304"
    else
        bad "tracks ETag revalidation returned $CODE (expected 304)"
    fi
    CODE2=$(curl -s -o /dev/null -m 8 -H "If-None-Match: $ETAG" -w '%{http_code}' "$BASE/api/db/history?limit=5" 2>/dev/null)
    if [ "$CODE2" = "200" ]; then
        ok "history endpoint independent ETag (200 on foreign tag)"
    else
        bad "history endpoint returned $CODE2 for a foreign ETag (expected 200)"
    fi
fi

# 4) Static asset caching under php -S (dev_router serves /assets with policy).
CC=$(curl -s -o /dev/null -m 8 -D - "$BASE/assets/anisync-patches.js" 2>/dev/null | grep -i '^cache-control:' | head -1)
if echo "$CC" | grep -q 'max-age'; then
    ok "anisync-patches.js served with Cache-Control ($CC)"
else
    bad "anisync-patches.js has no Cache-Control — old dev_router is live"
fi

# 5) The deployed patch file is the v12.1 engine.
BODY=$(curl -s -m 8 "$BASE/assets/anisync-patches.js" 2>/dev/null)
if echo "$BODY" | grep -q "v12.1 engine online"; then
    ok "anisync-patches.js is the v12.1 engine"
elif echo "$BODY" | grep -q "Stable YouTube Player Engine Initialized"; then
    bad "anisync-patches.js is the OLD v4 engine — replace public/assets/anisync-patches.js"
else
    bad "anisync-patches.js contents unrecognized"
fi

# 6) Plausible beacon removed from the entry document.
IDX=$(curl -s -m 8 "$BASE/" 2>/dev/null)
if echo "$IDX" | grep -q 'plausible.io/js/script.js'; then
    bad "index.html still loads the plausible.io beacon"
else
    ok "no plausible.io beacon in index.html"
fi

# 7) The seed / SPA fallback still works (docroot sanity).
ROOTCODE=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$BASE/" 2>/dev/null)
if [ "$ROOTCODE" = "200" ]; then
    ok "SPA entry document serves 200"
else
    bad "SPA entry document returned $ROOTCODE"
fi

echo "---------------------------------------------------------"
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "Deployment verified — remember to hard-refresh the browser (Ctrl+Shift+R) once."
exit $FAIL
