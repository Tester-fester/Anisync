# ANISYNC — Anime Theme Ranking Engine

Discover, rank, and collect anime theme music in a dynamic leaderboard and rating arena. Built with React 19, Vite, Express, Firebase, and Gemini.

> **This build ships the PHP + SQLite backend** (`public/api/`) with
> email/password account creation & login (JWT + PBKDF2), the moderation
> tools, and the Stream Auditor — all fixed and regression-tested. See
> **FIXES.md** for the full fix report, the admin account credentials, and
> the zero-config quick start (`./serve.sh`, or
> `PHP_CLI_SERVER_WORKERS=8 php -S 0.0.0.0:3000 -t public dev_router.php`).
>
> **v12.2** — the fresh-install round (FIXES.md §21): (a)
> `YOUTUBE_API_KEY` gained its missing fallback define — without it every
> probe/audit/verify-video call hit an undefined-constant fatal and died
> silently on any install without `config.php`; (b) new
> `an_innertube_trusted()` bot-wall guard — on datacenter IPs InnerTube
> answers every playability request with a generic ERROR ("This video is
> unavailable"), which v12.1's authoritative classifier condemned as
> `restricted`, so the resolver could never accept a replacement; the guard
> probes universally-embeddable reference uploads first and skips the noisy
> signal when the wall is up (residential/NAS semantics unchanged);
> (c) the shipped seed library was 100 % dead links — repaired with the
> engine itself (44 verified swaps, 5 alive kept, re-audit 49/49 alive,
> independently double-checked) so a fresh install boots playable.
>
> **v12.1** — two rounds in one: (a) the v12 engine was never actually
> deployed to the NAS (the old v4 backup code was still being served — now
> provable in one curl: `/health` reports `"engine":"12.1"`, and
> `deploy/verify-deploy.sh` runs a 7-point self-check); (b) the audit's last
> false-positive class is closed — InnerTube embed playability is
> authoritative, so region/auth-blocked videos ("exists, thumbnail loads,
> player says unavailable") can no longer audit as "ok", and the resolver
> can never hand them back as replacements. Plus the full request diet:
> ETag/304 conditional-GETs on every hot list endpoint, immutable static
> caching under `php -S`, client-side fetch coalescing + single-flight
> auth/refresh, and the plausible.io beacon removed. See FIXES.md §20.
> ⚠️ **`public/assets/` (the deployed bundle) and `src/` (the React source)
> have diverged** — see docs/AUDIT-v12.md before rebuilding anything from
> `src/`.
>
> **v12** — the v10/v11 engine lost in a backup regression has been rebuilt
> (FIXES.md §19): `verify-batch` really probes every link (oEmbed + InnerTube
> + Data API, SQLite-cached) instead of regex-checking id formats; every
> replacement is picked by the points system and **verified embeddable before
> it is returned**; error 150 is disambiguated against the server verdict so
> ad-blocker noise can't churn healthy tracks; and the NAS got gzip, ETags,
> static-asset caching, a rate-limiter that stops writing to SQLite on every
> LAN request, and ~4.9 MB of dead files removed.

## What's inside

- **Arena** — head-to-head track voting with ELO rating updates
- **Leaderboard** — sortable/filterable track table with preview drawer, lyrics, karaoke, AI theme finder
- **Tournaments** — bracket-style tournaments with online multiplayer voting, Twitch chat integration, predictions
- **Profile** — user badges, vibe spectrum radar, MAL sync, custom playlists, anime pokedex collectibles
- **Wiki** — anime / artist / track pages with MAL + AniDB + VGMdb cross-referencing
- **Admin** — proposal moderation queue, AI-powered dedup sweep, bulk import, sandbox search

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure secrets — copy .env.example and fill in
cp .env.example .env.local
# GEMINI_API_KEY is required. GOOGLE_APPLICATION_CREDENTIALS is required for
# the Firebase Admin SDK (server-side auth verification + custom claims).

# 3. Run
npm run dev
```

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `GEMINI_API_KEY` | yes | Gemini API for AI features (theme finder, dedup, taste analysis) |
| `GEMINI_MODEL` | no | Override the Gemini model (default `gemini-2.0-flash`) |
| `PORT` | no | Server port (default 3000; Cloud Run injects 8080) |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes (prod) | Path to Firebase Admin SDK service account JSON |
| `APP_URL` | no | Public URL of the deployment |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | not used | OAuth endpoints were removed; auth is via Firebase Auth |

## Firestore data model

See `firebase-blueprint.json` for the full schema. Collections:

| Collection | Purpose | Read | Write |
|------------|---------|------|-------|
| `users/{uid}` | User profiles, badges, vibe spectrum, custom lists, follows | signed-in | self (own profile) or admin |
| `tracks/{id}` | Anime tracks with ELO / W-L-D stats | public | admin (full) or signed-in (ELO bookkeeping only — range-checked) |
| `history/{id}` | Vote log (each vote writes one entry) | public | signed-in (create only) |
| `proposals/{id}` | User-submitted track additions / link fixes | signed-in | self (create / retract own) or admin |
| `tournaments/{id}` | Tournament brackets with matches | public | owner (creator) or admin |
| `franchise_cache/{key}` | AI franchise-filter results cache | public | signed-in (validated) |
| `artist_profiles/{id}` | Artist bio + image | public | signed-in (validated) |
| `reviews/{id}` | Per-track user reviews (1–10 rating + comment) | public | self (create / edit / delete own) or admin |
| `pokedex_collectibles/{id}` | Admin-curated collectible definitions | public | admin only |

### Security rules

`firestore.rules` is the **deployed** ruleset. `DRAFT_firestore.rules` is a stricter draft that has a critical bug (inverted `isAdmin()` — do NOT deploy). The shipped rules merge the strict `tracks` update rule (ELO-only, range-checked) from the draft.

Deploy with:

```bash
firebase deploy --only firestore:rules
```

### Admin setup

Admin status is determined by Firebase Custom Claims (`token.admin === true`), set via the Firebase Admin SDK:

```bash
# Grant admin to a user
node -e "
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  admin.auth().setCustomUserClaims('<UID>', { admin: true }).then(() => process.exit(0));
"
```

The legacy email allow-list (`mfrimi100@gmail.com`, `*@anielo.com`) is kept as a fallback during migration; remove it from `firestore.rules` and `src/utils/adminAuth.ts` once all admins have the claim.

## Project structure

```
├── server.ts                  # Express server — Gemini proxy, scraping, auth
├── firestore.rules            # DEPLOYED security rules
├── DRAFT_firestore.rules      # Stricter draft (has bug — DO NOT deploy)
├── firebase-blueprint.json    # Firestore data model schema
├── index.html                 # SPA shell + meta tags
├── public/                    # Static assets (logos, 500 page)
└── src/
    ├── App.tsx                # Main app shell (state, routing, auth)
    ├── main.tsx               # Entry point + ErrorBoundary
    ├── types.ts               # Shared TS types (Track, Tournament, User, etc.)
    ├── components/            # React components
    │   ├── badges.ts          # BADGE_LIST — extracted for tree-shaking
    │   ├── ErrorBoundary.tsx  # Global error boundary
    │   └── ConfirmDialog.tsx  # Custom confirm() replacement
    └── utils/
        ├── firebase.ts        # Firebase init + auth
        ├── firestoreService.ts# Firestore data layer (transactions, subscriptions)
        ├── elo.ts             # ELO math + voter coefficient
        ├── adminAuth.ts       # Admin claim verification
        ├── autoId.ts          # Firestore-style ID generation
        ├── safeLocalStorage.ts# try/catch wrapper for localStorage
        ├── confirm.tsx        # Promise-based confirm() singleton
        └── ...
```

## Key security / correctness changes vs. the original revision

1. **Server endpoints require auth** — every `/api/*` route now goes through `authMiddleware` (Firebase Admin token verification). AI routes require `requireAuth`, destructive routes require `requireAdmin`.
2. **Rate limiting** — 30 req/min/IP on AI routes, 120/min on others. In-memory; swap for Redis-backed limiter when scaling.
3. **Body size limit 1mb** (was 50mb — DoS amplifier).
4. **Helmet** for security headers + CSP.
5. **Input sanitization** on all Gemini prompts — strip control chars, cap lengths, neutralize prompt-injection patterns.
6. **Bounded LRU caches** (`themeCache`, `ostCache`, `lyricsCache`) — 500 entries, 1h TTL (was unbounded `Map`).
7. **Graceful shutdown** — `SIGTERM`/`SIGINT` handlers, `unhandledRejection` logger.
8. **Firestore rules hardened** — non-admin `tracks` updates restricted to ELO bookkeeping fields with range + monotonic checks. `tournaments` and `reviews` get ownership checks. `franchise_cache` / `artist_profiles` get shape validation. `users` rule fixed (was referencing a non-existent `favorites` field).
9. **Client admin check uses Firebase Custom Claims** — `getIdTokenResult(true)` instead of email comparison. Removed `username.includes('admin')` substring check.
10. **Firestore auto-IDs** — all ID generation uses `generateId('prefix')` (Firestore-style 20-char random) instead of `Date.now()`. No more collisions on concurrent writes.
11. **`runTransaction` for vote writes** — `saveMatchVote` now uses `runTransaction` + `FieldValue.increment()` for tallies. The ELO absolute-write race is reduced (server-side Cloud Function would eliminate it fully).
12. **`toggleFollowUser` is transactional** — concurrent follows no longer lose counts.
13. **Lazy loading on every `<img>`** — 76 img tags patched with `loading="lazy"` + `decoding="async"`.
14. **localStorage reads are safe** — `safeGetJSON` swallows parse failures instead of crashing the root component.
15. **Global ErrorBoundary** — single component crash no longer white-screens the app.
16. **Custom `confirm()`** — `window.confirm()` replaced with a Promise-based motion-styled dialog.
17. **Toasts replace `alert()`** — all blocking `alert()` calls converted to Sonner toasts.
18. **Admin UI no longer shows ads** — AdBanner exclusion list updated to cover admin/moderation pages.
19. **`__controlAppForScreenshots` gated to dev** — no longer leaks app state onto `window` in production.
20. **`BADGE_LIST` extracted to `badges.ts`** — the `lazy(() => import('./components/UserProfileSection'))` actually defers loading now (was defeated by a static `import { BADGE_LIST }` from the same file).
21. **1-second re-render in `TournamentBracket` gated** — only runs when an online tournament has an active countdown.
22. **`html-to-image` dropped** — only `html2canvas` was actually used.
23. **`testConnection()` removed** — no longer issues a Firestore read on every page load.
24. **Server port reads `process.env.PORT`** — works on Cloud Run.
25. **Static assets have Cache-Control headers** — hashed assets cached 1 year, others 1h.

## Known limitations

- **ELO absolute-write race (partial fix)**: `saveMatchVote` uses a transaction but still writes the caller-computed absolute ELO. A fully race-free path requires moving the ELO computation server-side (Cloud Function).
- **Lyrics**: `/api/lyrics` proxies LRCLIB (synced + plain); no AI fallback — unknown tracks return a stub payload by design.
- **In-memory caches don't survive restart**: the PHP build caches in SQLite (`api_cache`) so these DO survive restarts.
- **`src/` ↔ `public/` divergence**: the deployed bundle in `public/assets/` was built from a PHP-era source tree that no longer matches `src/` (which still boots Firebase/Firestore). Rebuilding from `src/` produces a bundle that does NOT work against the PHP backend. Reconcile before rebuilding.
- **`html-to-image` is still bundled**: `ShareCard.tsx` imports `toPng` from it (this README previously claimed it was dropped — wrong).

## Deploying

```bash
npm run build
# Deploy dist/ to your host (Cloud Run, Render, Fly.io, etc.)
# Set environment variables on the host
npm start
```

For Cloud Run:

```bash
gcloud run deploy anisync \
  --source . \
  --region us-central1 \
  --set-env-vars GEMINI_MODEL=gemini-2.0-flash \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

## License

Apache-2.0
