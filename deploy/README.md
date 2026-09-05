# ANISYNC — Step-by-Step Setup Guide (NO Credit Card)

**Architecture:** Netlify (frontend + light API) + your PC (heavy scraping, when needed)
**Total cost:** $0/mo · **Cards required:** 0 · **Time:** ~30 min

---

## HOW THIS WORKS

```
Normal users (24/7, your PC can be off):
   Browser → Netlify (React SPA + light API endpoints)
              ↓
            Firebase Firestore

Admin heavy work (your PC must be on):
   Your PC (npm start) → runs scrapers → writes to Firestore
```

- **Netlify hosts** the React SPA + ~25 light API endpoints (Gemini AI, YouTube, Jikan, LRCLIB, AniList, etc.) — all fast, all work within Netlify's 10s timeout
- **Your PC runs** the 4 heavy scraping endpoints (VGMdb, AniDB, bulk-import, dedup-sweep) when you need to do admin work — no timeout, no limits
- **Firebase Firestore** stays where it is — both Netlify and your PC read/write to it

---

## PREREQUISITES (all free, no card)

### 1. GitHub account → https://github.com

### 2. Gemini API key → https://aistudio.google.com/apikey → **Create API key** → copy it (starts with `AIza...`)

### 3. Firebase service account JSON
- https://console.firebase.google.com → your project
- ⚙️ **Project settings** → **Service Accounts** tab → **Generate new private key**
- Open the downloaded `.json` in a text editor → select ALL → copy

### 4. Last.fm API key (optional) → https://www.last.fm/api/account/create → copy the API key

---

## STEP 1 — Push to GitHub

### 1.1 Create a NEW GitHub repo
1. https://github.com → **+** (top-right) → **New repository**
2. **Repository name:** `anisync`
3. **Visibility:** **Private**
4. **DO NOT** check any checkboxes
5. **Create repository**

### 1.2 Push the code
```bash
cd /path/to/Anisync-main
git init
git add .
git commit -m "ANISYNC initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/anisync.git
git push -u origin main
```

✅ **Step 1 done.**

---

## STEP 2 — Deploy to Netlify

### 2.1 Sign up (NO card)
1. Go to https://app.netlify.com
2. **Sign up** → **GitHub** → authorize Netlify
3. **No card is asked at any point.**

### 2.2 Create a new site
1. Dashboard → **Add new site** (button) → **Import an existing project**
2. **GitHub** → find and click **`anisync`**
3. Netlify auto-detects the `netlify.toml` and pre-fills everything:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
4. Scroll to **Environment variables** and click **Add variable** for each:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | (paste your Gemini key — `AIza...`) |
| `FIREBASE_SERVICE_ACCOUNT` | (paste the ENTIRE JSON string — starts with `{` ends with `}`) |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `LASTFM_API_KEY` | (paste your Last.fm key — optional) |

5. Click **Deploy site**

### 2.3 Wait for the build
Netlify will:
1. Clone your repo (~5s)
2. Run `npm install` (~30s)
3. Run `npm run build` (~30s — builds SPA + server bundle)
4. Deploy static files to CDN + deploy the serverless function

Total: ~2-3 minutes. You'll see live build logs — if anything fails, you see exactly why.

### 2.4 Get your URL
When deployment succeeds, Netlify gives you a URL like:
```
https://anisync.netlify.app
```
(or `https://anisync-xxxxx.netlify.app` if the name was taken)

### 2.5 Verify the API
Open a browser tab → go to:
```
https://anisync.netlify.app/api/health
```

You should see:
```json
{"status":"ok","uptime":12,"ts":1234567890,"gemini":true,"admin":true}
```

- `"gemini":true` → GEMINI_API_KEY is set ✓
- `"admin":true` → FIREBASE_SERVICE_ACCOUNT is set ✓

### 2.6 Add Netlify URL to Firebase Authorized Domains
**CRITICAL — without this, Google Sign-In fails:**
1. https://console.firebase.google.com → your project
2. **Authentication** → **Settings** → **Authorized domains**
3. **Add domain** → type `anisync.netlify.app` (WITHOUT `https://`) → **Add**

✅ **Step 2 done.** Your app is LIVE on Netlify. The frontend + light API endpoints work 24/7.

---

## STEP 3 — Test the Netlify deployment

### 3.1 Open your app
Go to `https://anisync.netlify.app` — the app should load.

### 3.2 Test Google Sign-In
Click the profile icon → **Connect Live Google Account** → should redirect back and show your profile.

**If it fails with "Unauthorized domain":** you forgot Step 2.6.

### 3.3 Test voting
Vote on a track in the Arena → ELO should update, history should appear.

### 3.4 Test lyrics
Open a track's lyrics panel → should show real lyrics from LRCLIB.

### 3.5 Test YouTube playback
Click a track's play button → YouTube iframe should load.

✅ **All pass = your app is live 24/7 for normal users.**

---

## STEP 4 — Set up your PC for heavy admin work

The 4 heavy scraping endpoints (VGMdb, AniDB, bulk-import, dedup-sweep) will timeout on Netlify's 10s limit. You run these locally when you need to do admin work.

### 4.1 Create a local `.env` file
In the `Anisync-main` folder on your PC, create a file named `.env` (if it doesn't exist):

```env
GEMINI_API_KEY=your_gemini_key_here
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"anisync-abf14",...}
GEMINI_MODEL=gemini-2.5-flash
LASTFM_API_KEY=your_lastfm_key_here
NODE_ENV=production
```

(Paste the same values you set in Netlify. The `FIREBASE_SERVICE_ACCOUNT` must be the entire JSON string on ONE line.)

### 4.2 Build the server locally
```bash
cd /path/to/Anisync-main
npm install
npm run build
```

### 4.3 Start the local server
```bash
npm start
```

You should see:
```
[Server] Listening on http://0.0.0.0:3000
```

### 4.4 Use the local server for admin work
Open `http://localhost:3000` in your browser. This is the FULL app with NO 10s timeout — all endpoints work, including:
- Bulk import (VGMdb, AniDB, Anison scraping)
- Dedup sweep
- OST discovery
- Everything else

When you're done with admin work, press `Ctrl+C` to stop the server. The Netlify deployment continues running 24/7 for normal users.

✅ **Step 4 done.** You can now do heavy admin work locally whenever you need to.

---

## STEP 5 — (Optional) Eliminate cold starts

Netlify functions spin down after ~15 min of idle. The first request after idle takes 1-3s extra. A free pinger eliminates this.

### UptimeRobot (free, no card)
1. https://uptimerobot.com → **Register** (email + password)
2. **Add New Monitor**:
   - Monitor type: **HTTP(s)**
   - Friendly name: `ANISYNC keep-alive`
   - URL: `https://anisync.netlify.app/api/health`
   - Monitoring interval: **5 minutes**
3. **Create Monitor**

Now Netlify gets pinged every 5 min → no cold starts.

---

## HOW TO USE YOUR APP

### For normal use (24/7, PC can be off)
- Go to `https://anisync.netlify.app`
- Vote, browse, search, play music, view profiles — everything works
- Your PC doesn't need to be on

### For admin work (PC must be on)
1. On your PC: `cd Anisync-main && npm start`
2. Open `http://localhost:3000` in your browser
3. Do your admin work (bulk import, dedup, scraping)
4. When done: `Ctrl+C` to stop
5. The data you imported is now in Firestore — visible on the Netlify site too

### Deploy new code
```bash
git add .
git commit -m "your changes"
npm run build          # rebuild dist/
git add dist/
git commit -m "rebuild dist"
git push               # Netlify auto-rebuilds
```

---

## TROUBLESHOOTING

### Netlify build fails
Unlike Back4App, Netlify shows REAL build logs. Go to:
- Netlify dashboard → your site → **Deploys** → click the failed deploy → **Deploy log**
- Copy the full error and paste it to me

Common causes:
- `package-lock.json` out of sync → run `npm install` locally, commit, push
- Node version mismatch → the `netlify.toml` sets `node_version = "22"`, make sure your local Node is 18+

### Google Sign-In fails with "Unauthorized domain"
You forgot Step 2.6. Add `anisync.netlify.app` to Firebase → Authentication → Settings → Authorized domains.

### `/api/health` returns `"admin":false`
`FIREBASE_SERVICE_ACCOUNT` env var is missing or invalid JSON. Re-download from Firebase Console, copy the ENTIRE JSON (one line), paste as the env var value.

### API calls timeout (10s error)
This happens for the 4 heavy endpoints on Netlify. Run `npm start` locally and use `http://localhost:3000` for those operations.

### Cold start delay (1-3s on first request)
Set up the UptimeRobot pinger (Step 5).

### Local server won't start
- Check `.env` file exists in the project root
- Check `FIREBASE_SERVICE_ACCOUNT` is valid JSON (no line breaks in the middle)
- Check `dist/server.cjs` exists (run `npm run build` if not)

### youtubei.js search returns empty
YouTube shipped an InnerTube change. Fix: `npm install youtubei.js@latest && npm run build && git add . && git commit -m "bump youtubei.js" && git push`

### Gemini 429 (rate limit)
Set `GEMINI_MODEL=gemini-2.5-flash` (10 RPM vs 5 RPM for 2.0-flash).

---

## COST SUMMARY

| Service | Cost | Card? |
|---|---|---|
| Netlify (free tier) | $0 | ❌ No card |
| Cloudflare (not needed for this setup) | — | — |
| UptimeRobot (optional pinger) | $0 | ❌ No card |
| Firebase (Spark plan) | $0 | ❌ No card |
| Gemini API (free tier) | $0 | ❌ No card |
| All other APIs (LRCLIB, AnimeThemes, AniList, etc.) | $0 | ❌ No card |
| GitHub (private repo) | $0 | ❌ No card |
| Your PC (electricity for admin work) | ~$0 (only when you're using it) | — |
| **Total** | **$0/mo** | **0 cards** |

---

## WHAT TO DO RIGHT NOW

1. **Download the fresh zip** from `/home/z/my-project/download/Anisync-main.zip`
2. **Unzip it** locally
3. **Push to GitHub** (Step 1)
4. **Deploy on Netlify** (Step 2) — sign up at https://app.netlify.com with GitHub
5. **Test** (Step 3) — verify the app works 24/7
6. **Set up local admin** (Step 4) — for heavy operations when you need them
7. **(Optional) Set up pinger** (Step 5) — eliminates cold starts

This architecture gives you:
- ✅ 24/7 live app on Netlify (no card, free forever)
- ✅ Full admin capabilities on your PC (no timeout limits)
- ✅ No phone hosting, no battery drain, no Docker, no Back4App
- ✅ Real build logs if anything fails

If the Netlify build fails, copy the full error from the Netlify deploy log and paste it to me — I'll diagnose it immediately.
