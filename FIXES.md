# ANISYNC — Fix Report & Setup Guide (PHP + SQLite build)

This build repairs the PHP/SQLite backend (`public/api/`) that powers account
creation, login, the moderation (mod) tools, and the Stream Auditor.
Everything was verified end-to-end with an automated regression suite
(64 checks, all passing) plus live HTTP tests.

> **v11 (current)** — the stream audit stopped crying wolf: in an
> ad-suspect environment (ad blocker breaking ad-bearing embeds with
> error 150) the browser's error-150 verdict is INCONCLUSIVE — the
> server's verdict stands, so healthy tracks no longer print DEAD
> STREAM DETECTED and trigger pointless repairs (the v10 bug the
> user's log exposed: ~19/25 healthy tracks massacred). AND every
> repair link now wins a transparent **POINTS race** — fan upload
> +120, full song +60, HD +20, lyrics +30 … cover -1500, **english
> version -1500** (new language-variant tier), remix -1500, TV size
> -350, official channel -420, duration +/-. Anything below the
> floor (-400) is never returned, so "original full songs only" is
> now points nobody can out-score; every pick comes with a receipt
> (resolve-batch "details": the hit list + score, logged in the
> browser console). See §18.
> Shipped DB: **164 tracks** (the v6 pristine-repaired library —
> 133 fan / 31 official, 0 geo-fragile), unchanged.
> Test totals: 64 (v11) + 61 (v10) + 40 (v6) + 20 (v5) + 53 E2E checks, all green.

---

## Admin account

| Field    | Value                 |
|----------|-----------------------|
| Email    | `admin@test.com`      |
| Password | `AnisyncAdmin2026`    |
| Role     | admin                 |

Sign in through the app's Account modal (Sign In tab). The account was
password-reset with `promote.php`; all previously issued sessions were
revoked. The other pre-existing admin (`mfrimi100@gmail.com`, display name
"Johan") is untouched — if you own that address you can reset its password
with:

```bash
php promote.php mfrimi100@gmail.com --password 'YourNewPass1'
```

`promote.php` is the supported account-recovery tool: it promotes a user to
admin, optionally resets the password, and can seed starter tracks.

---

## Quick start (any PHP host with pdo_sqlite + curl)

```bash
# 1. Point your webserver document root at public/
# 2. Make the data directory writable by the PHP user
chmod -R 775 data/

# PHP built-in server (local test) — v4: use serve.sh, or this:
PHP_CLI_SERVER_WORKERS=8 php -S 0.0.0.0:3000 -t public dev_router.php
# (`-t public` is REQUIRED: with `-t .` every /assets/* request missed the
#  filesystem and the app never actually loaded. The workers pool keeps the
#  UI responsive while long stream-audit requests run.)

# or simply:
./serve.sh            # port 8080, 8 workers, docroot public/

# lighttpd (WD My Book Live): use the shipped lighttpd.conf — the same
# relative layout (/DataVolume/anisync/{public,data}) works unchanged.
```

The SQLite database is `data/anisync.sqlite` (164 starter tracks, 3 users).
It is found automatically via `public/api/config.php` (relative path, or the
`ANISYNC_DB_PATH` environment variable override).

---

## What was broken → what was fixed

### 1. Account creation & login (the main request)
- **`public/api/config.php` hardcoded the database at
  `/DataVolume/anisync/data/anisync.sqlite`** (a NAS path that does not exist
  on normal servers). Every register/login call died with
  `unable to open database file`. Now the path is relative by default
  (works in the zip layout AND on the MBL), with env-var override support.
- **`JWT_SECRET` was the placeholder `REPLACE_WITH_64_HEX_CHARS`** — every
  token was signed with a public string. A real 64-hex secret is baked in,
  and if it is ever left empty lib.php auto-generates and persists one in
  `data/jwt_secret.key`.
- **Partial configs crashed PHP 7/8** (`undefined constant` fatals) because
  lib.php only defined fallback constants when `ANISYNC_DB_PATH` was missing.
  Every constant now gets an individual fallback.
- Login now trims whitespace around emails and purges expired session rows.

### 2. Moderation tools (AdminQueue)
- **Approving/rejecting proposals crashed with a fatal
  `Call to undefined function db_proposal_status_update()`** — the router
  called a function that never existed. Fixed (the handler is
  `db_proposal_status`). Same fatal for **follow/unfollow**
  (`db_user_toggle_follow` → `db_user_follow`) and for
  **GET /api/db/proposals/{id}** and **GET /api/db/reviews/{id}**
  (missing `db_proposal_get` / `db_review_get` — both newly defined).
- Proposal status changes and batch deletion are now admin-only (403 for
  regular users, verified).
- The proposal queue itself now requires sign-in (matches the original
  Firestore rules), while regular users can still submit proposals.

### 3. Stream Auditor ("stream audit and stuff")
- The auditor's **save-repair call** (`POST /api/db/tracks/{id}/yt`) opened
  its own SQLite connection at the hardcoded `/DataVolume` path — repairs
  silently failed everywhere except that exact NAS. It now uses the shared
  `db()` connection (respects `ANISYNC_DB_PATH`). The same fix was applied to
  `db_tracks_bulk_update` (now routed at `/api/db/tracks/bulk-update`) and
  `db_artist_profiles_list`.
- **All outbound HTTP was force-routed through a third-party Cloudflare
  Worker** (`calm-sun-495b.mfrimi100.workers.dev`) — a single point of
  failure for the auditor and every scraper. Requests are now direct by
  default; the worker is an opt-in fallback via `ANISYNC_HTTP_PROXY` in
  config.php.
- TLS certificates are now **verified** by default (they were disabled
  globally). Old NAS PHP builds with broken CA bundles automatically retry
  once without verification; `ANISYNC_INSECURE_TLS = true` forces the old
  behaviour.
- `bulk_stream_repair.php` (CLI auditor) no longer hardcodes the DB path and
  supports `--dry-run`.
- `verify-batch` / `resolve-batch` now require sign-in (matches the Node
  reference server).

### 4. Routing bugs caused by the client's POST helper
The React client's write helper always sends **POST** (it ignores the HTTP
verb), which silently mis-routed several endpoints:
- **`updateTrackInDb` (POST /api/db/tracks/{id} with a body) was executing
  the DELETE handler** — updating a track deleted it. Now: body present →
  update, empty body → delete.
- **`savePokedexCollectible` (POST with a body) also hit the DELETE
  handler** — saving a collectible erased it. Same body-based routing fix.
- **GET /api/db/users/{id} ran the update handler** and returned
  `{ok:true,updated:0}` instead of the profile. Now returns the profile
  (emails hidden from anonymous callers).
- **GET /api/db/artist-profiles/{name} performed a WRITE** (it upserted an
  empty artist row on every lookup!). Now it reads, 404s cleanly, and the
  list endpoint returns proper camelCase objects instead of raw DB rows.

### 5. Arena voting
- `POST /api/db/match-vote` was a **stub** that returned `{success:true}` and
  never wrote anything — and it demanded `winnerId/loserId` fields the client
  doesn't even send (the winner lives in `newHistItem.winnerId`). It now
  accepts the real client shape and persists history + ELO/W-L-D in one
  transaction, identical to the batch endpoint.
- Both vote endpoints require sign-in (the client already only sends votes
  for signed-in users — anonymous votes are simulated locally by design).

### 6. Security holes closed
- `/api/db/users` was fully public and leaked **every user's email**. It
  still works for anonymous visitors (the app polls it on boot for
  leaderboard cards) but emails are only exposed to the profile owner or
  admins.
- Destructive endpoints were unauthenticated: **any anonymous visitor could
  wipe the whole tracks table** (`/api/db/tracks/reset`, `batch-delete`,
  `bulk`, `batch-anime-name`). All now require admin. Pokedex put/delete are
  admin-only (matches the Firestore rules "admin only"). Track create/update
  and sub-resource updates (yt/tags/image/anime-name) require sign-in.
- `current_user()` null-access warnings (PHP 8) replaced with clean 401s.
- Follows now also maintain `followers_count` transactionally.

### 7. CLI robustness
- `json_body()`/`an_request_has_body()` now fall back to a **cached,
  non-blocking stdin read** on the CLI SAPI (php://input is empty there), so
  the env-bridge execution mode and cron scripts work without hanging on a
  TTY.

---

## v4 round — embed-blocked streams, `#` page navigation, audit UI lag

### 8. "Video unavailable" in our player while the video plays on youtube.com
**Root cause** — two separate problems stacked:

1. **The audit's repair never verified its replacements.**
   `resolve_youtube_id()` returned the top-scored YouTube search hit with **no
   liveness/embeddability check at all**, so "repairs" routinely swapped dead
   videos for *other* dead or embed-blocked ones. YouTube videos that live in
   three distinct states — alive+embeddable (oEmbed 200), alive but
   **embed-blocked** (owner disabled embedding; plays on youtube.com, refuses
   to play inside iframes) and dead (oEmbed 400/404) — were all treated the
   same.
2. **The server-side check can lie.** YouTube aggressively bot-flags
   datacenter/NAS IPs: oEmbed then returns 403/429 for *perfectly fine*
   videos, and the old code called every non-200 "DEAD" — so the audit kept
   churning good streams through endless fake "repairs" (exactly what the
   sweep log showed: 50 "dead" videos that all play fine on YouTube).

**Fixes**
- `meta_verify_batch` / `meta_verify_video` now classify oEmbed status codes
  (`ok` / `dead` / `embed-blocked` / `unknown`) and **never flag `unknown`
  (bot-flagged) IDs as dead** — no more churn. Results are cached
  (6h/24h/15min by verdict) so re-audits are near-instant.
- `resolve_youtube_id()` **verifies replacement candidates via oEmbed before
  returning them** (prefers 200-verified; falls back to best-scored
  non-known-bad). Repairs now point at streams that actually work.
- **The browser is the ground truth**: a new runtime watcher
  (`public/assets/anisync-patches.js`, loaded by `public/index.html`)
  subscribes to the YouTube iframe player's `onError` events (101/150 =
  embed-blocked, 100/2/5 = dead). On failure it POSTs to the new
  **`/api/embed-fallback`** endpoint, which (a) records the verdict in a new
  `embed_feedback` table — future audits then flag that ID **even when oEmbed
  says 200**, closing the false-pass loop — and (b) resolves + persists a
  verified replacement, which the player hot-swaps to ("Rerouted … to a
  working stream"). If no replacement exists, a **▶ Watch on YouTube**
  button links straight to the video (it plays fine on youtube.com).
  Duplicate reports are rate-limited (30/min) and repair-cooled down (5 min).
- `embed_feedback` is created automatically on first use (and added to
  `schema.sql` for fresh installs) — no manual migration needed.

### 9. `#`-page navigation was missing entirely
The SPA is pure React state — the URL **never changed**, so deep links,
 bookmarks and the browser back/forward buttons did nothing. The watcher
 script now maps the URL hash onto the app's tabs and keeps it in sync:
 `#home` `#arena` `#tournament` `#moderation` `#submissions` `#profile`
 `#pokedex` `#search` (also `#leaderboard`, `#suggest` aliases). Clicking a
 tab updates the hash; back/forward walk the history; loading
 `/#arena` opens straight into the Arena.

### 10. ~4s UI freeze when searching during a stream audit
- **Dev server**: `php -S` is single-threaded — the search palette's lazy
  JS chunk queued **behind** the audit's multi-second verify-batch call.
  `serve.sh` now starts the server with `PHP_CLI_SERVER_WORKERS=8`
  (PHP ≥ 7.4). Verified: UI requests answer in **7–18 ms while a live audit
  runs**, versus blocking for the audit's full duration before.
- **Production lighttpd**: PHP fastcgi pool raised `2 → 4` children for the
  same reason.
- Bonus root-cause fix found on the way: the documented quick start
  `php -S 0.0.0.0:3000 -t . dev_router.php` had the **wrong docroot** — every
  `/assets/*` request missed the filesystem, fell through to the SPA fallback
  and the JS bundle never actually executed. Correct docroot is `public/`
  (`-t public`; `serve.sh` does it for you).

### v4 files changed

| File | Change |
|------|--------|
| `public/api/routes_meta.php` | embed-state classifier + cached multi-verify, verified `resolve_youtube_id`, new `/api/embed-fallback` endpoint |
| `public/api/schema.sql` | new `embed_feedback` table (+ auto-create at runtime) |
| `public/assets/anisync-patches.js` | NEW — embed-error watcher/auto-reroute/Watch-on-YouTube + hash page navigation |
| `public/index.html` | loads the patch script |
| `serve.sh` | NEW — dev launcher (8 workers, correct docroot) |
| `lighttpd.conf` | PHP fastcgi children 2 → 4 |
| `dev_router.php` | (unchanged, but now launched with `-t public`) |

### v4 testing
- Previous 64-check CLI regression suite: **still 64/64 passing**.
- New embed suite (**10/10**): malformed-ID rejection, report-only mode,
  verify-batch `results`+`statuses` shape, full embed-fallback flow (report →
  verified replacement found → persisted to DB → `fixedId` returned),
  feedback loop (`ok-reported` flips the audit verdict to FAIL), cooldown,
  persistence, auth still enforced on verify-batch.
- Browser (headless) verification: patch loads, app renders, `#arena` deep
  link activates the tab, tab clicks sync the URL (`#tournament`), browser
  **back** restores the previous tab, `#profile` deep link on fresh load,
  `enablejsapi=1` auto-injected into every YouTube iframe, zero console
  errors.
- Concurrency: static + API requests answer in 7–18 ms **during** a live
  25-ID audit.

## v5 round — "passed the check but the player still says video unavailable"

### 11. YouTube embed research — why a video can pass every server check and still refuse to play in an iframe

Empirically probed from the build machine (oEmbed + InnerTube with 5 client
identities + real headless-browser embeds + Data API docs + community
reports). A video that **plays on youtube.com but shows "video unavailable"
in an embedded player** has exactly one of these causes:

| # | Cause | What the server sees | What the browser sees |
|---|-------|----------------------|----------------------|
| 1 | Owner disabled embedding ("Allow embedding" off, or label/Content-ID **syndication rule**) | oEmbed usually **200** (existence only!), InnerTube WEB_EMBEDDED_PLAYER → `UNPLAYABLE "Playback on other websites has been disabled by the video owner"` | error **101/150** |
| 2 | **Age-gated** video | oEmbed **200**, InnerTube `LOGIN_REQUIRED` | sign-in screen / error |
| 3 | **Geo-locked** for the viewer's country (label rights per territory) | oEmbed **200** (server checks from ITS country), InnerTube may be OK from the server's country | error / "not available in your country" |
| 4 | **Bot-walled viewer or server IP** ("Sign in to confirm you're not a bot" — VPNs, incognito, datacenters) | InnerTube returns **fake** `ERROR "This video is unavailable"` for perfectly healthy videos — *verified: even Rick Astley's dQw4w9WgXcQ "fails" this way from a datacenter IP* | sign-in wall |
| 5 | Player dies **before initializing the JS API** (early playability refusal) | — | **NO postMessage events at all** → an `onError`-only watcher is *blind* — this is why v4's repair never fired for exactly these videos |
| 6 | Video deleted/private | oEmbed **400/404** | error **100** |

Three consequences drove the v5 design:

1. **oEmbed 200 ≠ embeddable.** It only proves the video exists. This is why
   v4's "verified" replacements could still show "video unavailable".
2. **No server can be the sole judge.** Any server IP can be bot-walled with
   fake failures (and the project deploys on datacenters: Koyeb/Render/NAS).
   The only ground truth for "does this embed play HERE" is the browser that
   actually plays it.
3. **onError alone is not enough.** Early-failing players never fire it.

### 12. The v5 fix — a four-layer verifier with the browser as ground truth

**Server (`routes_meta.php`)**
- `an_embed_probe()` — multi-signal verdict per video:
  **oEmbed** (404 = dead, 401 = embed-blocked, 200 = exists, 403/429 = wall)
  + **InnerTube `WEB_EMBEDDED_PLAYER`** (the exact context the iframe player
  queries; OK = embeddable, specific reason strings = embed-blocked /
  age / geo, "not a bot" = wall → ignored) + optional **YouTube Data API v3**
  (`YOUTUBE_API_KEY` in config/env → `status.embeddable`, `privacyStatus`,
  `uploadStatus`) + **`embed_feedback`** (real browsers' player errors —
  outranks everything).
- `an_classify_embed()` — pure classifier, unit-tested (20 cases). **Critical
  rule**: generic InnerTube "video unavailable" errors are **never** trusted
  (the wall produces them for healthy videos — the v3 mass-false-DEAD
  disaster must not repeat). Only *specific* reason strings count.
- `an_resolve_candidates()` — repairs now return a **ranked candidate list**
  (`videoId/title/score/state/verified`), server-verified where possible,
  never returning dead/embed-blocked/restricted candidates.
- `/api/embed-fallback` **v2 protocol**:
  report `{videoId, code, v:2, exclude:[…]}` → `{candidates, trackId, watchUrl}`
  — **nothing is persisted yet**; the browser pre-validates and POSTs
  `{confirmId}` back; **only a browser-confirmed stream is ever saved**.
  Cooldowns only block the same failing video (a replacement that also dies
  gets a fresh resolve), and a confirmed repair sets a 5-min anti-churn lock.
  The old v1 request shape still works (cached old clients).
- `/api/embed-feedback-batch` — bulk browser-verdict intake for the sweep.
- verify-batch/verify-video return enriched `state/via/reason` (and keep the
  old `results/statuses` shape for the Sweeper UI). `unknown` still counts as
  alive; `dead`/`embed-blocked`/`restricted` are hard verdicts that trigger
  repair.
- New browser reports immediately invalidate the cached verdict for that id.

**Client (`public/assets/anisync-patches.js` v5)**
- **Silent-death watchdog**: any player iframe with `autoplay=1` (user
  initiated) that posts *no player events within 8s* is treated as a broken
  embed — catches failure mode #5 that onError can never see.
- **Browser pre-validation**: candidates are loaded into a hidden, muted,
  200×200 offscreen probe iframe; the first one whose player actually reaches
  playing/buffering is swapped into the live player and **confirmed to the
  server** (persisted for everyone). Candidates that error are reported as
  browser verdicts so future audits skip them.
- **Watch-on-YouTube overlay** with an explanation when nothing will embed
  (those videos do play on youtube.com).
- **STREAM DOCTOR** — floating panel (bottom-left). One click sweeps *every*
  track's embed in the user's own browser (3 muted probes in parallel),
  reports the verdicts to the server, and (checkbox) auto-repairs up to 10
  broken tracks through the same verified-candidate loop, with a
  reload-to-apply button. This is the "checker that actually checks embeds"
  — it runs where embeds have to play, immune to every server-side wall.

**Data repair (shipped DB)** — the original project shipped **42 defective
stream records** (41 tracks with an **empty `youtube_id`** — they can never
play anything — plus `A Cruel Angel's Thesis` pointing at the placeholder
`FINAL_STREAM_SAVED_100`). All 42 were re-resolved and saved with
existence-verified ids (fan/lyric channel uploads, which rarely block
embeds, unlike official label MVs). The user's own browser finalizes
verification through the play-time fallback / Stream Doctor.

### v5 files changed

| File | Change |
|------|--------|
| `public/api/routes_meta.php` | `an_embed_probe` + `an_classify_embed` + InnerTube WEB_EMBEDDED_PLAYER batch + optional Data API layer, `an_resolve_candidates` ranked resolver, embed-fallback **v2** (candidates/confirm/exclude/trackId), `/api/embed-feedback-batch`, enriched verify-batch/video, feedback-driven cache invalidation |
| `public/api/lib.php` | `an_curl_multi_generic()` — parallel GET **and POST** batch HTTP (oEmbed + InnerTube probes together) |
| `public/api/config.php` | optional `YOUTUBE_API_KEY` (env override) |
| `public/assets/anisync-patches.js` | v5 rewrite: silent-death watchdog, browser pre-validation + confirm-on-swap, dual-origin player listener, probe isolation, Stream Doctor sweep panel, hash navigation kept |
| `data/anisync.sqlite` | 42 defective stream ids re-resolved (defective count now 0) |

### v5 testing
- Classifier unit tests: **20/20** (bot-wall phrase vs age-gate, syndication
  reasons, API overrides, "generic wall error must NOT be trusted", …).
- Endpoint suite **20/20**: candidates shape, confirm-persist, feedback flip
  (with cache invalidation), 5-min repair lock, feedback-batch validation +
  recording, v1 compat (`fixedId` still returned), auth guards, resolve-batch
  shape.
- Regression: v1 suite **64/64**, v4 suite **10/10** — nothing broke.
- Headless-browser E2E (worst case: a hard bot-walled browser): patch v5 +
  Doctor button load; a played iframe that silently dies is caught by the
  watchdog (2 rounds), fallback → candidates → 5 probe attempts →
  **Watch-on-YouTube overlay** with correct link; Stream Doctor mini-sweep
  probes tracks, logs OK/FAIL, repairs only browser-verified candidates
  (0 persisted — correct: never save a guess); zero console errors.
- Hash navigation re-verified after the rewrite: `#arena` deep link works,
  back button restores. UI latency during a live 25-track audit: 10–80 ms.

---

## 13. v6 round — fan-first streams, baked-in Data API key, honest browser verdicts

### 13.1 What the Data API revealed about the "silent fails"

With the owner's key active, every one of the 25 head tracks that the user's
Stream Doctor reported as `(silent)` was checked against Google's own
`videos.list`:

- **every single one had `status.embeddable = true`** — the owners did NOT
  disable embedding;
- most were public official uploads whose `regionRestriction` allow-lists
  **include Morocco** (several — Idol, Kick Back, A Cruel Angel's Thesis —
  have **no restrictions at all**).

Conclusion: those videos *should* embed in a healthy browser. The remaining
explanations are **environment-side**, not video-side — an ad-blocker /
privacy shield, the "Before you continue to YouTube" consent wall, a VPN /
proxy, or an IP-reputation flag on the user's connection — plus one
methodology bug on our side: the v5 probe window (5 s, 3 cold-started probes
in parallel, no retry) can misread a *slow player init* as a silent policy
block. v6 fixes the methodology and makes the environment failure explicit.

### 13.2 Server changes (`public/api/routes_meta.php`, `config.php`)

- **`YOUTUBE_API_KEY` baked in** (env var still overrides). videos.list costs
  1 quota unit per 50 ids — a full 164-track audit is 4 units of the free
  10,000/day. Key errors/quota return *null signals*, never verdicts, so the
  system degrades exactly as before if the key dies.
- **`an_ytapi_embed_batch`** now also fetches `contentDetails` +
  `snippet` (same 1 unit): `regionRestriction` (allowed/blocked country
  lists) and the channel title. An `error` JSON body or non-200 is treated as
  "layer unavailable", never as a video verdict — the v3 mass-false-DEAD
  class of bug cannot recur through this path. A key that works but returns
  no item (`absent`) = deleted/private → hard `dead`.
- **`an_classify_embed`** extended: `absent` → `dead`; a real browser error
  still outranks everything (ground truth stays ground truth).
- **Fan-first resolver** — `an_fan_is_official()` (Topic/VEVO/label/公式
  channels) + `an_fan_bonus()` (fan uploads +, "full song / lyrics / AMV /
  creditless" +, official-title markers −) + duration gate (sub-45s Shorts
  dropped). `score_video_result` no longer penalizes fan markers (lyrics
  video / fan edit / subtitled / HD / audio only — the original audio is
  intact; that is the point) and no longer *boosts* "official MV" titles.
  Final candidate ranking: **verified + geo-unconditional > verified +
  geo-conditioned > best-effort**, by fan-first score within each tier.
- **`an_embed_probe`** verdicts now carry `geo` (null = no country
  conditions) and the verify endpoints expose it (`verify-video` field,
  `verify-batch` states notes). The Sweeper UI's binary result stays
  compatible — and with the key active its `[OK]` lines now mean
  *Google-verified embeddable*, not merely "exists".

### 13.3 Stream Doctor v6 (`public/assets/anisync-patches.js`)

- **Control probe** — before sweeping, the Doctor embeds
  `dQw4w9WgXcQ` (definitely embeddable, no restrictions). If the control
  cannot play, the sweep is **aborted** with the diagnosis: *this browser or
  network is blocking YouTube embeds* (ad-blocker / consent page / VPN /
  flagged IP) — track verdicts would be unreliable. This one check finally
  separates "the videos are broken" from "my environment is broken".
- Probe window 5 s → **8 s**, **one retry** for silent verdicts (a slow
  player init is not a policy block), 3 workers **staggered** by 400 ms.
- Auto-repair budget 10 → **20** per sweep (still browser-verified-only).
- Candidate probes in the live-player fallback flow inherit the 8 s window.

### 13.4 Shipped-DB data repair (v6)

Every track's id was audited against the Data API and re-swapped when
fragile, with **nuance**: an allow-list of ~248 countries or a 1–5 country
block-list is *not* fragile — the authentic upload is kept. Truly fragile
(allow-list < 200 or block-list > 5) → re-resolved through the fan-first
resolver, and the replacement only persists if it is **embeddable-verified
AND geo-unconditional** (a sideways move is never taken).

Result: **164/164 embeddable, 0 geo-fragile, 0 dead; 133 fan / 31 official
channels.** 17 fragile official streams were swapped for verified fan
uploads (Unravel, Gurenge, Blue Bird, Renai Circulation, Swordland, Number
One, Decretum, Specialz, Inferno, Kizuna no Kiseki, Guren, Colors, Euterpe,
Update, LET IT OUT, Itsumo Nando demo, Tenchi Geshi); authentic originals
that are globally embeddable (Idol, Kick Back, Silhouette, The Hero!!, …)
were deliberately kept — they are stable and higher quality, and if one
*still* fails in a given browser the control probe now explains why.

### 13.5 v6 files changed

| File | Change |
|------|--------|
| `public/api/config.php` | `YOUTUBE_API_KEY` baked in (env var overrides) |
| `public/api/routes_meta.php` | fan-first ranking (`an_fan_is_official` / `an_fan_bonus` / duration gate), API layer with geo + channel + error-guards, `absent` verdict, `geo` in probe verdicts and verify endpoints, resolver tier ranking |
| `public/assets/anisync-patches.js` | control probe + ENV diagnosis, 8 s probe window, silent retry, staggered workers, repair budget 20 |
| `data/anisync.sqlite` | fragile streams re-swapped to verified fan uploads (164/164 embeddable, 133 fan / 31 official) |
| `.env.example` | key-baked note |

### 13.6 v6 testing

- New unit + live suite **40/40**: classifier `absent` cases, fan-ranking
  pure tests (official detection incl. Japanese `公式`, bonus ordering,
  duration parsing), live Data API layer (key valid, geo parsing, garbage id
  → absent), live probe verdicts (bot-walled sandbox: the API layer decides —
  `via=dataapi`).
- Regressions: v1 **64/64**, v4 **10/10**, v5 **20/20**, v5 classifier
  **20/20**. (One suite re-run needed a rate-bucket flush — the fallback
  endpoint's limiter, not a code change.)
- Headless-browser E2E from the bot-walled sandbox (worst case): v6 patch
  loads, Doctor button present, control probe **fails → the panel prints the
  `[ENV]` diagnosis lines and aborts the sweep** (exactly the designed
  behavior in a broken environment), zero console errors, `#arena` deep link
  still works.
- Data repair verified twice (idempotent), final state 164/164 clean via a
  fresh no-cache audit pass.

---

## 14. v7 round — the control probe spoke: now it diagnoses, shows, and degrades

### 14.1 What happened (the reported `[ENV] CONTROL FAILED`)

The user ran the v6 Stream Doctor and the **control probe** — a video that is
definitely embeddable — could not play in their browser, so the sweep aborted.
That is the gate working as designed: with embeds globally broken *in that
browser*, every track verdict would have been a false "broken" and the sweep
would have churned repairs. Combined with §13.1 (all head tracks verified
`embeddable=true`, most Morocco-allowed via the Data API), the control failure
localizes the remaining problem to the **browser/network environment**:
ad-blocker / privacy shield, the YouTube consent wall, a VPN/flagged IP, or a
DNS filter (pi-hole / AdGuard Home) blocking youtube domains.

v6's env report was honest but blunt — it listed every possible cause with no
way to tell *which one* was biting. v7 turns that one line into a diagnosis.

### 14.2 Staged environment check (where exactly did playback die?)

Every probe now records a **handshake trace**: `onload` (did the frame document
load), `listening` (did the YouTube player app boot and post its handshake),
`frame` (cross-origin = a real YouTube document is there; blank = the frame
was stripped before navigation), and the playback `states` reached. The parent
can never read *inside* a cross-origin frame — but these four signals
discriminate the common blocks:

| verdict | signature | meaning |
|---------|-----------|---------|
| `iframe-blocked` | no `listening`, frame `blank` | the iframe was stripped — ad-blocker extension or DNS filter removing youtube.com frames |
| `player-app-dead` | no `listening`, frame `cross-origin` | embed page loaded but the player app never started — consent wall, in-frame script blocker, or a flagged/VPN exit IP |
| `embed-denied` | control fails with error 101/150 | the unrestricted control video was *refused* — IP/consent enforcement, never the video |
| `stalled` | `listening` but no states | player booted, playback never advanced — ad/media call blocked (ad-blocker stalling ad-bearing players, or *.googlevideo.com DNS-filtered) |
| `ads-break-embeds` | ad-bearing control fails, **ad-free control plays** | aggressive ad-blocker behaviour — half-truth verdicts |
| `player-error` | unexpected error code on the control | broken extension / corrupted session |

A second, **ad-free** control (`jNQXAC9IVRw` — "Me at the zoo", 19 s, no ads,
no label) is probed only when the ad-bearing control fails, which is what
detects the ad-blocker-stalls-ads case. Each verdict prints a tailored fix
list (whitelist this site + `www.youtube.com` / `s.ytimg.com` /
`*.googlevideo.com`, accept consent on youtube.com, try without VPN, …).

### 14.3 New tools in the Doctor panel

- **ENV CHECK** button — standalone staged check (~20 s, worst ~40 s) so the
  user can iterate quickly while flipping blocker settings, without running
  the full sweep.
- **VISUAL TEST** screen — two visible click-to-play embeds (the control plus
  any pasted video id) built lazily on demand. Same-origin code can never read
  inside a cross-origin frame; the user's eyes can. What YouTube renders there
  IS the ground truth: a consent page, "video unavailable", a black box, or
  normal playback — each with a printed interpretation guide. Visual frames
  carry `data-anisync-visual` and are excluded from jsapi injection, the
  watchdog, and the repair flow, so they behave exactly like a plain embed.
- **copy log** button — copies the full doctor log for sharing (textarea +
  execCommand fallback because the site is HTTP, where the async clipboard
  API is unavailable).
- **Report-only degraded sweeps** — when only the ad-bearing control fails
  (`ads-break-embeds`), the sweep still runs but: auto-repair is forced off
  and the feedback-batch POST is skipped, so a half-broken environment can
  never write false "broken" marks into the shared `embed_feedback` cache
  that other clients and the resolver trust. Verdicts stay local and clearly
  labelled `(report-only)`.
- The env-check status also lands in the progress line, and the abort path
  now points at the two new buttons instead of a dead end.

### 14.4 Browser environment checklist (for the `[ENV]` abort case)

1. **Ad-blocker / privacy shield** — disable for this site (or whitelist
   `www.youtube.com`, `s.ytimg.com`, `*.googlevideo.com`). Applies to uBlock,
   AdGuard, Ghostery, and Brave Shields (Shields down for this site).
2. **Consent wall** — open `https://www.youtube.com` in the same browser,
   accept "Before you continue to YouTube", play one video, then re-run
   ENV CHECK.
3. **DNS-level filtering** (pi-hole / AdGuard Home / NextDNS on the router or
   NAS) — whitelist `youtube.com`, `ytimg.com`, `googlevideo.com`. If the
   frame is blank in the trace, this (or an extension) is the cause.
4. **VPN / proxy** — disable once and re-check; a flagged exit IP produces
   `player-app-dead` / `embed-denied` signatures.
5. Then press **ENV CHECK** — when it reports OK, **RUN SWEEP** to repair any
   genuinely broken tracks (repairs persist browser-verified fan uploads).

### 14.5 Files changed (v7 round)

| File | Change |
|------|--------|
| `public/assets/anisync-patches.js` | probe handshake traces, staged env check + verdict classification + tailored advice, ad-free second control, ENV CHECK button, VISUAL TEST screen (lazy, repair-isolated), copy-log, report-only degraded sweeps, v7 debug hook (v6 alias kept) |

No server changes — the shipped DB and API stay at the v6 state
(164/164 embeddable, 133 fan / 31 official).

### 14.6 v7 testing

- `node --check` clean (1018 lines).
- Regressions: v1 **64/64**, v4 **10/10**, v5 **20/20** (after one
  rate-bucket flush — the endpoint limiter, not code), v5 classifier
  **20/20**, v6 **40/40**.
- Headless E2E from the bot-walled sandbox (worst case): **21/21** — staged
  `[ENV]` lines with full handshake trace, the sandbox correctly classified
  `player-app-dead` (frame loaded cross-origin, player app never booted),
  sweep aborted with zero track verdicts, ENV CHECK standalone works, VISUAL
  TEST opens with both frames wired and isolated (no jsapi leak), custom id
  loader validates, probe result carries the full trace, copy-log safe,
  `#arena` deep link intact, zero console errors.

---

## 15. v8 round — "the control video is unavailable, a regular video works"

The report that produced v8, verbatim from the NAS deployment: after v7, the
user opened VISUAL TEST, saw the frame labelled *control — always good* show
"video unavailable" — that frame was **Rick Astley's *Never Gonna Give You
Up*** (`dQw4w9WgXcQ`) — while a regular non-music video they pasted into the
other frame **played fine**.

Root cause: v6/v7 gated the whole environment on **one** control video, and
that video is an ad-BEARING label-music upload. A browser whose network or
region refuses exactly that class of content (label geo-policy, or an
ad-blocker stalling monetized players) can therefore **never pass the gate**,
even though plain embeds play perfectly. Worse, v7's best case for this
signature (`ads-break-embeds`) degraded the sweep to **report-only — no
feedback, no repairs**: the database could never heal in that environment.

### 15.1 The control ladder (any-pass gate)

The gate now asks the only question a control can answer — *can this browser
embed YouTube at all?* — and accepts **any** pass:

| # | candidate | why |
|---|-----------|-----|
| 1 | your pinned control (if set) | the video YOU verified plays here |
| 2 | `jNQXAC9IVRw` — *Me at the zoo* | first YouTube video, no label, no ads — the safest embed on Earth |
| 3 | `aqz-KE-bpKQ` — *Big Buck Bunny* | Blender open movie, CC, no label, no ads |
| 4 | `dQw4w9WgXcQ` — *Rick Astley* | ad-bearing label music — last resort gate candidate, mainly the cross-check below |

A dead pinned control is logged ("SET a new one when convenient") and skipped,
never fatal. When nothing plays at all, the diagnosis is classified from the
ad-free classic's signature (the pin may fail for its own reasons, e.g. it
went region-locked — it must not define the environment's verdict).

### 15.2 The ad-bearing video is demoted to a cross-check

When an ad-free control passes, Rick Astley is probed once more — not as a
gate, but to decide how honest "broken" marks from this browser may be:

- **cross-check passes** → normal sweep (verdicts and repairs both count);
- **cross-check stalls while ad-free controls play** → `ads-break-embeds`,
  and the sweep runs **positive-only**:
  - confirmed-playing repairs **ARE persisted** — a video that actually
    played ≥1s in this browser is playing, in every environment;
  - the failed-ids feedback batch is **held locally** — an aggressive
    ad-blocker manufactures false "broken" marks on ad-bearing videos, and
    those must not be written into the shared `embed_feedback` cache.

This replaces v7's blunt report-only mode (which blocked *all* repairs) —
v8 always heals what it can verify, and only withholds what it cannot trust.
Since fan uploads are usually non-monetized, the repair loop still converges
on streams that play in an ad-suspect browser.

### 15.3 Custom control — pin what plays for YOU

- Panel row **`my control:`** (input + SET + badge + clear) and VISUAL TEST's
  **SET AS MY CONTROL** button: paste any 11-char id, it is live-probed, and
  saved to `localStorage` only if it actually plays here. From then on it is
  probed first on every ENV CHECK / sweep.
- The badge always shows the current pin; `clear` restores the built-in
  ladder.

### 15.4 VISUAL TEST v8

Frame 1 is now the ad-free classic (*Me at the zoo*) — a frame that plays
everywhere, so "it shows an error" unambiguously means *environment*, not
*video*. Frame 2 (any-id slot) starts on *Big Buck Bunny*. Both frames stay
excluded from the repair flow (no jsapi injection, no watchdog) as in v7.

### 15.5 Files changed (v8 round)

| File | Change |
|------|--------|
| `public/assets/anisync-patches.js` | control ladder (any-pass gate), ad-bearing cross-check → `ads-break-embeds`, positive-only sweeps (repairs on, negative batch held), custom control (panel row + VISUAL TEST pin + localStorage + badge), relabelled VISUAL TEST, updated advice/summary text, `envProbeFn` test override, v8 debug hook (V7/V6 aliases kept) |

No server, schema, or data changes — the API tree is byte-identical to the
v7 ship (verified by diff), so the full server regression status
(v1 64/64, v4 10/10, v5 20/20, classifier 20/20, v6 40/40) carries over, and
the DB stays at the v6 pristine-repaired state (164/164 embeddable,
133 fan / 31 official).

### 15.6 v8 testing

- `node --check` clean.
- Headless E2E from the bot-walled sandbox + deterministic stubbed ladder
  (via the new `setEnvProbe` hook): **35/35** —
  - real failure path: ladder logs zoo → BBB → Rick, each with handshake
    trace, classified `player-app-dead`, sweep aborted, zero track verdicts;
  - **the user's exact scenario**: zoo plays + Rick stalls →
    `ads-break-embeds` → positive-only sweep — the 1-track probe ran, the
    broken mark was held locally (no `embed-feedback-batch` POST observed,
    verified via a fetch recorder), the repair loop still ran
    (`embed-fallback` POST observed);
  - all-pass → `ok`; all-101 → `embed-denied`; dead-zoo/BBB-pass → ladder
    skips the dead control; Rick-only-pass → `ok` (any-pass, no cross-check);
    custom pin probed first; SET/CLEAR round-trip with badge;
  - VISUAL TEST v8 layout + repair isolation; `#arena` deep link; zero
    console errors.
- Control candidates verified live via the Data API key: all three report
  `embeddable: true`.

---

## 16. v9 round — "this aint working… do detailed research": the probes were deaf, the protocol was never spoken

**The report.** Every ENV CHECK line read
`FAIL silent — listening=false, frame=cross-origin, states=[]` — the pinned
control, a second custom control, "Me at the zoo", AND Big Buck Bunny —
while the same browser demonstrably plays embeds (VISUAL TEST / plain
watching). Four controls, one identical signature, deterministic: that is
not an environment, that is the probe.

**The research (primary source).** Fetched and reverse-read YouTube's own
`www-widgetapi.js` (the engine behind the official IFrame API —
`tool-results/v9/www-widgetapi.js`, decoded excerpt in the patch header):

| official source | what it actually does | v5–v8 did |
|---|---|---|
| `bb()` / `Ya()` | poll-**sends** `{"event":"listening","id":…,"channel":"widget"}` **INTO** the iframe every 250 ms, resetting on every frame reload | never sent it — ever, anywhere |
| `cb()` listener switch | marks a widget "alive" on **any** first message, then flushes queued commands; acks are `initialDelivery` / `alreadyInitialized` / `readyToListen` (the widget NEVER sends a "listening" event) | waited for an inbound `listening` event that structurally cannot arrive |
| `sendMessage()` | stamps every message `{id, channel:"widget"}`, stringifies, posts into the frame | posted unstamped commands after a phantom ack |
| `Wa()` | appends **`origin=<page origin>` and `widgetid=<iframe id>`** to every embed URL — the widget needs them to post events back | neither param, on any probe or player |

Community cross-check (web research): the nutbread YouTube-API
reverse-engineering note and the "YouTube IFrame API without the API
script" write-up both document the same listening-registration handshake;
error-code taxonomy (101 = owner blocks embeds, 150 = same, embed variant)
confirmed against Google's docs.

**Consequence.** Every "FAIL silent" verdict in v5–v8 — the ENV gate, the
Stream Doctor sweep, the candidate pre-validation, the silent-death
watchdog, the onError auto-repair — ran on a probe that could not hear
YouTube in ANY real browser. The sandbox E2Es passed "worst case" tests
because a bot-walled player and a deaf probe are both silent; the success
path was never once exercised in four shipped versions. The v6 Data-API
finding ("all your tracks are embeddable, must be your environment") and
the user's contradicting observation ("a regular video plays fine") were
both correct — the instrument between them was broken.

**The fix (v9, `public/assets/anisync-patches.js` only; server + DB
byte-identical to the v8 ship).**

- New `adoptWidget()` — the official handshake, mirrored exactly: 300 ms
  registration poll (cap 15 s, detach-safe), poll reset on every frame
  `load` (src swaps re-register), commands queued until the widget's first
  answer, then flushed (`onError`/`onStateChange` subscriptions, plus
  `playVideo` for probes). `readyToListen` re-registers on the spot;
  `initialDelivery`/`alreadyInitialized` stop the poll — the same cases
  www-widgetapi.js handles.
- `probeCandidate()` now builds the embed URL the way the official API
  does: `enablejsapi=1` + **`widgetid`** + **`origin`**; registers via
  `adoptWidget({autoplay:true})`.
- SPA player frames (`ensureJsApi`) get the same upgrade: `widgetid` +
  `origin` params appended (once) + adoption — so the v4 `onError`
  auto-repair, the aliveness marking and the watchdog finally receive
  REAL events.
- Probe verdicts now also accept states arriving via `infoDelivery`
  (`playerState`), belt-and-braces alongside `onStateChange`.
- The trace grew `regs=N` (how many registrations we sent) — the env
  diagnosis now distinguishes "we knocked, nobody answered" (regs>0,
  listening=false) at a glance.
- Test-only seams (`__ANISYNC_PROBE_BASE__`,
  `__ANISYNC_TEST_ORIGINS__`), read at use time, let the E2E point probes
  at a local mock widget.

**The proof (new E2E, `scripts/v9_e2e.sh` — 30/30).** A local MOCK widget
(`scripts/v9_mock_server.py`) implements the protocol and only ever talks
AFTER receiving a registration — so a passing probe certifies the
handshake end-to-end (under v8 the same probe sits silent forever):

- normal video → `ok:true`, mock log shows the registration was received
  and the queued `playVideo`/subscriptions were flushed after the ack;
- `x…` video → `onError 150` → `{ok:false, code:150}` (definitive
  embed-block verdict);
- slow-booting widget (listener up at +1.5 s) → the 300 ms poll keeps
  knocking → `ok:true`;
- mute widget (never listens) → silent timeout, `listening=false`,
  `regs≈8` counted;
- full ENV ladder through the REAL `probeCandidate` → `kind: ok`;
- real app: v9 loads (V8/V7/V6 aliases kept), 164 tracks, doctor panel,
  REAL-YouTube failure path — **the widget now answers even from the
  bot-walled sandbox**: zoo/Rick return `FAIL error 150 — listening=true,
  regs=1` (a real verdict, not silence), BBB `states=[-1]`, sweep still
  aborts with zero track verdicts; stubbed ladder regressions (ok /
  ads-break-embeds / embed-denied / custom-first); `#arena`; zero console
  errors.

**What this means on your NAS:** the same browser that plays a normal
video will now pass ENV CHECK (the widget answers, muted autoplay reaches
`playing`), and RUN SWEEP will produce its first HONEST per-track
verdicts — `OK` for streams that actually play, `error 101/150` for
genuinely embed-blocked ones — and repair only through
browser-verified replacements, exactly as designed since v5.

---

## 17. v10 round — "good detection in doctor … now remove the stream doctor and update the stream audit to use this detection … no covers etc we want original full song no remix etc"

The user's v9 sweep finally WORKED — zoo passed, the ad-bearing
cross-check returned a real `error 150`, and all 164 tracks got honest
per-track verdicts (~60 OK, ~104 `error 150`). The instrument was fixed;
three requests followed, and all three are shipped:

### 17.1 The Stream Doctor is removed; its engine moved inside the Stream Auditor

The floating button, the panel, ENV CHECK, VISUAL TEST and the custom
control row are gone (`grep anisync-doctor` returns nothing). The v9
widget-protocol probe, the control ladder, the classification and the
repair loop all survive as an internal engine with no UI of its own.
What took the Doctor's place is **the admin panel's existing
"Initialize stream audit"** (Moderation → Maintenance Hub →
`// Stream Auditor / Repairer`) — transparently upgraded:

- **verify-batch interception.** The auditor's own POST
  `/api/verify-batch` still runs server-side first (oEmbed + InnerTube +
  Data API), but the response is then enriched in the browser: every id
  is probed with the v9 hidden muted embed (3 workers, silent-retry), and
  **the real player verdict overrides the server's guess** — a video
  that plays HERE is `OK` even if the server said dead; a player that
  answers `error 150/101` is DEAD even if the Data API said
  `embeddable=true` (the user's sweep proved that flag misses label
  syndication blocks). The audit console lines (`[OK] … link check
  pass.` / `[FAIL] DEAD STREAM DETECTED`) now tell the truth.
- **resolve-batch interception.** The auditor's repairs used to save
  whatever the server resolved, unverified. Now every server-picked
  replacement is probed in THIS browser BEFORE the SPA saves it; on
  failure the interceptor re-POSTs with per-track `excludeIds` (new in
  the v10 server) — up to two retry rounds — and ids that never verify
  are dropped from the response, so **nothing unconfirmed is ever
  persisted**. Retry requests attach the SPA's JWT themselves (they
  bypass apiFetch).
- **Environment gate, UI-less.** The v8 control ladder runs once before
  the first probe batch (5-minute cache): dead browser → server verdicts
  pass through untouched (toast with the tailored fix); ad-suspect
  environment → verdicts still drive repairs but "broken" marks are held
  local (no embed-feedback POST — the v8 positive-only policy, exact);
  honest environment → failures are reported to the server through
  embed-feedback-batch so future audits inherit the browser truth.
- **No coverage gap.** The live-player auto-repair (v5/v6/v9 onError +
  silent-death watchdog + ranked-candidate probe loop) is unchanged and
  keeps healing embeds during normal browsing.

### 17.2 Original full songs only — no covers, no remixes, no TV cuts

Empirically the v6 −300 soft penalty lost to relevance: a well-titled
fan cover ("Song X (Cover)" on a fan channel, +150 title +120 fan)
outscored the original, so repairs kept swapping dead originals for
covers. v10 makes the policy absolute, split into two tiers applied
UPSTREAM of any scoring (`api/routes_meta.php`):

- **tier `audio` — HARD-EXCLUDED, never a replacement:** the recording
  itself differs — cover / 歌ってみた, remix / nightcore / sped-slowed /
  8d / reverb, instrumental / off-vocal / karaoke / piano-orchestra
  arrangements, AI voices (RVC/sovits), live performances, medleys /
  compilations / 1-hour loops, reactions. Word-boundary matching for
  short English words ("Alive" never trips `live`, "Recovery" never
  trips `cover`) with inflection wildcards (covers/covered/remixes);
  substring matching for phrases, CJK and hyphenated markers.
- **tier `length` — legal only as a last resort (−350):** the original
  recording but a short cut — TV size / TV ver / short ver / radio edit /
  `<TV Limited.>`. Ranked below every full version, so it is picked only
  when nothing full-length exists.
- **Search queries are sanitized** (`an_strip_derivative_markers`):
  repairing "Guren no Yumiya (TV Size)" searches for the FULL song —
  brackets containing markers are removed, bare markers stripped,
  dangling `ver`/`version` tags tidied.
- **Full-length preference by duration** (`an_duration_score_adjust`):
  ≥200 s +25 · ≥150 s +10 · 120–149 s −30 · 85–119 s −120 (TV-size
  territory) · <85 s −200 — the honest signal when the title carries no
  marker.
- **The audit also PURIFIES the existing library.** The client mirrors
  the lexicon (`anisync-patches.js`): a track whose TITLE says
  cover/remix/TV-size is flagged dead even if it plays, so the auditor
  routes it through repair — and the v10 resolver only proposes
  originals. E2E proof: the seeded "Guren no Yumiya (TV Size)" track
  was detected, flagged, and replaced with a full version in the DB
  while its title was preserved.
- **per-track `excludeIds`** in `meta_resolve_batch` — the browser retry
  rounds tell the server exactly which candidates THIS browser rejected,
  so each round resolves a different video.

### 17.3 Files changed (v10 round)

| File | Change |
|------|--------|
| `public/assets/anisync-patches.js` | v10 rewrite (1275 lines): Stream Doctor UI removed; fetch interception (verify-batch merge + non-original flag + feedback policy; resolve-batch browser verification + retry rounds with auth header); client lexicon mirror; quiet env gate; `__anisyncPatchesV10__` hook (+V9/V8/V7/V6 aliases); live-player repair + hash nav kept |
| `public/api/routes_meta.php` | `an_derivative_lexicon` / `an_derivative_hit` / `an_strip_derivative_markers` / `an_duration_score_adjust` (all PURE); `an_resolve_candidates` — stripped query, hard audio-tier exclusion, length-tier dock, duration preference; `meta_resolve_batch` — per-track `excludeIds` |

### 17.4 v10 testing

- **Unit (61/61, `scripts/test_v10_originals.php`):** tier detection
  incl. Japanese markers and false-positive guards (Alive/Recovery/
  Discover/real DB titles); strip function; duration adjust; resolver
  gate through a token-stripped stub (tokenizer-based function removal —
  PHP cannot monkey-patch): cover and nightcore EXCLUDED, TV-size below
  every full version, fan full song first, official topic selectable,
  stripped query reaches the search, caller exclusions honored.
- **Regressions:** v5 classifier 20/20, v6 ranking 40/40 (live Data API
  layer) against the v10 tree.
- **E2E (35/35, `scripts/v10_e2e.sh`):** A — harness page installs a
  STUB fetch BEFORE the patch loads so `nativeFetch` is scripted while
  the probes talk to the REAL mock widget: handshake regression, 150
  verdict, verify-batch merge (browser overrides server, cover-titled
  track flagged, feedback posted with the failed id), resolve retry
  (exactly 2 calls, excludeIds carried, verified replacement returned),
  ads-break-embeds (verdicts kept, feedback held local), untrusted env
  (server verdicts pass through), zero console errors. B — real app on
  a seeded 4-track DB: doctor button AND panel absent, admin login,
  Maintenance Hub → "Initialize stream audit" runs the real chain and
  prints honest lines (`[OK] "Test Alive Song"`, `[FAIL] "Unravel"`,
  `[FAIL] "Guren no Yumiya (TV Size)"`), 3 repairs REROUTED through the
  REAL resolver and **persisted to SQLite** (blocked track repaired,
  TV-size replaced by a full version, title preserved), embed_feedback
  recorded server-side (verify-video reports `browserReported:true`),
  `#arena` nav, zero console errors.

### 17.5 What this means on your NAS

Deploy v10, log in as admin, open **Moderation → Maintenance Hub** and
press **Initialize stream audit**. It now does what the Doctor sweep
did — real per-track embed verdicts in your browser — plus what the
Doctor never could: it repairs in the same run, only ever saving
replacements that were **confirmed to play in your browser**, and only
ever picking **original full songs** (covers/remixes/nightcore are
never candidates; TV-size and other short cuts only when nothing
full-length exists). Tracks whose titles mark them as covers or TV
cuts are themselves flagged and re-resolved to the originals. Your
~104 `error 150` tracks will be swapped to working originals in one
pass; the sweep's "broken" marks also teach the server (outside
ad-suspect environments) so future audits start from the truth.

---

## 18. v11 round — "also fix this … i want a points system to get the best link possible"

The user's log: the auditor's `[Sweeper]` flagged ~19 of the first 25
healthy tracks as `DEAD STREAM DETECTED` and fired a 19-track repair —
**the exact false-positive partition of their ad blocker** (the same
tracks that played in the v9 Doctor sweep passed; the ad-bearing ones
failed). Root cause: v10's verify-batch merge let the browser's
error-150 verdict condemn a track EVEN in the `ads-break-embeds`
environment — the environment whose ad blocker *manufactures* error 150
on ad-bearing videos. v10's positive-only policy only suppressed the
server feedback; it never stopped the dead-marking itself.

### 18.1 The fix — positive-only is now really positive-only

`anisync-patches.js` v11, in `applyBrowserVerdicts()`:

- **Trusted environment** — browser error 150 still overrides the
  server (a real embed-block, as before).
- **Ad-suspect environment (`ads-break-embeds`)** — browser error 150
  is **INCONCLUSIVE**: the merged verdict falls back to the server's,
  so a server-alive track can no longer be mass-flagged dead by the ad
  blocker. Browser-PLAYED still overrides everything (ground truth,
  even over a server "dead").
- **Hard codes (101 embedding-disabled / 100 removed / 2 bad id / 5
  player error) condemn in EVERY environment** — an ad blocker cannot
  fake those; only 150 is ambiguous.
- Feedback to the server still follows the v8 policy: never sent from
  an ad-suspect environment.

The audit trace gained an `ad-suspect-150` counter so the diagnosis is
visible through the debug hook.

### 18.2 The points system — "best link possible", keyword by keyword

`routes_meta.php` v11. Every replacement candidate is scored:

```
score = relevance (title/artist/type match, score_video_result)
      + points   (an_candidate_points)
```

`an_candidate_points()` = one auditable rulebook (`an_points_rules()`)
+ channel + derivative tiers + duration:

| PLUS | points | | MINUS | points |
|------|-------:-|------|-------|-------:|
| fan upload (channel) | +120 | | official / VEVO / Topic channel | -420 |
| full song / full version / フルバージョン | +60 | | cover / remix / nightcore / sped / instrumental / karaoke / AI / live / **language variants** (audio tier) | **-1500** |
| full (bare word) | +30 | | TV size / short ver / radio edit (length tier) | -350 |
| lyrics video | +30 | | parody | -300 |
| creditless / ノンクレジット | +25 | | trailer / teaser | -250 |
| HD / 1080p / 4K / 高画質 | +20 | | preview | -200 |
| AMV / MAD / PMV (fan edit) | +25 | | subbed re-upload | -150 |
| original / オリジナル | +15 | | low quality (240p) | -20 |
| audio only | +10 | | duration: ≥3:20 +25 · ≥2:30 +10 · 2:00–2:30 -30 · 1:25–2:00 -120 · shorter -200 | |
| theme / 主題歌 | +10 | | | |

Anything scoring below **AN_POINTS_FLOOR (-400)** is never returned —
the -1500 audio-derivative penalty puts covers, remixes, live
performances and language variants eternally below the floor, so the
v10 "original full songs only" guarantee is now *expressed as points
nobody can out-score* (exclusion = a minus, uniform and tunable). Short
cuts (-350) and official channels (-420) remain reachable only as last
resorts. Word-boundary + inflection matching keeps "Alive" away from
"live", "Made" away from "MAD", "Recovery" away from "cover".

**Language variants are a new derivative tier** on both sides: the
server lexicon AND the client title-flag mirror gained `english
version / english ver / eng version / english dub / spanish ver / latin
ver / 中文版 / version en español …` plus bare word-safe `live`. A
library track titled "X (English Version)" is now flagged non-original
and repaired to the original — the user's explicit "minus like cover or
english version".

`score_video_result()` is relevance-only now; `an_fan_bonus()` is
retired (kept for the v6 regression suite). One place answers *"why
did this link win?"*.

### 18.3 Receipts — the choice is auditable

`resolve-batch` returns per-track `details` (title, author, `fan` flag,
score, and the **hit list** of rules that fired). The interceptor logs
a `[POINTS] track … | fan upload +120, full song +60, … | score 545`
receipt for every browser-verified repair (console + audit trace) and
shows a one-line summary toast; retry rounds swap in the new
candidate's receipt so it always matches the link actually saved.

### 18.4 Testing

- **Unit** (`scripts/test_v11_points.php`, 64/64): rulebook hits and
  totals, channel points, floor exclusions (cover / english version /
  live), TV-size last resort, duration ladder, word-boundary
  false-positive guards (Alive / Liverpool / delivered / Made in
  Abyss), relevance-only `score_video_result`, resolver gate with the
  receipt, `resolve_youtube_best` returning null instead of a cover.
- **Regressions**: v5 20/20, v6 40/40, v10 61/61 — identical results
  on the v11 tree (resolver ordering semantics preserved).
- **E2E** (`scripts/v11_e2e.sh`, 53/53): handshake; 150 AND the new
  hard-101 verdicts; trusted-env merge (browser override, cover +
  english-version title flags, feedback); resolve retry with
  excludeIds + points receipts (returned, logged, traced); **THE v11
  regression** — ads-break-embeds env: browser 150 + server-alive →
  merged verdict stays **ALIVE**, hard 101 still fatal, zero feedback;
  untrusted passthrough; real app on a seeded 6-track DB: v11 patch,
  doctor still gone, trusted-env audit with 5 repairs persisted
  (blocked, TV-size, silent, english-version, real-embed-block) and
  receipts logged; then a **re-seeded ads-env audit**: the
  server-alive ad-blocked track (Big Buck Bunny, mock-blocked 150)
  prints `[OK] "Big Buck Bunny Theme" link check pass.` and is **not
  churned in the DB**, while the genuinely-dead tracks still repair;
  `#arena`; zero console errors. (Test-harness note: re-seeding the DB
  mid-session invalidates the stateful JWT `sid` → the SPA logs out —
  production never swaps the DB file, the E2E just re-logs in.)

### 18.5 What this means on your NAS

Deploy v11, log in as admin, **Moderation → Maintenance Hub →
Initialize stream audit**. With your ad blocker active you should now
see the previously-massacred tracks print `[OK] … link check pass`
(the ~104 false DEADs were your blocker's error-150 noise — the audit
no longer trusts it), while genuinely dead streams and cover /
TV-size / english-version-titled tracks still fail and are repaired —
each replacement now the **points race winner** (fan upload preferred,
full song preferred, originals only), browser-verified before it is
saved, with the receipt in the browser console.

---

## Files changed (v1 round)

| File | Change |
|------|--------|
| `public/api/config.php` | relative DB path (+env override), real JWT secret, new proxy/TLS options |
| `public/api/lib.php` | per-constant fallbacks, JWT bootstrap, direct-first curl with optional proxy fallback + TLS verification, cached non-blocking body reads |
| `public/api/routes_db.php` | fixed fatal undefined functions (×4), router rework (GET users/artists, body-based update-vs-delete), real match-vote persistence, removed all hardcoded DB paths, auth matrix, email privacy, followers_count |
| `public/api/routes_auth.php` | email trim, session GC on login |
| `public/api/routes_meta.php` | require_auth on verify-batch / resolve-batch / lyrics / animethemes-search |
| `bulk_stream_repair.php` | config-aware DB path, --dry-run, shared db() |
| `promote.php` | new `--password` reset option (session revocation included) |
| `dev_router.php` | NEW — PHP built-in-server router that mirrors the lighttpd rewrite rules |
| `data/anisync.sqlite` | admin password reset, stale sessions cleared (tracks/users data intact) |

## Testing

- `scripts`-style CLI regression suite: **64/64 checks passing** (auth, db
  routing, moderation, stream audit chain, auth-gating matrix, revocation).
- Live HTTP test through the PHP built-in server: register/login/me, seed,
  match-vote, verify-batch (real YouTube check), proposal submission, track
  update, stream-repair save, SPA fallback — all verified.
- Stream audit verified against the live YouTube oEmbed endpoint.

---

## 19. v12 round — the backup regression: the v10/v11 engine was GONE, the audit was a no-op, and the NAS paid for it

### 19.1 What happened (root cause of "link selection is broken")

Comparing FIXES.md against the actual files in this backup revealed a
**regression**: the v10/v11 machinery this document describes was **absent
from the code**. Someone (a bad merge, an overwrite from an older snapshot,
or a partial restore) had reverted the three load-bearing pieces to stubs:

| Documented (v10/v11) | What was actually in the backup |
|---|---|
| `anisync-patches.js` v10/v11 — 1275 lines: verify-batch/resolve-batch fetch interception, browser-verdict merge, env gate, retry rounds, receipts, hash nav | **72 lines** (v4-era): blind single swap of `candidates[0]`, error codes 101/150/2 only, no disambiguation, no fallback UI, no hash nav (despite index.html's comment claiming both) |
| `an_resolve_candidates` — points system, derivative tiers, embeddability pre-check, duration ladder | **a stub**: first search result, hardcoded `score=100`, `points=["verified"]`, `duration=200`, `verified=true` — no probing, no scoring, " full song" glued onto every query |
| `meta_verify_batch` — real per-track embed verdicts | **a stub**: regex-checks the ID FORMAT ONLY — every 11-character id was "ok", so the auditor always printed "Database online and verified" and never repaired anything |
| `scripts/` test suites (v10/v11 E2E) | directory missing entirely |

Three user-visible symptoms, one root cause each:

1. **"Stream audit does nothing"** — verify-batch was a format check; no
   dead link was ever detected, so repair never triggered.
2. **"Link selection is broken"** — when repair DID trigger (via the
   player's error watcher), the resolver returned the first search hit
   labeled "verified" without ever checking embeddability or score.
3. **"Lyrics tab never loads"** — the dispatcher kept `require_auth` on
   `/api/lyrics` (a v1 change) while the deployed TrackPreviewDrawer calls
   it with a bare `fetch` (no Bearer) → silent 401 swallowed by `.catch`.

### 19.2 The v12 fix (server does the verification — fewer requests, not more)

Rebuilt on the surviving infra (`an_embed_probe` + `an_curl_multi` +
`api_cache` were all present and correct — they were just never called):

**`meta_verify_batch` (routes_meta.php)** — real multi-signal probing:
oEmbed + InnerTube `WEB_EMBEDDED_PLAYER` + Data API + the browser
`embed_feedback` table, batched via curl_multi and cached in SQLite
(6 h ok / 24 h dead / 10 min unknown). v11 semantics kept: ambiguous
signals (`unknown`) never condemn; only explicit `dead`/`embed-blocked`
verdicts do. v10's "purify the library" rule is now SERVER-side: tracks
whose titles hit the derivative lexicon are flagged `non-original` and
routed to repair (indexed `IN (...)` lookup). Response contract unchanged
(`results`/`statuses`/`states` + new `reasons`), so the deployed
AdminQueue bundle works untouched.

**`an_resolve_candidates`** — the real points engine:
`score = relevance (score_video_result) + points (an_candidate_points)`,
with the §18 rulebook restored to spec (fan +120 / official -420 — the
in-tree copy had an inverted "OFFICIAL PREFERENCE" experiment baked in),
audio-tier −1500 / length-tier −350, subbed −150 added, duration ladder
§17.2. Below-floor candidates are dropped BEFORE probing (covers/remixes/
english versions are never even checked). The top pool is then probed with
`an_embed_probe` — **only `state=ok` links are returned**, enriched with
REAL duration/author/title extracted from the InnerTube `videoDetails`
(new: `lengthSeconds`/`author`/`title` surfaced by
`an_innertube_embed_batch`), duration points applied post-probe, final
sort, and a per-candidate receipt in `points`. Nothing unverified is ever
returned, so `resolve-batch` / `embed-fallback` / `resolve-single` all
inherit the guarantee.

**`anisync-patches.js` v12** — the browser half, rebuilt lean (~330
lines, ES5, no build step):
- hard codes (2 / 5 / 100 / 101 — an ad blocker cannot fake those) →
  repair immediately + report via `embed-feedback-batch`;
- **error 150 disambiguation**: cross-check `/api/verify-video` first —
  server-alive means ad-blocker noise: NO churn, just a "Watch on YouTube"
  pill (positive-only policy, §18.1); server-dead → repair. A video that
  already reached PLAYING state before erroring is treated as ad-churn too;
- repair = `/api/embed-fallback` v2 → pick `candidates[0]` (now genuinely
  the points winner) → swap iframe src → confirm POST; max 3 hops per
  track per session; 60 s client cooldown mirrors the server's;
- receipts: `[POINTS] title | fan upload +120, full song +60, … | score`
  in the console; debug hook `window.__anisyncPatchesV12__`;
- **hash navigation restored** (`#arena`, `#tournament`, `#leaderboard`,
  `#moderation`, `#submissions`, `#profile`) — clicks the SPA's real
  `#tab-<route>-btn` buttons, so back/forward and deep links work without
  touching the bundle.

**`bulk_stream_repair.php`** — the CLI auditor now runs the SAME engine
(batched `an_embed_probe` verification + `an_resolve_candidates` repairs
with receipts in `--dry-run` output) instead of bare oEmbed + first regex
videoId.

**Other correctness fixes:** `/api/lyrics` no longer `require_auth`
(401-for-everyone bug — it's an LRCLIB proxy, rate limit stays);
`embed-fallback`/`embed-feedback-batch` no longer double-increment their
30/min buckets; `set_time_limit` headroom on the audit endpoints
(php.ini's 30 s killed big sweeps); audit pacing no longer sleeps after
the last chunk.

### 19.3 NAS optimizations (requests, flash wear, CPU)

| Change | Effect |
|---|---|
| `json_out()` gzips when `Accept-Encoding: gzip` (lib.php) | tracks payload 43.5 KB → ~6.8 KB (−84 %) on every boot |
| `rate_limit()` skips RFC1918/ULA clients (lib.php) | **one SQLite WAL write per API request eliminated** (pure flash wear on a LAN box); public clients still fully limited |
| `an_lazy_gc()` on `db()` boot GCs `api_cache` (+ rate/session tables) | api_cache was the only unbounded table — expired embed cooldown rows piled up forever |
| SQLite: `cache_size=-8000`, `temp_store=MEMORY`, `wal_autocheckpoint=2000` | 8 MB page cache, no flash temp files, smoother checkpoints |
| Schema v4: `idx_tracks_yt` on `tracks(youtube_id)` (auto-migrates on boot) | embed-fallback's per-error track lookup + verify-batch title-flagging were full table scans |
| `/api/db/tracks` ETag + `Cache-Control: private, max-age=30` | repeat boots revalidate with a 304 (~200 B) instead of re-downloading the library |
| lighttpd: `mod_compress` + `mod_expire` — hashed `/assets/*` immutable 365 d, `anisync-patches.js` 5 min | 2.5 MB of JS/CSS no longer revalidated per visit; the patch file still updates quickly (it is NOT content-hashed) |
| php.ini: `realpath_cache_size=96K`, `realpath_cache_ttl=600` | ~300 KB of PHP re-parsed per request with no opcode cache — stat churn reduced |
| unified `an_raw_input()` body reader | fixed the PHP < 5.6 second-read-of-php://input corruption class (routes_db's `get_json_body`, `db_track_update_yt` migrated too) |
| resolver probes ≤ 8 candidates, one outbound search per repair (both cached 1 h / 6 h) | NAS outbound traffic per repair bounded; repeat audits are nearly free |

### 19.4 Cleanup (bloat removal — every deletion verified by import-graph search)

Deleted **~4.9 MB of dead files** + ~4,500 lines: 17 root `test-*.ts`
debug probes, `replace_arena.js`/`replace_brackets.js` codemods,
`router.php` (byte-identical dup of `dev_router.php`), `koyeb.yaml`
(self-declared dead), `public/500.html` + `_redirects` + `_headers`
(Netlify artifacts lighttpd ignores), `public/logo.png` (824 KB,
unreferenced), the orphan chunk `public/assets/index-FIXED-*.js`,
`src/assets/` (3.9 MB: a stale 2,589-line App.tsx snapshot + zero-import
images), 13 dead src modules (`apiCache.ts`, `firebase-admin.ts`,
`gamification*`, `AnimeWrapped`, `VibeSpectrumRadar`, …), 7 of 9
gamification components, and the never-called `an_check_playability()`
(dup of the InnerTube prober with a hardcoded ANDROID key).
`package.json`: dropped `@formkit/auto-animate`, `@nivo/radar`,
`react-content-loader` (zero importers), fixed the duplicated
`@phosphor-icons/react` key.

**Kept deliberately** (legacy-but-load-bearing decision, see
docs/AUDIT-v12.md): `server.ts`, `netlify/`, `deploy/`, firebase configs
and the whole Firebase-flavored `src/` tree. ⚠️ **The shipped
`public/assets/` bundle and `src/` have DIVERGED** — the bundle calls the
PHP API (`/api/auth/*`, `/api/db/*`) and contains no Firebase SDK, while
`src/App.tsx` still boots Firebase/Firestore. Rebuilding from `src/`
today would produce an app that does NOT work against the PHP backend.
Treat `public/` as the deployed artifact until the source is reconciled.

### 19.5 Testing (no PHP runtime in the analysis environment)

- **Scoring engine ported to Python and run against the §18.4 suite**:
  24/24 — channel points (fan +120 / Topic −420 / label −420), floor
  exclusions (cover / english version / live / nightcore / 歌ってみた),
  TV-size-last-resort ordering, duration ladder, word-boundary guards
  (Alive / Liverpool / delivered / Made in Abyss / Discovery / Recovery),
  rulebook stacking, subbed −150. (`scripts/test_v12_scoring.py`)
- **Resolver pipeline simulation** (mocked search + probe): 13/13 — cover
  never probed (below floor), fan full song outranks TV-size and Topic,
  dead-probe candidates dropped, exclusions honored, response contract
  for the patch's `candidates[0].videoId` pick. The observed ranking:
  fan full 485 / TV-size −100 / Topic −145. (`scripts/test_v12_resolver_flow.py`)
- **Structural checks on all edited PHP** (`scripts/check_php_structure.py`):
  brace/paren/bracket balance (strings & comments aware) on all 5 API
  files + CLI tool, no duplicate unguarded function names, PHP 5.3
  syntax scan. The one flagged duplicate (`get_json_body`) is
  `function_exists`-guarded by design.
- **Schema v4 migration rehearsed on a copy of the live DB**: user_version
  3 → 4, index created, `EXPLAIN QUERY PLAN` confirms
  `SEARCH tracks USING INDEX idx_tracks_yt`.
- **JS**: `node --check` clean on the rebuilt patch.
- Frontend contracts verified by grep against the deployed minified
  bundle (verify-batch reads `results[track.youtubeId]`, missing = dead;
  the patch picks `candidates[0].videoId`; `H()` carries the JWT).

### 19.6 Deploying to the NAS

1. Copy the project over (only `public/`, `public/api/`, `lighttpd.conf`,
   `php.ini`, `data/` matter to lighttpd).
2. Once: `mkdir -p /tmp/anisync-compress && chown www-data:www-data /tmp/anisync-compress`
3. Restart the instance: `/etc/init.d/anisync restart` (schema v4 index
   applies itself on first request; probe caches fill on first audit).
4. Hard-refresh the SPA once (the patch file has a 5-minute cache now) —
   then log in as admin, **Moderation → Maintenance Hub → Initialize
   stream audit** and watch the first honest sweep: real per-track
   verdicts with reasons, cover/TV-size-titled tracks flagged
   `non-original`, repairs that are the points-race winner, receipts in
   the console, and repeat audits nearly free (everything cached).

## 20. v12.1 — field round: "thing still aint working" (2026-09)

### 20.1 Root cause of the non-fix: the v12 engine never reached the NAS

The post-v12 browser console still showed `anisync-patches.js:6:11
[AniSync] Stable YouTube Player Engine Initialized` — that exact string only
exists in the **original 71-line v4 backup patch** (line 6, column 1 matches
the console reference precisely; the v12 file starts with a license comment).
Every API response was also a full `200 OK` at 350-1000 ms (no 304s, no
gzip) — the v12 conditional-GETs were nowhere. Conclusion: the NAS was still
serving the backup code; the v12 tarball was never extracted over it (or was
extracted into a different directory than the one `serve.sh` runs from).

v12.1 makes this class of failure *visible* instead of silent:

- **Engine stamp**: `ANISYNC_ENGINE = '12.1'` in `lib.php`, reported by
  `/health` as `"engine":"12.1"`, echoed by the patch's first console line
  (`[AniSync] v12.1 engine online`). One curl or one glance answers "is the
  new code live?".
- **`deploy/verify-deploy.sh`** — 7-point self-check (engine stamp, API
  gzip, ETag→304 round trip, static Cache-Control, patch identity, beacon
  removal, SPA entry). Run it on the NAS after every deploy.
- **`index.html` now loads `/assets/anisync-patches.js?v=12.1`** — a stale
  browser cache can no longer keep the old engine alive after an upgrade
  (previously the file had no cache-buster at all).
- **Packaging hazard fixed**: the v12 tarball shipped `data/*.sqlite` —
  extracting it over a live install would have **overwritten the production
  database** (votes, history, users). v12.1's tarball excludes `data/`,
  `logs/`, `node_modules/` and `.git/`.

### 20.2 HOLE 1 — region/auth-blocked videos audited as "ok" (the remaining false-positive class)

Field evidence: `o6wtDPVkKqI` has a live thumbnail and oEmbed 200, yet the
player dies instantly with an auth-class "Video unavailable"
(`error=0.000:auth::...r.Cette_vid_o_n_est_pas_disponible`). The v12
classifier matched InnerTube verdicts only by keyword
(country/age/syndication); a generic `playabilityStatus: ERROR,
reason: "Video unavailable"` matched nothing and **fell through to the
oEmbed 200 verdict → "ok"**. So the audit passed a video the player could
never play, and the resolver could hand it back as a "verified" replacement.

Fix (`an_classify_embed`): InnerTube `WEB_EMBEDDED_PLAYER` playability is now
**authoritative** — `OK`/`LIVE_STREAM_OFFLINE` → ok; `UNPLAYABLE` →
embed-blocked; `LOGIN_REQUIRED`/age/country → restricted; **any other
non-OK verdict (ERROR etc.) → restricted with the reason**. It can never
resolve to "ok". Because the probe runs from the NAS's own egress IP, the
verdict matches what the LAN audience actually experiences. Hard death
signals (Data API deleted/private/absent, oEmbed 404) still take precedence,
and the bot wall ("not a bot") is ignored, not counted.

### 20.3 HOLE 2 — browser feedback could condemn healthy links

`$rep → embed-blocked` used to be the FIRST-priority signal. The v4-era
engine (and its blind confirmations) wrote error rows for any code
101/150/2, so the 14-day feedback window could poison good links. The
browser report is now a **tie-breaker only**: it fires when every server
probe returned no usable verdict, and can no longer override a positive
InnerTube/oEmbed verdict (that case is ad-blocker 150 noise by definition —
matching the patch's own suppression policy).

### 20.4 The poll storm, tamed from both ends

The console log showed `/api/db/tracks?limit=500` + `/history?limit=150`
full-fetching every few seconds, twice in parallel per cycle, plus
`/api/auth/refresh` double-fired, plus a `plausible.io` beacon per
navigation — hundreds of full SQLite serializations per hour on NAS hardware.

Server side:
- `an_list_version_etag()` (lib.php) — shared conditional-GET helper; a
  cheap aggregate query (COUNT/SUM/MAX) builds the ETag, `If-None-Match`
  answers **304 without building the payload**, and a short
  `Cache-Control: private, max-age=N` lets the browser serve the cached body
  without touching the NAS at all between revalidations. Applied to
  **tracks, history, tournaments, users, proposals, artist-profiles**
  (shelf lives 15 s–5 min, tuned per mutation rate).
- `dev_router.php` — under `php -S` (the serve.sh NAS topology) the
  built-in server sends no cache headers at all; hashed Vite chunks are now
  served immutable/1-year, `anisync-patches.js` 5 minutes, and
  `index.html` `no-cache` (deploys are picked up instantly). Plain readfile,
  no gzip — LAN wire is cheap, NAS CPU is not.

Client side (anisync-patches.js "REQUEST DIET"):
- fetch() interception (the app is 100 % fetch-based): hot list GETs are
  served from a 4 s in-memory snapshot, identical in-flight GETs are
  coalesced into one network call, and `/api/auth/refresh` is single-flighted
  (the double refresh per cycle becomes one). POSTs that must stay fresh
  (votes, verify-batch, embed-fallback) pass through untouched.
- The plausible.io script tag was removed from index.html (LAN deployment —
  analytics phoning home per page view buys nothing here; the removal is
  documented in the file for re-enabling) and the patch stubs
  `window.plausible` defensively.

Net effect for a two-tab client that used to cost the NAS ~700+ full
payload responses/hour: within `max-age` the browser answers itself;
between windows a 304 costs one aggregate query (~1 ms) and ~200 bytes;
duplicate concurrent polls and refreshes collapse into single flights.

### 20.5 Sweep behavior after upgrading

The first Stream Auditor sweep on the upgraded NAS will finally be honest:
the ~14 dead links visible in the field log's 404 thumbnails report
`[FAIL]` with reasons, region/auth-blocked ones report `restricted`,
non-original-titled tracks get flagged, and the auto-repair resolves
replacements that are **playability-verified from the NAS's own IP**. Probe
verdicts are SQLite-cached (ok 6 h, restricted 1 h, dead 24 h) so repeat
sweeps are nearly free. For an immediate full heal (outside the request
path) run on the NAS:

    php bulk_stream_repair.php --dry-run   # preview
    php bulk_stream_repair.php             # repair + persist

### 20.6 Tests (v12.1 round)

- `scripts/test_v12_1_classifier.py` — 20/20: the two field-log failure
  classes (as_D_LzF3_M dead, o6wtDPVkKqI restricted), hole 1 (ERROR must
  beat oEmbed-ok and DataAPI-embeddable), hole 2 (stale browser report
  cannot condemn), bot-wall fall-through, Data API death classes, verify
  liveness semantics, LIVE_STREAM_OFFLINE, age/country/syndication.
- v12 suites still green: `test_v12_scoring.py` (24/24),
  `test_v12_resolver_flow.py` (13/13).
- `node --check` clean on the patch; PHP brace/paren balance + duplicate
  scan clean on all edited files (the one `get_json_body` duplicate remains
  the known `function_exists`-guarded pair).

## 21. v12.2 — fresh-install round: "the stream audit thing doesn't work on a clean checkout" (2026-09)

### 21.1 Root cause 1 — `YOUTUBE_API_KEY` had no fallback define (fatal, silent)

On a fresh checkout (no `public/api/config.php` — it is created by install.sh
and never committed), `an_embed_probe()` references the `YOUTUBE_API_KEY`
constant at its Data-API gate. Every other configurable constant
(`GEMINI_API_KEY`, `LASTFM_API_KEY`, `APP_URL`, ...) has an
`if (!defined(...)) define(..., '')` fallback in `lib.php` — `YOUTUBE_API_KEY`
does not (the v6 round fixed this exact class for `GEMINI_API_KEY` and missed
this one). The result: the moment any probe, the CLI sweeper
(`bulk_stream_repair.php`), or `/api/verify-video` runs, PHP throws
"Undefined constant" and the worker **dies silently** — no error body, no log
line, an empty response. The Stream Auditor is dead on arrival on every
install that lacks a config.php.

Fix: fallback `define('YOUTUBE_API_KEY', '')` in `lib.php` (empty = Data API
signal skipped; oEmbed + InnerTube still classify, which is exactly how
config-less hosts already operate).

### 21.2 Root cause 2 — the bot wall wears the "region shadow" costume on datacenter IPs

v12.1 made InnerTube `WEB_EMBEDDED_PLAYER` playability **authoritative**
(HOLE 1). Correct on a residential egress — but on datacenter IPs (VPS
deployments, CI runners, cloud hosts) YouTube's bot wall answers **every**
player request, alive or dead, with `playabilityStatus: ERROR,
reason: "This video is unavailable"`. That is byte-identical to the
"region/auth shadow" class v12.1 hunted, so the classifier condemns every
video as `restricted`: audits report everything broken, and
`an_resolve_candidates()` — which only returns probe-confirmed `ok` links —
can never accept a replacement ("nothing above the points floor / verified").
That is the literal "it did reroute but some of them still don't work"
failure mode, from the other direction.

Fix (`an_innertube_trusted()` in routes_meta.php): before trusting InnerTube
verdicts, probe two universally-embeddable reference uploads
(`dQw4w9WgXcQ`, `jNQXAC9IVRw`). If InnerTube cannot produce an OK
playabilityStatus for ANY reference from this host, its per-video verdicts
are noise — `an_embed_probe()` skips the signal entirely (same handling as
the classic "not a bot" wall) and the verdict falls back to oEmbed + Data
API. On a clean residential network the references probe OK and v12.1's
authoritative-InnerTube semantics are preserved bit-for-bit. The trust
verdict is cached 10 minutes in `api_cache`.

### 21.3 The shipped seed library was 100 % dead — repaired with the engine itself

`public/api/seed.json` (and the legacy `src/initialTracks.ts` /
`src/seededTracks.ts`) still carried the original playlist's YouTube IDs —
**all 49 dead at audit time** (44 oEmbed-404 dead + 5 alive-but-bot-wall-`restricted`:
Idol, Kick Back, My Dearest, Bling-Bang-Bang-Born, Peace Sign). A fresh
install booted into a library where nothing plays until an admin manually
runs the auditor.

Fix: ran the (now working) engine end-to-end —

    php bulk_stream_repair.php            # 5 Alive | 44 Replaced & Saved | 0 Unresolved
    php bulk_stream_repair.php --dry-run  # re-audit: 49 Alive | 0 Would replace | 0 Unresolved

— then exported the repaired table back into `public/api/seed.json`
(same format, `scripts/export_seed.py`) and synced the two `src/` seed files
(`scripts/sync_src_tracks.py`, title-matched). Every swap is
points-receipted and oEmbed-verified; the 5 live links were kept untouched
(keep-if-alive policy). An independent Python oEmbed+identity sweep
(`scripts/independent_verify.py`, a deliberately separate code path from the
PHP engine) confirms **49/49 alive, 0 dead**.

### 21.4 Tests (v12.2 round)

- Isolation suite: `an_verify_embeddable_multi` / `an_innertube_embed_batch` /
  `an_embed_feedback_recent` / `an_embed_probe` each verified standalone
  (probe completes, verdicts cached per TTL).
- Resolver: `an_resolve_candidates("Unravel", ...)` returns 3 verified
  candidates with receipts (`fan upload +120, verified via oembed`) where
  pre-fix it returned 0.
- Full sweep: 44 repairs, re-audit 49/49 alive, independent Python check
  49/49 alive with identity matching (3 "weak" hits are Japanese-titled
  official uploads — correct links, ASCII-blind matcher).
- v12.1 classifier suite untouched and still consistent
  (`scripts/test_v12_1_classifier.py`).
