# ANISYNC v12 — Full Project Audit & Fix Report

*Scope: every aspect of the `anisync-backup.tar.gz` snapshot — the YouTube
iframe/link-selection pipeline, the link audit chain, request patterns,
NAS performance, bloat, and security posture. Companion to FIXES.md §19
(which documents the fix itself in deploy-order detail).*

---

## 0. Executive summary

The project is a **PHP + SQLite app wearing a React costume**. What actually
runs on the NAS is `lighttpd → public/ (prebuilt bundle) → public/api/*.php
→ data/anisync.sqlite`. The `src/` React tree and `server.ts` Express
backend are a *previous era* of the project that no longer matches the
deployed artifact.

The user-reported symptoms had one shared root cause: **the v10/v11
stream-audit engine documented in FIXES.md was missing from the code** —
reverted to stubs by a bad merge/restore. Everything the audit was supposed
to do (real link verification, points-based replacement selection,
ad-blocker-tolerant verdicts) was a no-op, and the runtime patch had decayed
to a blind first-result swapper.

| Symptom | Root cause | Fix (v12) |
|---|---|---|
| "Stream audit doesn't work" | `meta_verify_batch` only regex-checked ID *formats* — every well-formed link passed | Real multi-signal probe (`an_embed_probe`) + non-original title flagging, batched & cached |
| "Link selection is broken" | `an_resolve_candidates` returned the first search result with hardcoded `score=100, points=["verified"], duration=200` | Full points system (§18 spec), derivative floor, embeddability verification, real metadata, receipts |
| "YouTube iframes misbehave" | 72-line v4 patch: no error-100/5 handling, no 150 disambiguation, single blind swap, no fallback UI, hash nav missing | Rebuilt v12 patch: hard/ambiguous error split, server cross-check for 150, 3-hop verified swaps, Watch-on-YouTube pill, hash nav restored |
| "Lyrics never load" | `/api/lyrics` required Bearer auth; the drawer calls it with a bare `fetch` → silent 401 | Auth gate removed (LRCLIB proxy, rate-limited) |
| "NAS feels heavy" | No gzip, per-request rate-limit writes to flash, no static caching, unbounded `api_cache`, full-scan lookups, 4.9 MB dead files | See §4 |

---

## 1. What actually runs (architecture ground truth)

```
NAS (lighttpd :3000, PHP-CGI pool ×4)
├── public/index.html            ← entry, loads hashed chunks + anisync-patches.js
├── public/assets/*.js|css       ← PREBUILT React bundle (2.6 MB, 36 chunks)
├── public/api/
│   ├── index.php                ← router (all /api/* + /health)
│   ├── lib.php                  ← PDO SQLite, JWT auth, curl helpers, cache
│   ├── routes_auth.php          ← register/login/me (PBKDF2 + JWT + sessions)
│   ├── routes_db.php            ← /api/db/* (tracks, votes, tournaments, …)
│   ├── routes_google.php        ← OAuth + YouTube playlist export
│   └── routes_meta.php          ← metadata, scrapers, YouTube engine, audit
└── data/anisync.sqlite          ← 164 tracks, users, api_cache, embed_feedback
```

**Divergence (critical):** the deployed bundle authenticates via
`/api/auth/*` JWT (`anisync_jwt` in localStorage) and reads data from
`/api/db/*`. `src/App.tsx` still imports `firebase/auth` +
`firebase/firestore` and has *no* PHP calls. There is no saved source for
the deployed bundle — the PHP-era frontend source was never committed back.
**Consequence: `npm run build` today produces an app that cannot talk to
the PHP backend.** Treat `public/` as the artifact of record until the
source is reconciled. (The legacy Firebase/Express stack — `server.ts`,
`netlify/`, `deploy/`, `firestore.rules` — is kept but flagged; removing it
is a decision call, not a cleanup.)

## 2. The link-audit chain — what was broken, piece by piece

### 2.1 `POST /api/verify-batch` (the Stream Auditor's eye) — FAKE
Old body: `preg_match("/^[A-Za-z0-9_-]{11}$/", $id)` → `results[$id]=true`.
No HTTP call. No probe. The admin UI's `[OK] "..." link check pass` lines
were theater; `[FAIL]` could only appear for malformed ids (which the DB
never contains). Repair logic downstream never triggered.

### 2.2 `an_resolve_candidates` (the repair picker) — FAKE
Old body: one `yt_search($title . " " . $artist . " full song", 15)`, then
every result returned with `score=100, points=["verified"], duration=200,
state="ok", via="direct", verified=true` — zero probing, zero scoring.
`meta_embed_fallback` v2 handed these to the browser patch, which swapped
`candidates[0]` into the iframe and **persisted it to the DB** — an
unverified, unscored, possibly-also-blocked or cover-version link. The
in-tree `an_candidate_points` even contradicted the documented spec
(inverted to "official +80 / fan −30" from the fan-first +120/−420 spec).

### 2.3 `anisync-patches.js` (the browser ear) — DECAYED
72 lines: listened for `onError` 101/150/2 only (100 = *video deleted* was
ignored entirely), swapped once per video per page load, no disambiguation
(YouTube error 150 is manufactured by ad blockers on ad-bearing videos —
the exact false-positive massacre FIXES.md §18 describes), no
Watch-on-YouTube fallback despite `index.html` advertising it, and no hash
navigation despite `index.html`'s comment claiming it ships.

### 2.4 The working infra that was never called
`an_embed_probe` (oEmbed + InnerTube WEB_EMBEDDED_PLAYER + Data API +
browser feedback, curl_multi-parallel, SQLite-cached),
`an_classify_embed`, `an_curl_multi_generic`, the `embed_feedback` table —
all present, all correct, all orphaned by the stubs. v12 rewires them.

### 2.5 The v12 chain (now)
```
Admin "Initialize stream audit"
  → POST /api/verify-batch {ids}
      → an_embed_probe(ids)          (oEmbed ∥ InnerTube ∥ DataAPI, cached)
      → title-lexicon flags          (non-original tracks condemned)
      → results{id: alive, states, reasons}
  → for dead tracks: POST /api/resolve-batch {tracks, existingYtIds}
      → an_resolve_candidates         (search → score → floor → probe → sort)
      → resolved{trackId: verifiedBestId} + details{receipt}
  → SPA saves; player errors self-heal via anisync-patches.js v12
```
Live-player self-healing: hard errors (2/5/100/101) repair immediately;
error 150 first asks `/api/verify-video` — server-alive ⇒ ad-blocker noise
⇒ no DB churn, just the Watch-on-YouTube pill; server-dead ⇒ repair.
Browser hard-failure reports feed `embed_feedback` so future audits start
from browser truth (never sent for 150 — positive-only, §18.1).

## 3. Request patterns & the NAS bill (before → after)

| Cost | Before | After |
|---|---|---|
| Boot payload `/api/db/tracks` | 43.5 KB raw, re-downloaded every load | gzip → ~6.8 KB; ETag ⇒ 304 (~200 B) on unchanged boots |
| Static assets (2.5 MB, 36 chunks) | revalidated every visit (no expire headers, no compress) | immutable 365-day cache + on-disk gzip; ~0 repeat cost |
| Rate limiter | 1 SQLite WAL write txn **per API request** (even LAN) | skipped for RFC1918/ULA; public clients unchanged |
| `api_cache` | unbounded growth (expired cooldown rows forever) | GC'd 1-in-100 requests |
| Embed probes | N/A (never ran) | batched, cached 6 h/24 h; ≤8 candidates probed per repair |
| Drawer opens (deployed bundle) | `/api/anime-search` (→ Kitsu, uncached server-side), `/api/verify-video`, `/api/lyrics` (401!) per open | lyrics fixed; verify + covers served from SQLite cache after first hit |
| Audits | 0 real network cost, 0 value | real first sweep (~1–2 min for 164 tracks, parallel), then cached ≈ free |

Deployed-bundle client behaviors (unchangeable without a rebuild, documented
for the next frontend round): the drawer fires 3 requests per open even if
you never open the lyrics tab; `anime-search` cover lookups have no
client-side cache (server cache now absorbs it); the audit UI paces 25 ids
per call. The v12 patch's hash-nav adds no requests (pure DOM clicks).

## 4. NAS performance & flash-wear fixes (all in FIXES.md §19.3)

1. **gzip JSON** in `json_out()` (−84 % on the tracks payload).
2. **LAN rate-limit skip** — removes the dominant per-request WAL write.
3. **`api_cache` GC** in `an_lazy_gc()` on `db()` boot.
4. **SQLite tuning**: `cache_size=-8000`, `temp_store=MEMORY`,
   `wal_autocheckpoint=2000`.
5. **Schema v4** `idx_tracks_yt` (auto-migrates; rehearsed on a DB copy —
   `EXPLAIN QUERY PLAN` now uses the index).
6. **ETag + max-age=30** on `/api/db/tracks`.
7. **lighttpd**: `mod_compress` (+ `/tmp/anisync-compress` cache dir),
   `mod_expire` (hashed assets 365 d immutable; `anisync-patches.js` 5 min
   — it is not content-hashed and must reach clients).
8. **php.ini**: `realpath_cache_size=96K / ttl=600`.
9. **`an_raw_input()`** unified body reader (fixes the PHP < 5.6
   double-read corruption class; `get_json_body` + `db_track_update_yt`
   migrated).
10. **set_time_limit** headroom on audit endpoints (php.ini's 30 s killed
    big sweeps mid-flight → 500s).

## 5. Bloat audit — what was deleted vs. kept

**Deleted (~4.9 MB + ~4,500 lines, every deletion import-graph-verified):**
17 root `test-*.ts` probes (13 imported `node-fetch`, which isn't even a
dependency), `replace_arena.js`/`replace_brackets.js` codemods,
`router.php` (byte-identical duplicate of `dev_router.php`), `koyeb.yaml`
(self-declared "DO NOT USE"), `public/500.html`/`_redirects`/`_headers`
(Netlify artifacts lighttpd ignores), `public/logo.png` (824 KB, zero
references), the orphan `index-FIXED-*.js` chunk, `src/assets/` (3.9 MB —
a stale 2,589-line App.tsx snapshot + never-imported images), 13 dead src
modules, 7 of 9 gamification components, dead `an_check_playability()`.
`package.json`: `@formkit/auto-animate`, `@nivo/radar`,
`react-content-loader` dropped; duplicate `@phosphor-icons/react` key fixed.

**Kept (legacy, documented):** `server.ts` (4,220 lines, referenced only by
non-NAS deploy targets), `netlify/`, `deploy/`, `Dockerfile`, `render.yaml`,
`nixpacks.toml`, firebase configs, and the `src/` Firebase tree — see the
divergence warning in §1. Deleting them is correct *only after* deciding
"NAS + PHP forever"; that call belongs to the owner.

## 6. Security & correctness notes (observed, not all fixed)

- JWT secret is **committed in `config.php`** (fine for LAN; rotate if the
  repo is ever shared publicly). Auto-generated fallback exists.
- YouTube Data API key is baked into `config.php` (v6 owner decision).
- `an_curl` verifies TLS by default with an insecure retry ladder for old
  NAS CA bundles; `ANISYNC_INSECURE_TLS=true` force-disables verification.
- OAuth redirect endpoints disabled by default (empty client id → 503).
- v12 keeps the auth matrix: verify-batch/resolve-batch/resolve-single
  still require the JWT (the admin UI's `H()` helper attaches it);
  lyrics/anime-search/verify-video/embed-fallback/embed-feedback-batch are
  intentionally anonymous (used by unauthenticated surfaces) with
  rate limits intact.
- The `ModerationDashboard` moderation-preview iframes have no
  `enablejsapi` — player errors there are silent; server-side verification
  covers the audit path instead.

## 7. How to verify on the NAS (10 minutes)

```bash
# 1. deploy + restart (schema v4 index self-applies)
/etc/init.d/anisync restart

# 2. compress cache dir (once)
mkdir -p /tmp/anisync-compress && chown www-data:www-data /tmp/anisync-compress

# 3. sanity: health + gzip + etag
curl -s http://nas:3000/health
curl -sH 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download} bytes\n' http://nas:3000/api/db/tracks   # ~7 KB not 43 KB
curl -sD- -o /dev/null -H 'If-None-Match: "<etag from first call>"' http://nas:3000/api/db/tracks | head -1    # 304

# 4. the audit: log in as admin → Moderation → Maintenance Hub → Initialize stream audit
#    expect real [FAIL ... (dead|embed-blocked|non-original)] lines with reasons,
#    [POINTS] receipts in the browser console, and repairs that stick.

# 5. CLI sweep (same engine, receipts in --dry-run)
php bulk_stream_repair.php --dry-run
```

## 8. Recommended next rounds (not done — decision required)

1. **Reconcile `src/` with the deployed bundle** (port the PHP calls into
   `src/`, or freeze `public/` as the artifact and delete the Firebase
   tree). Until then: do not run `npm run build` expecting a deployable app.
2. Server-side cache for `/api/anime-search` covers (Kitsu) — the drawer
   re-requests per open; a 24 h `api_cache` entry removes the outbound.
3. YouTube playlist export is sequential (pins a PHP worker for minutes on
   50-track exports) — batch the playlist-item inserts.
4. The ETag is weak (count + tallies + max rowid); consider a proper
   `updated_at` column if 304 correctness ever matters.
5. The `php.ini` `max_execution_time=30` vs audit sweeps: v12 raises limits
   in-code, but raising the global to 60 is simpler if you audit often.
