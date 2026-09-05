/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import crypto from "crypto";
import http from "http";
import { getMainAnimeName } from "./src/utils/animeFranchises";

dotenv.config();

const app = express();
// Cloud Run / most PaaS inject PORT=8080. Default to 3000 for local dev only.
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
// Lightweight security headers (CSP, X-Frame-Options, nosniff, etc.) — drop-in.
// Helmet is imported lazily inside startServer() so the module remains
// importable in CJS contexts and the dep is optional in dev.
let helmet: any = null;

function installHelmet(app: express.Express) {
  if (!helmet) return;
  const isDev = process.env.NODE_ENV !== "production";
  app.use(helmet({
    contentSecurityPolicy: {
      // In dev we relax CSP so Vite's HMR WebSocket + Google Fonts can load.
      // In production we tighten it but still allow the resources the app
      // actually needs (Google Fonts CSS, YouTube embeds, Firebase, Plausible
      // analytics, YouTube thumbnail images).
      directives: {
        defaultSrc: ["'self'"],
        // Firebase Auth loads scripts from apis.google.com for the Google
        // sign-in popup. Without this, the popup fails with a CSP error.
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://plausible.io", "https://apis.google.com", "https://www.gstatic.com", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        // Firebase Auth uses iframes from your project's firebaseapp.com domain
        // AND apis.google.com for the sign-in popup. Both must be allowed.
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://youtube.com",
          "https://apis.google.com",
          "https://anisync-abf14.firebaseapp.com",
          "https://*.firebaseapp.com",
        ],
        connectSrc: isDev
          // Dev: allow Vite HMR (ws + http on any port) + Firebase + Google APIs + Plausible analytics
          ? ["'self'", "ws:", "wss:", "http:", "https:", "https://www.googleapis.com", "https://firestore.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://apis.google.com", "https://anisync-abf14.firebaseapp.com", "https://plausible.io"]
          // Prod: only what the app actually talks to + Plausible analytics
          : ["'self'", "https://www.googleapis.com", "https://firestore.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://apis.google.com", "https://anisync-abf14.firebaseapp.com", "https://plausible.io"],
        mediaSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // would break YouTube embeds
  }));
}

app.disable("x-powered-by");

// Body size: 1mb is more than enough for our largest payload (batch track
// arrays for /api/smart-sweep-duplicates). The previous 50mb limit was a DoS
// amplifier.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// ---------------------------------------------------------------------------
// Rate limiting (in-memory; swap for Redis-backed limiter when scaling out)
// ---------------------------------------------------------------------------
interface RateBucket { count: number; resetAt: number; }
const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_AI = 30;      // Gemini-calling endpoints — strict
const RATE_LIMIT_DEFAULT = 120; // other endpoints

function rateLimit(maxPerMinute: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxPerMinute) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: "Too many requests. Slow down." });
    }
    // Lazy GC: keep the map from growing without bound.
    if (rateBuckets.size > 10_000) {
      for (const [k, b] of rateBuckets) if (b.resetAt < now) rateBuckets.delete(k);
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Firebase Admin auth — verifies the `Authorization: Bearer <idToken>` header
// and stamps `req.user = { uid, email, admin }`. Falls back to anonymous
// (req.user = null) if no header is sent, so public endpoints still work.
// Initialized inside startServer() because firebase-admin requires async init.
// ---------------------------------------------------------------------------
let adminAuth: any = null;

declare module "express" {
  interface Request {
    user?: { uid: string; email: string | null; admin: boolean } | null;
  }
}

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  const idToken = header.slice(7);
  if (!adminAuth) {
    req.user = null;
    return next();
  }
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      admin: decoded.admin === true || decoded.email === "mfrimi100@gmail.com" || (typeof decoded.email === "string" && decoded.email.endsWith("@anielo.com")),
    };
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired auth token." });
  }
  next();
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sign-in required." });
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user || !req.user.admin) return res.status(403).json({ error: "Admin access required." });
  next();
}

// Apply auth to every request — public endpoints simply won't call requireAuth.
app.use(authMiddleware);

// ---------------------------------------------------------------------------
// Health & readiness probe (unauthenticated)
// Mounted BEFORE any heavy middleware so it stays cheap under load.
// Render/Koyeb/etc. free tiers spin down idle services; point a free pinger
// (cron-job.org / UptimeRobot) at /health every ~10 min to keep the service
// warm. Returns 200 with a tiny JSON payload — no DB/Firestore reads.
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    ts: Date.now(),
    // `ok` if a Gemini key is configured (does NOT reveal the key).
    gemini: Boolean(process.env.GEMINI_API_KEY),
    admin: adminAuth !== null,
  });
});

// ---------------------------------------------------------------------------
// Initialize Gemini
// ---------------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// ---------------------------------------------------------------------------
// Bounded LRU cache helper
// ---------------------------------------------------------------------------
class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number, private ttlMs?: number) {}
  has(k: K) { return this.map.has(k); }
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      // Refresh recency.
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
    if (this.ttlMs) {
      setTimeout(() => this.map.delete(k), this.ttlMs).unref?.();
    }
  }
  delete(k: K) { this.map.delete(k); }
  size() { return this.map.size; }
}

// Cache and global flagging for performance and quota management
let globalGoogleSearchQuotaExceeded = false;
let globalGeminiQuotaExceeded = false;
const themeCache = new LRU<string, any[]>(500, 60 * 60 * 1000);    // 500 entries, 1h TTL
const lyricsCache = new LRU<string, any>(500, 60 * 60 * 1000);
const ostCache = new LRU<string, any[]>(500, 60 * 60 * 1000);

// Reset the quota flag on a global 1h timer (not gated on a single endpoint).
setInterval(() => { globalGeminiQuotaExceeded = false; }, 60 * 60 * 1000).unref?.();

// ---------------------------------------------------------------------------
// Input sanitization helpers — used before interpolating user input into
// Gemini prompts. Strips control characters, caps string length, caps array
// size, and replaces known prompt-injection phrases.
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|prior) instructions/gi,
  /you are (?:now )?(?:a|an) (?:different|new)/gi,
  /system prompt/gi,
  /<\/?(?:system|assistant|user)>/gi,
];

function sanitizeForPrompt(input: unknown, maxLen = 200): string {
  if (input == null) return "";
  let s = typeof input === "string" ? input : JSON.stringify(input);
  // Strip control chars (keep newlines for readability).
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Neutralize known injection patterns.
  for (const p of INJECTION_PATTERNS) s = s.replace(p, "[filtered]");
  // Cap length.
  if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
  return s;
}

function sanitizeArrayForPrompt<T>(arr: T[] | undefined | null, maxItems = 50, itemMaxLen = 200): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxItems).map((item) => {
    if (typeof item === "string") return sanitizeForPrompt(item, itemMaxLen) as unknown as T;
    if (item && typeof item === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? sanitizeForPrompt(v, itemMaxLen) : v;
      }
      return out as unknown as T;
    }
    return item;
  });
}

/**
 * Clean and normalize anime names for search queries.
 */
function cleanSearchQuery(query: string): string {
  if (!query) return "";
  return query
    .replace(/[ä]/gi, "a")
    .replace(/[ö]/gi, "o")
    .replace(/[ü]/gi, "u")
    .replace(/[éêè]/gi, "e")
    .replace(/[^\x00-\x7F]/g, " ") // Remove non-ASCII
    .replace(/[?.:;!]/g, " ")       // Remove punctuation that breaks search
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches multiple query variants for search.
 */
function getSearchVariants(name: string): string[] {
  const cleaned = cleanSearchQuery(name);
  const variants = [
    name,
    cleaned,
    name.replace(/Season \d+ Part \d+/i, "").trim(),
    name.replace(/Season \d+/i, "").trim(),
    name.replace(/[0-9]+$/g, "").trim(), // Strip trailing digits
    name.split(/[:(-]/)[0].trim(),
    cleaned.split(/\s+/).slice(0, 4).join(" ") // Take first 4 words of cleaned
  ];
  return Array.from(new Set(variants)).filter(v => v.length > 3);
}

/**
 * Fetches a URL and decodes its content using a specific encoding (e.g., Shift-JIS for Japanese sites).
 */
async function fetchWithEncoding(url: string, encoding: string = "utf-8"): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ja;q=0.8"
      }
    });
    if (!res.ok) return "";
    const buffer = await res.arrayBuffer();
    return iconv.decode(Buffer.from(buffer), encoding);
  } catch (err) {
    console.log(`Fetch silent note [${url}]:`, err instanceof Error ? err.message : String(err));
    return "";
  }
}

/**
 * Scrapes Anison.info for tracks. This is an authoritative database for Japanese anime music.
 */
async function scrapeAnison(animeName: string): Promise<any[]> {
  try {
    const variants = getSearchVariants(animeName);
    for (const query of variants.slice(0, 3)) {
      console.log(`[Anison Scraper] Attempting query search: "${query}"`);
      const searchUrl = `http://anison.info/data/search.php?m=pro&q=${encodeURIComponent(query)}`;
      const html = await fetchWithEncoding(searchUrl, "shift-jis");
      if (!html) continue;

      const $ = cheerio.load(html);
      
      // Anison search results usually list programs in a table. Let's find any program link
      let programLink = $("div.result a").first().attr("href") || $("td.title a").first().attr("href");
      if (!programLink) {
        // Let's try any anchor matching "program.php"
        programLink = $("a[href*='program.php']").first().attr("href") || $("a[href*='pro.php']").first().attr("href");
      }
      
      if (!programLink) continue;

      // Navigate to the program detail page
      const detailUrl = programLink.startsWith("http") ? programLink : "http://anison.info/data/" + programLink;
      const detailHtml = await fetchWithEncoding(detailUrl, "shift-jis");
      if (!detailHtml) continue;
      
      const $$ = cheerio.load(detailHtml);
      const results: any[] = [];

      // Parse the lists (OP, ED, OST, etc.)
      $$("table.list tr").each((i, el) => {
        const typeText = $$(el).find("td.ue").text().trim() || $$(el).find("td:nth-child(2)").text().trim();
        const songTitle = $$(el).find("td.song_name a").text().trim() || $$(el).find("td.song_name").text().trim();
        const artist = $$(el).find("td.vocal_name").text().trim() || $$(el).find("td.vocal").text().trim();
        
        if (songTitle) {
          let type: string = "OST";
          if (typeText.includes("OP") || typeText.toLowerCase().includes("opening")) type = "OP";
          else if (typeText.includes("ED") || typeText.toLowerCase().includes("ending")) type = "ED";
          else if (typeText.includes("IN") || typeText.toLowerCase().includes("insert")) type = "OST";

          results.push({
            title: songTitle,
            artist: artist || "Unknown Artist",
            type,
            tags: ["Scraped"],
            animeName: animeName
          });
        }
      });

      if (results.length > 0) {
        console.log(`[Anison Scraper] Found ${results.length} songs for "${animeName}" with query "${query}".`);
        return results;
      }
    }
    return [];
  } catch (err) {
    console.log(`[Anison Scraper] Offline mode, bypassed or empty: ${(err as Error).message || err}`);
    return [];
  }
}

/**
 * Scrapes AniDB for music information.
 */
async function scrapeAniDB(animeName: string): Promise<any[]> {
  try {
    const variants = getSearchVariants(animeName);
    for (const query of variants.slice(0, 3)) {
      console.log(`[AniDB Scraper] Attempting query search: "${query}"`);
      const searchUrl = `https://anidb.net/anime/?adb.search=${encodeURIComponent(query)}&do.search=1`;
      const html = await fetchWithEncoding(searchUrl);
      if (!html) continue;

      let $ = cheerio.load(html);
      
      // If we are on the search results grid page rather than details, find the first real anime link
      const detailsLink = $("table.animelist td.name a").first().attr("href") || $("a[href*='/anime/']").first().attr("href") || $("a[href*='/a']").first().attr("href");
      let directHtml = html;

      if (detailsLink && !html.includes("class=\"songlist\"") && !html.includes("class=\"song\"")) {
        const fullLink = detailsLink.startsWith("http") ? detailsLink : `https://anidb.net${detailsLink}`;
        console.log(`[AniDB Scraper] Redirecting to detail page: ${fullLink}`);
        const fetchRes = await fetchWithEncoding(fullLink);
        if (fetchRes) {
          directHtml = fetchRes;
          $ = cheerio.load(directHtml);
        }
      }

      const results: any[] = [];

      // Target different potential table rows representing themes
      $("table.songlist tr, tr.song").each((i, el) => {
        const typeText = $(el).find("td.type").text().trim() || $(el).find("td.enum").text().trim(); 
        const songTitle = $(el).find("td.name label").text().trim() || $(el).find("td.name a").text().trim() || $(el).find("td.name").text().trim();
        let artist = $(el).find("td.creator").text().trim() || "Various";

        if (songTitle) {
          let type = "OP";
          if (typeText.includes("OP") || typeText.toLowerCase().includes("opening")) type = "OP";
          else if (typeText.includes("ED") || typeText.toLowerCase().includes("ending")) type = "ED";
          else type = "OST";

          results.push({
            title: songTitle,
            artist: artist || "Various",
            type,
            tags: ["AniDB"],
            animeName: animeName
          });
        }
      });

      if (results.length > 0) {
        console.log(`[AniDB Scraper] Found ${results.length} songs for "${animeName}" with query "${query}".`);
        return results;
      }
    }
    return [];
  } catch (err) {
    console.log(`[AniDB Scraper] Offline or bypassed search: ${(err as Error).message || err}`);
    return [];
  }
}

/**
 * Scrapes AniDB for anime relations (Prequels, Sequels, etc.)
 */
async function scrapeAniDBRelations(animeName: string): Promise<any[]> {
  try {
    const variants = getSearchVariants(animeName);
    for (const query of variants.slice(0, 3)) {
      console.log(`[AniDB Relations] Attempting query search: "${query}"`);
      const searchUrl = `https://anidb.net/anime/?adb.search=${encodeURIComponent(query)}&do.search=1`;
      const html = await fetchWithEncoding(searchUrl);
      if (!html) continue;

      let $ = cheerio.load(html);
      
      const detailsLink = $("table.animelist td.name a").first().attr("href") || $("a[href*='/anime/']").first().attr("href");
      let directHtml = html;

      if (detailsLink && !html.includes("id=\"tab_relations\"") && !html.includes("class=\"relations\"")) {
        const fullLink = detailsLink.startsWith("http") ? detailsLink : `https://anidb.net${detailsLink}`;
        const fetchRes = await fetchWithEncoding(fullLink);
        if (fetchRes) {
          directHtml = fetchRes;
          $ = cheerio.load(directHtml);
        }
      }

      const relations: any[] = [];
      // Look for the relations table. AniDB typically uses a table with class "relations" or inside a tab.
      $("table.relations tr, #tab_relations_pane tr").each((i, el) => {
        const type = $(el).find("th").text().trim() || $(el).find("td.type").text().trim();
        const relatedTitle = $(el).find("td.name a").text().trim() || $(el).find("a[href*='/anime/']").last().text().trim();
        const relUrl = $(el).find("td.name a").attr("href") || $(el).find("a[href*='/anime/']").last().attr("href");

        if (relatedTitle && type && type !== "Type") {
          relations.push({
            title: relatedTitle,
            type: type.replace(/:$/, ""),
            url: relUrl ? (relUrl.startsWith("http") ? relUrl : `https://anidb.net${relUrl}`) : null
          });
        }
      });

      if (relations.length > 0) {
        console.log(`[AniDB Relations] Found ${relations.length} relations for "${animeName}".`);
        return relations;
      }
    }
    return [];
  } catch (err) {
    console.log(`[AniDB Relations] Offline or empty relations: ${(err as Error).message || err}`);
    return [];
  }
}

/**
 * Score a video result based on metadata, with heavy penalties for replicas/remixes/covers.
 */
function scoreVideoResult(item: { videoId: string; title: string }, queryTitle: string, queryType: string, queryArtist: string): number {
  const normTitle = item.title.toLowerCase();
  const qTitleLower = queryTitle.toLowerCase();
  const qArtistLower = queryArtist.toLowerCase();
  
  let score = 100;

  // Crucial Penalties (non-original covers, looping, remixes, audio effects)
  const heavyPenalties = [
    'remix', 'cover', 'piano', 'guitar', 'instrumental', 'synthesia', 'violin', 'karaoke',
    'synthwave', 'lofi', 'slowed', 'reverb', 'bass boosted', '8-bit', '8bit', 'nightcore',
    'acoustic', 'orchestra', 'mashup', 'reaction', 'review', 'vocal cover', 'metal cover',
    'drum cover', '1 hour', '1hour', '10 hours', '10hour', 'loop', 'tutorial', 'gameplay',
    'chiptune', 'synthesizer', 'pitch shifted', 'extended', 'jazz', 'lo-fi',
    // 8D / spatial audio effects — fake "surround" mixes, never official
    '8d', '8d audio', '8d music', '8d version', '16d', '3d audio',
    // Speed/pitch manipulations
    'sped up', 'speed up', 'fast version', 'slowed down', 'slowed+reverb',
    'chipmunk', 'deep voice', 'low voice',
    // Quality/format red flags
    'earrape', 'distorted', 'distortion', 'cracked', 'leaked',
    // Compilation/aggregation channels
    'compilation', 'mix playlist', 'best of', 'top 10', 'anthology',
    // AI-generated covers (growing trend)
    'ai cover', 'ai voice', 'ai singing', 'voicemod', 'rvc',
    // Lyric/video overlays
    'lyrics video', 'lyric video', 'fanmade', 'fan made', 'fan edit',
    // Region/language variants that are usually re-uploads
    'español', 'sub español', 'sub spanish', 'português', 'dublado',
    // Misc non-official
    'tv size', 'tv-size', 'hd', '4k', 'audio only'
    // NOTE: "full version", "full song", and "amv" are NOT banned —
    // full versions are often the official upload, and AMVs can be
    // legitimate fan creations that users want to rank.
  ];

  for (const word of heavyPenalties) {
    if (normTitle.includes(word)) {
      // Avoid penalizing if the official title actually contains that keyword
      const queryHasWord = qTitleLower.includes(word) || qArtistLower.includes(word);
      if (!queryHasWord) {
        score -= 300; // Drastic penalty to make any cover fall behind
      }
    }
  }

  // Exact title match bonus
  if (normTitle.includes(qTitleLower)) {
    score += 150;
  } else {
    // Word-by-word match
    const queryWords = qTitleLower.split(/[\s,.'"-]+/).filter(w => w.length > 2);
    let matchedWords = 0;
    for (const word of queryWords) {
      if (normTitle.includes(word)) {
        matchedWords++;
      }
    }
    if (queryWords.length > 0) {
      score += Math.floor((matchedWords / queryWords.length) * 80);
    }
  }

  // Artist match bonus
  if (qArtistLower && qArtistLower !== 'unknown' && qArtistLower !== 'unknown performer' && qArtistLower !== 'various') {
    if (normTitle.includes(qArtistLower)) {
      score += 70;
    } else {
      const artistWords = qArtistLower.split(/[\s,.'"-]+/).filter(w => w.length > 2);
      let matchedArtists = 0;
      for (const w of artistWords) {
        if (normTitle.includes(w)) {
          matchedArtists++;
        }
      }
      if (artistWords.length > 0) {
        score += Math.floor((matchedArtists / artistWords.length) * 40);
      }
    }
  }

  // Theme category type matching
  const activeType = queryType.toLowerCase();
  if (activeType === 'op') {
    if (normTitle.includes('op') || normTitle.includes('opening')) {
      score += 50;
    }
  } else if (activeType === 'ed') {
    if (normTitle.includes('ed') || normTitle.includes('ending')) {
      score += 50;
    }
  } else if (activeType === 'ost') {
    if (normTitle.includes('ost') || normTitle.includes('soundtrack') || normTitle.includes('background music') || normTitle.includes('bgm')) {
      score += 50;
    }
  }

  // Official audio/visual identifiers bonus
  if (normTitle.includes('official') || normTitle.includes('mv') || normTitle.includes('music video') || normTitle.includes('original')) {
    score += 50;
  }
  
  if (normTitle.includes('tv size') || normTitle.includes('tv-size') || normTitle.includes('creditless') || normTitle.includes('creditsless')) {
    score += 30;
  }

  return score;
}

/**
 * Smart searches YouTube in real-time, scores results, scores matches, and selects
 * the premium video matching the query, preventing covers, remixes or loops.
 */
async function resolveYoutubeId(
  title: string,
  artist: string,
  animeName: string,
  type: string,
  excludedIds: string[] = []
): Promise<string> {
  try {
    // Add "anime", "OST" keywords to ensure YouTube knows it's anime related to prevent fetching tracks by popular Western artists with the same name.
    let searchType = type.trim();
    if (searchType.toLowerCase() === 'ost') {
       searchType = 'OST';
    } else {
       searchType = `anime ${searchType}`;
    }
    const query = `${animeName.trim()} ${searchType} ${title} ${artist && artist !== 'Unknown' ? artist.trim() : ''}`;

    // Use the consolidated YouTube client (youtubei.js primary, yt-search fallback).
    const { searchVideos } = await import('./src/utils/youtubeClient');
    const { videos } = await searchVideos(query, 20);

    if (videos.length === 0) {
      return '';
    }

    const renderers = videos.map(v => ({
      videoId: v.videoId,
      title: v.title + (v.author ? ' ' + v.author : '')
    }));

    // Filter out already assigned or excluded IDs
    const candidates = renderers.filter(r => !excludedIds.includes(r.videoId));

    if (candidates.length === 0) {
      return '';
    }

    // Score all candidates
    const scored = candidates.map(item => ({
      ...item,
      score: scoreVideoResult(item, title, type, artist)
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    console.log(`[Smart Match] "${query}" top outcome: VideoID: ${scored[0]?.videoId} ("${scored[0]?.title}") Score: ${scored[0]?.score}`);

    return scored[0]?.videoId || '';
  } catch (err) {
    console.error(`Error resolving YouTube stream for "${title}":`, err);
    return '';
  }
}


/**
 * Scrapes VGMdb for official album tracklists
 */
async function scrapeVGMdbTracklists(animeName: string): Promise<any[]> {
  try {
    const variants = getSearchVariants(animeName);
    for (const query of variants.slice(0, 2)) {
      console.log(`[VGMdb Verification] Searching for: "${query}"`);
      const searchUrl = `https://vgmdb.net/search?q=${encodeURIComponent(query)}`;
      const html = await fetchWithEncoding(searchUrl);
      if (!html) continue;

      let $ = cheerio.load(html);
      
      const verifiedTracks: any[] = [];
      const isAlbumPage = $("table#tracklist").length > 0;

      if (isAlbumPage) {
        // Direct Redirection: We landed straight on an album page
        const albumTitle = $("h1").first().text().trim() || animeName;
        const catalog = $("span.smalltext").first().text().trim() || "";
        
        $("table#tracklist tr.tracklist_row, table#tracklist tr").each((j, tr) => {
          const trackNum = $(tr).find("td.track_number, td:nth-child(1)").first().text().trim();
          let trackTitle = $(tr).find("span[lang='en'], span[lang='ja-latn'], span.romaji, span.english").first().text().trim();
          if (!trackTitle) {
            trackTitle = $(tr).find("td.track_title, td[class*='title'], td:nth-child(2)").first().text().trim();
          }
          trackTitle = trackTitle.replace(/^\d+[\s.\-_]+/, "").trim();
          if (trackTitle && !trackTitle.toLowerCase().includes("track list") && trackTitle.length >= 2) {
            verifiedTracks.push({
              albumTitle,
              catalog,
              trackNum,
              title: trackTitle,
              source: "VGMdb"
            });
          }
        });
      } else {
        // Grab albums links
        let albums: { title: string; url: string; catalog: string }[] = [];
        
        // Check for product pages first (Series mapping)
        const productUrls: string[] = [];
        $("a[href*='/product/'], a[href*='product/']").each((i, el) => {
          const href = $(el).attr("href") || "";
          if (href && !href.startsWith("http")) {
            productUrls.push(`https://vgmdb.net/${href.replace(/^\//, "")}`);
          } else if (href) {
            productUrls.push(href);
          }
        });

        if (productUrls.length > 0) {
          const productHtml = await fetchWithEncoding(productUrls[0]);
          if (productHtml) {
            const $$ = cheerio.load(productHtml);
            $$("a[href*='/album/'], a[href*='album/']").each((j, el) => {
              const href = $$(el).attr("href") || "";
              const title = $$(el).text().trim();
              const catalog = $$(el).closest("tr").find("span.smalltext").first().text().trim() || "";
              const fullUrl = href.startsWith("http") ? href : `https://vgmdb.net/${href.replace(/^\//, "")}`;
              albums.push({ title, url: fullUrl, catalog });
            });
          }
        }

        // Search results page fallback
        if (albums.length === 0) {
          $("table.equal.albumlist tr").each((i, el) => {
            const titleLink = $(el).find("td:nth-child(3) a");
            const catalog = $(el).find("td:nth-child(2) span").text().trim();
            if (titleLink.length) {
              albums.push({
                title: titleLink.text().trim(),
                url: hrefToFull(titleLink.attr("href") || ""),
                catalog
              });
            }
          });
        }

        function hrefToFull(href: string) {
          return href.startsWith("http") ? href : `https://vgmdb.net/${href.replace(/^\//, "")}`;
        }

        // Pick top 3 relevant albums (Soundtracks/OSTs)
        let relevantAlbums = albums.filter(a => 
          a.title.toLowerCase().includes("soundtrack") || 
          a.title.toLowerCase().includes("ost") || 
          a.title.toLowerCase().includes("original")
        ).slice(0, 3);

        // If no albums specifically mention "soundtrack/ost", fall back to the top 3 albums found!
        if (relevantAlbums.length === 0) {
          relevantAlbums = albums.slice(0, 3);
        }

        for (const album of relevantAlbums) {
          const albumHtml = await fetchWithEncoding(album.url);
          if (!albumHtml) continue;
          const $$ = cheerio.load(albumHtml);
          
          let categoryText = "";
          $$("b, span.label, td").each((_, el) => {
            if ($$(el).text().trim() === "Category") {
              categoryText = $$(el).parent().text().replace("Category", "").trim().toLowerCase();
              if (!categoryText) categoryText = $$(el).next().text().trim().toLowerCase();
            }
          });
          if (categoryText.includes("game") && !categoryText.includes("animation")) {
            console.log(`[VGMdb Verification] Skipping GAME/NON-ANIME album: ${album.title}`);
            continue;
          }
          
          $$("table#tracklist tr.tracklist_row, table#tracklist tr").each((j, tr) => {
            const trackNum = $$(tr).find("td.track_number, td.label, td:nth-child(1)").first().text().trim();
            
            let trackTitle = "";
            $$(tr).find("span[lang='en'], span.romaji, span.english").each((_, span) => {
               if (!trackTitle && $$(span).text().trim()) trackTitle = $$(span).text().trim();
            });
            if (!trackTitle) {
              trackTitle = $$(tr).find("td.track_title, td[class*='title'], td:nth-child(2)").text().replace(/\s+/g, ' ').trim();
            }
            
            trackTitle = trackTitle.replace(/^\d+[\s.\-_]+/, "").trim();
            if (trackTitle && !trackTitle.toLowerCase().includes("track list") && trackTitle.length >= 2) {
              verifiedTracks.push({
                albumTitle: album.title,
                catalog: album.catalog,
                trackNum,
                title: trackTitle,
                source: "VGMdb"
              });
            }
          });
        }
      }

      if (verifiedTracks.length > 0) {
        console.log(`[VGMdb Verification] Verified ${verifiedTracks.length} tracks.`);
        return verifiedTracks;
      }
    }
    return [];
  } catch (err) {
    console.log(`[VGMdb Verification] Offline mode or bypassed search: ${(err as Error).message || err}`);
    return [];
  }
}

app.get("/api/vgmdb-verify", rateLimit(RATE_LIMIT_DEFAULT), async (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: "name is required" });
  const tracks = await scrapeVGMdbTracklists(name);
  res.json({ tracks });
});

app.get("/api/anidb-relations", rateLimit(RATE_LIMIT_DEFAULT), async (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: "name is required" });
  
  const relations = await scrapeAniDBRelations(name);
  res.json({ relations });
});

// Endpoint to use AI (Gemini) safely and correctly determine which database anime shows align to a parent franchise
app.post("/api/verify-franchise", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { parent, candidates } = req.body;
  if (!parent || !Array.isArray(candidates) || candidates.length === 0) {
    return res.json({ matches: [] });
  }

  const performFallback = () => {
    const p = parent.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
    return candidates.filter(c => {
      const child = c.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
      return child.includes(p) || p.includes(child);
    });
  };

  if (globalGeminiQuotaExceeded) {
    return res.json({ matches: performFallback() });
  }

  try {
    // Sanitize all user-influenced inputs before interpolation to prevent
    // prompt injection. Cap candidates at 50 entries / 200 chars each.
    const safeParent = sanitizeForPrompt(parent, 200);
    const safeCandidates = sanitizeArrayForPrompt(candidates, 50, 200);

    const prompt = `You are an anime database expert. I have a main parent anime franchise called "${safeParent}".
I have a list of candidate anime show/part/seasons/movies from my database:
${JSON.stringify(safeCandidates)}

Identify which of these candidate names actually belong to the "${safeParent}" franchise (e.g. sequels, spin-offs, movies, alternative seasons, alternate versions, or different parts).
Exclude any completely unrelated franchises or unrelated shows (for example, "K-ON!" does NOT belong to "JoJo's Bizarre Adventure").

Return a strict JSON object with a single key "matches" which contains an array of the validated candidate strings that belong to the "${safeParent}" franchise. Do not include markdown code block formatting in your response.
Example output: { "matches": ["JoJo's Bizarre Adventure: Stardust Crusaders", "JoJo's Bizarre Adventure: Golden Wind"] }`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matches: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["matches"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    res.json({ matches });
  } catch (error: any) {
    console.error("Franchise verification failed:", error.message);
    if (error.message?.includes("429")) globalGeminiQuotaExceeded = true;
    res.json({ matches: performFallback() });
  }
});


// Endpoint to match a database tracks list with official MyAnimeList shows using Gemini AI
app.post("/api/match-tracks-to-mal", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { parent, malAnimes, databaseTracks } = req.body;
  if (!parent || !Array.isArray(malAnimes) || !Array.isArray(databaseTracks) || databaseTracks.length === 0) {
    return res.json({ assignments: {} });
  }

  const performFallback = () => {
    const assignments: Record<string, string | null> = {};
    for (const t of databaseTracks) {
      let matchedTitle: string | null = null;
      const tNorm = t.animeName.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
      for (const mal of malAnimes) {
        const mNorm = mal.title.toLowerCase().replace(/[:\-|~(|)].*$/, '').trim();
        if (tNorm.includes(mNorm) || mNorm.includes(tNorm)) {
          matchedTitle = mal.title;
          break;
        }
      }
      assignments[t.id] = matchedTitle;
    }
    return assignments;
  };

  if (globalGeminiQuotaExceeded) {
    return res.json({ assignments: performFallback() });
  }

  try {
    // Sanitize user-influenced inputs.
    const safeParent = sanitizeForPrompt(parent, 200);
    const safeMalAnimes = sanitizeArrayForPrompt(
      malAnimes.map((a: any) => ({ mal_id: a.mal_id, title: a.title, type: a.type })),
      50, 200
    );
    const safeDbTracks = sanitizeArrayForPrompt(
      databaseTracks.map((t: any) => ({ id: t.id, title: t.title, artist: t.artist, dbAnimeName: t.animeName, type: t.type })),
      100, 200
    );

    const prompt = `You are an expert anime metadata mapping assistant.
I have a parent franchise search term called "${safeParent}".
Here is a list of official anime records / seasons / parts for this franchise from MyAnimeList:
${JSON.stringify(safeMalAnimes)}

Here is a list of local database track entries we have:
${JSON.stringify(safeDbTracks)}

Your task is to assign each database track ID to the most appropriate official MyAnimeList "title" string from the records list.
Rule 1: If a database track belongs to a completely different franchise or is unrelated (e.g., if a track labeled "K-ON!" is present in a "JoJo's Bizarre Adventure" search), you MUST map its value to null.
Rule 2: Match sequels, prequels, spin-offs, movies, alternative versions, or different seasons accurately.
Rule 3: Return a strict JSON object containing a single key "assignments" which maps each track ID string to its matched MAL title string or null. Do not use markdown backticks or formatting in your raw response.

Example output format:
{
  "assignments": {
    "track_1_id": "JoJo's Bizarre Adventure",
    "track_2_id": "JoJo's Bizarre Adventure: Stardust Crusaders",
    "track_3_id": null
  }
}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            assignments: {
              type: Type.OBJECT,
              additionalProperties: { type: Type.STRING }
            }
          },
          required: ["assignments"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const assignments = parsed.assignments || {};
    res.json({ assignments });
  } catch (error: any) {
    console.error("Track-to-MAL matching failed:", error.message);
    if (error.message?.includes("429")) globalGeminiQuotaExceeded = true;
    res.json({ assignments: performFallback() });
  }
});


// Endpoint to filter MyAnimeList search results to only keep those truly related to the parent franchise/universe
app.post("/api/filter-franchise", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { mainAnime, candidates } = req.body;
  if (!mainAnime || !Array.isArray(candidates) || candidates.length === 0) {
    return res.json({ relatedMalIds: [] });
  }

  if (globalGeminiQuotaExceeded) {
    return res.json({ relatedMalIds: candidates.map(c => c.mal_id) });
  }

  try {
    const safeMainAnime = sanitizeForPrompt(mainAnime, 200);
    const safeCandidates = sanitizeArrayForPrompt(
      candidates.map((c: any) => ({ mal_id: c.mal_id, title: c.title, type: c.type, synopsis: c.synopsis ? c.synopsis.slice(0, 120) : '' })),
      50, 200
    );

    const prompt = `You are an expert anime franchise grouping assistant.
Given a main anime series reference title: "${safeMainAnime}"
And a list of search result candidates retrieved from MyAnimeList:
${JSON.stringify(safeCandidates)}

Your task is to identify and filter the candidates list. Output ONLY the candidates that belong to the SAME franchise/IP, direct series lineage, or shared fictional universe (including alternate versions, spin-offs, sequels, prequels, movies, OVAs, or specials of this exact property/universe).
CRITICAL RULE: You must EXCLUDE completely unrelated anime series that just happen to share a common keyword (for example, if the reference is "ORB" (music video by nano.RIPE), exclude "Mighty Orbots", "Lucky Orb feat. Hatsune Miku", or "Orb: On the Movements of the Earth" as they are completely different, unrelated universes and creations. If the reference is "Perfect Blue", exclude "Blue Lock" or "Blue Reflection").

Return a strict JSON object with a single key "relatedMalIds" containing an array of number mal_ids that are genuinely related franchise components or the main show itself. Do not include markdown block formatting, codeblocks, backticks, or any comments outside the valid JSON.
Example output format:
{
  "relatedMalIds": [12345, 67890]
}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            relatedMalIds: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER }
            }
          },
          required: ["relatedMalIds"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const relatedMalIds = parsed.relatedMalIds || [];
    res.json({ relatedMalIds });
  } catch (err: any) {
    console.error("Failed to filter franchise:", err.message);
    if (err.message?.includes("429")) globalGeminiQuotaExceeded = true;
    // Keep it robust: if Gemini fails, return all candidates so nothing is broken
    res.json({ relatedMalIds: candidates.map(c => c.mal_id) });
  }
});


// Endpoint to align a group of tracks of a specific anime to a single canonical MyAnimeList entry
app.post("/api/align-single-anime", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { originalAnimeName, tracks, malCandidates } = req.body;
  if (!originalAnimeName || !Array.isArray(malCandidates) || malCandidates.length === 0) {
    return res.json({ alignedTitle: null });
  }

  if (globalGeminiQuotaExceeded) {
    const target = originalAnimeName.toLowerCase();
    const match = malCandidates.find(c => c.title.toLowerCase().includes(target) || target.includes(c.title.toLowerCase())) || malCandidates[0];
    return res.json({ alignedTitle: match ? match.title : null });
  }

  try {
    const safeOrigName = sanitizeForPrompt(originalAnimeName, 200);
    const safeTracks = sanitizeArrayForPrompt(tracks || [], 100, 200);
    const safeMalCandidates = sanitizeArrayForPrompt(
      malCandidates.map((c: any) => ({ title: c.title, mal_id: c.mal_id, type: c.type, score: c.score })),
      50, 200
    );

    const prompt = `You are an expert anime database librarian.
I have a list of songs belonging to an anime entry currently labeled as "${safeOrigName}" in my local database.
Here are the songs:
${JSON.stringify(safeTracks)}

Here is a list of official candidate anime records retrieved from MyAnimeList for this term:
${JSON.stringify(safeMalCandidates)}

Your task is to identify and select the single most accurate, canonical official title from the MyAnimeList candidates list that these songs belong to.
If these songs or the local name do not match any candidates with high confidence, set "alignedTitle" to null.
Return a strict JSON object with a single key "alignedTitle" matching one of the official titles exactly. Do not include markdown formatting or backticks.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alignedTitle: { type: Type.STRING, nullable: true }
          },
          required: ["alignedTitle"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json({ alignedTitle: parsed.alignedTitle || null });
  } catch (error: any) {
    console.error("AI Alignment failed for:", originalAnimeName, error.message);
    if (error.message?.includes("429")) globalGeminiQuotaExceeded = true;
    // Safe fallback matching
    const target = originalAnimeName.toLowerCase();
    const match = malCandidates.find(c => c.title.toLowerCase().includes(target) || target.includes(c.title.toLowerCase())) || malCandidates[0];
    res.json({ alignedTitle: match ? match.title : null });
  }
});


// Endpoint to align multiple anime entries to canonical MyAnimeList releases together in a single API request
app.post("/api/align-batch-anime", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { batch } = req.body;
  if (!Array.isArray(batch) || batch.length === 0) {
    return res.json({ alignments: [] });
  }

  if (globalGeminiQuotaExceeded) {
    const fallbackAlignments: any[] = [];
    batch.forEach(item => {
      const orig = item.originalAnimeName;
      const candidates = item.malCandidates || [];
      const target = orig.toLowerCase();
      const match = candidates.find(c => c.title.toLowerCase().includes(target) || target.includes(c.title.toLowerCase())) || candidates[0];
      
      const tracks = item.tracks || [];
      tracks.forEach(track => {
        fallbackAlignments.push({
          trackId: track.id,
          masterFranchiseName: orig,
          alignedPart: match ? match.title : null
        });
      });
    });
    return res.json({ alignments: fallbackAlignments });
  }

  try {
    // Cap batch at 25 groups (each group is one Gemini input row).
    const safeBatch = Array.isArray(batch) ? batch.slice(0, 25) : [];
    const formattedGroups = safeBatch.map((item: any, idx: number) => {
      const candidates = Array.isArray(item.malCandidates) ? item.malCandidates.slice(0, 10) : [];
      const safeOrigName = sanitizeForPrompt(item.originalAnimeName, 200);
      const safeTracks = sanitizeArrayForPrompt(item.tracks || [], 20, 200);
      const safeCandidates = sanitizeArrayForPrompt(
        candidates.map((c: any) => ({ title: c.title, mal_id: c.mal_id, type: c.type, score: c.score })),
        10, 200
      );
      return `Group #${idx + 1}:
Local Anime Name: "${safeOrigName}"
Local Songs: ${JSON.stringify(safeTracks)}
MyAnimeList Candidates: ${JSON.stringify(safeCandidates)}`;
    }).join("\n\n---\n\n");

    const prompt = `You are an expert anime database librarian.
I have a list of anime groups. For each group, I provided the local overarching franchise name ("originalAnimeName"), its associated music tracks, and a list of official candidate anime records retrieved from MyAnimeList.

Your task is to place the tracks onto the RIGHT part of the franchise. Because one master anime franchise holds several parts (like seasons or movies), you must specify BOTH the overall master franchise name, AND the specific canonical MAL part name for each individual track.
For example if tracks are from different seasons, map each track ID to the specific season it belongs to from the candidates list.

Here are the groups that require alignment:
${formattedGroups}

Your response must be a strict JSON object with a single key "alignments".
The "alignments" key must contain an array of objects representing EVERY individual track from the input groups. Each object must have exactly these keys:
- "trackId" (string): matching the input track id exactly
- "masterFranchiseName" (string): The simplest, overarching umbrella franchise name (e.g., "Jujutsu Kaisen"). Often very close to the originalAnimeName.
- "alignedPart" (string or null): the EXACT matching title string from the MyAnimeList candidates representing the specific season/movie this track belongs to (e.g., "Jujutsu Kaisen 2nd Season" or null if no confident match).
Do NOT include markdown block formatting, codeblocks, or any comments outside the valid JSON output.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alignments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  trackId: { type: Type.STRING },
                  masterFranchiseName: { type: Type.STRING },
                  alignedPart: { type: Type.STRING, nullable: true }
                },
                required: ["trackId", "masterFranchiseName", "alignedPart"]
              }
            }
          },
          required: ["alignments"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json({ alignments: parsed.alignments || [] });
  } catch (error: any) {
    console.error("AI Batch Alignment failed:", error.message);
    if (error.message?.includes("429")) globalGeminiQuotaExceeded = true;
    // Safe standard fallback for each group in the input
    const fallbackAlignments: any[] = [];
    batch.forEach(item => {
      const orig = item.originalAnimeName;
      const candidates = item.malCandidates || [];
      const target = orig.toLowerCase();
      const match = candidates.find(c => c.title.toLowerCase().includes(target) || target.includes(c.title.toLowerCase())) || candidates[0];
      
      const tracks = item.tracks || [];
      tracks.forEach(track => {
        fallbackAlignments.push({
          trackId: track.id,
          masterFranchiseName: orig,
          alignedPart: match ? match.title : null
        });
      });
    });
    res.json({ alignments: fallbackAlignments, error: error.message });
  }
});


// Endpoint to auto-tag a track using song-oriented tagging (Last.fm + keyword analysis).
// Tags are based on the SONG itself (genre, mood, tempo, vocal style) — NOT anime metadata.
app.post("/api/auto-tag", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { title, artist, animeName, type } = req.body;
  if (!title || !animeName) {
    return res.status(400).json({ error: "title and animeName are required." });
  }

  try {
    const { generateSongTags } = await import('./src/utils/songTags');
    const tags = await generateSongTags({ title, artist: artist || '', animeName, type: type || 'OP' });
    res.json({ tags });
  } catch (err: any) {
    console.error('[/api/auto-tag] error:', err.message);
    // Fallback to basic keyword matching if the new system fails
    const combined = `${title} ${animeName}`.toLowerCase();
    const tags: string[] = [];
    if (combined.includes("battle") || combined.includes("fight")) tags.push("Epic", "Intense");
    if (combined.includes("love") || combined.includes("romance")) tags.push("Romantic");
    if (combined.includes("sad") || combined.includes("tears")) tags.push("Sad", "Emotional");
    if (tags.length === 0) tags.push("Hype");
    res.json({ tags });
  }
});

// Endpoint to use AI to find semantic duplicates in a batch of tracks
app.post("/api/smart-sweep-duplicates", rateLimit(RATE_LIMIT_AI), requireAdmin, async (req, res) => {
  const { tracks } = req.body;
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: "tracks array is required" });
  }

  // If we've already hit quota today, skip the AI attempt to avoid the 53s+ wait for the error
  if (!globalGeminiQuotaExceeded) {
    try {
      const prompt = `You are a data deduplication AI for an anime music database. 
I have a list of tracks. Identify tracks that are semantic duplicates of each other. 
Crucially, look for duplicates even if they are listed under alternate, short, or franchise-variant anime names. For example:
- If one track has anime "JoJo" and another track is the same song under "JoJo's Bizarre Adventure Part 5" or "JoJo's Bizarre Adventure: Golden Wind", these are DUPLICATES of the same theme.
- Similarly, same song with same artist but different aliases (e.g. OP 1 vs Opening 1, TV Size vs Full).

For each set of duplicates, KEEP exactly ONE entry (prefer the one with the cleaner/more complete title, more specific anime name, and existing valid youtubeId) and RETURN the IDs of the OTHERS to be deleted.

Input dataset:
${JSON.stringify(sanitizeArrayForPrompt(tracks.map((t: any) => ({
  id: t.id,
  animeName: t.animeName,
  title: t.title,
  artist: t.artist,
  type: t.type,
  youtubeId: t.youtubeId
})), 500, 200), null, 2)}

Return a strict JSON object containing an array "duplicateIdsToDelete".`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
           responseMimeType: "application/json",
           responseSchema: {
              type: Type.OBJECT,
              properties: {
                 duplicateIdsToDelete: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                 }
              },
              required: ["duplicateIdsToDelete"]
           }
        }
      });

      const parsed = JSON.parse(response.text || "{}");
      const ids = Array.isArray(parsed.duplicateIdsToDelete) ? parsed.duplicateIdsToDelete : [];
      return res.json({ duplicateIdsToDelete: ids });
    } catch (error: any) {
      console.error("Smart sweep AI failed (Quota or Error):", error.message);
      if (error.message?.includes("429") || error.message?.includes("quota")) {
        globalGeminiQuotaExceeded = true;
        // Optionally reset after an hour
        setTimeout(() => { globalGeminiQuotaExceeded = false; }, 3600000);
      }
    }
  }

  // HIGH-FIDELITY OPTIMIZED FALLBACK (O(N) grouping + O(G^2) local comparisons where G is group size)
  try {
    const duplicateIdsToDelete: string[] = [];
    const visited = new Set<string>();

    // 1. Normalization Utils
    const norm = (s: string) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    const cleanTitle = (s: string) => {
      return (s || "").toLowerCase()
        .replace(/\s*\(.*?\)/g, "")
        .replace(/\s*\[.*?\]/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
    };

    // 2. Pre-calculate Metadata for EVERY track once
    const processedTracks = tracks.map(t => ({
      ...t,
      normAnime: norm(getMainAnimeName(t.animeName)),
      cleanTitle: cleanTitle(t.title),
      normArtist: norm(t.artist),
      normType: (t.type || "").toLowerCase().substring(0, 2)
    }));

    // 3. Group by Title + Type (Most duplicates share these)
    const groups = new Map<string, typeof processedTracks>();
    for (const t of processedTracks) {
      const key = `${t.cleanTitle}_${t.normType}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    // 4. Compare within groups (Much faster than full O(N^2))
    for (const group of groups.values()) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        const trackA = group[i];
        if (visited.has(trackA.id)) continue;

        for (let j = i + 1; j < group.length; j++) {
          const trackB = group[j];
          if (visited.has(trackB.id)) continue;

          // Anime Match Check (Substring or similarity)
          const animeMatch = 
            trackA.normAnime && trackB.normAnime && 
            (trackA.normAnime.includes(trackB.normAnime) || trackB.normAnime.includes(trackA.normAnime));

          // Artist Match Check (Relaxed)
          const isArtistVague = (art: string) => !art || art.includes("unknown") || art.includes("various");
          const artistMatch = 
            isArtistVague(trackA.normArtist) || 
            isArtistVague(trackB.normArtist) || 
            (trackA.normArtist.includes(trackB.normArtist) || trackB.normArtist.includes(trackA.normArtist));

          if (animeMatch && artistMatch) {
            // Duplicate detected. Rank quality to keep the best one.
            const score = (t: any) => {
              let s = 0;
              // Youtube integrity score
              if (t.youtubeId && t.youtubeId !== "Fve_l8I0Ayk" && t.youtubeId.length > 5) s += 1000;
              // Metadata completeness
              if ((t.animePart || "").length > 5) s += 50; 
              if (t.tags && t.tags.length > 0) s += 20;
              if (t.customImageUrl && !t.customImageUrl.includes("ytimg")) s += 100;
              // String length/clarity (longer titles usually have more context)
              s += (t.title || "").length + (t.animeName || "").length;
              return s;
            };

            const keepA = score(trackA) >= score(trackB);
            const toDelete = keepA ? trackB.id : trackA.id;
            
            duplicateIdsToDelete.push(toDelete);
            visited.add(toDelete);

            if (!keepA) break; // trackA is gone, stop inner loop for it
          }
        }
      }
    }

    console.log(`[Sweep Fallback] Identified ${duplicateIdsToDelete.length} duplicates using Optimized Search Algorithm.`);
    res.json({ 
      duplicateIdsToDelete, 
      note: globalGeminiQuotaExceeded ? "Deduplication performed using optimized engine (AI Quota Exhausted)." : "Deduplication complete." 
    });
  } catch (fallbackError: any) {
    console.error("Optimized sweep failure:", fallbackError);
    res.status(500).json({ error: "Duplicate sweep engine failure" });
  }
});

// Endpoint to find anime themes using Gemini 3.5 matched against live YouTube IDs
app.post("/api/ai-themes", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { animeName, existingYtIds } = req.body;
  if (!animeName || typeof animeName !== 'string' || !animeName.trim()) {
    return res.status(400).json({ error: "animeName is required and must be a non-empty string." });
  }

  // Keep a set of all excluded IDs (client existing + ones we resolve in this batch)
  const excludedSet = new Set<string>(Array.isArray(existingYtIds) ? existingYtIds : []);
  let baseThemes: any[] = [];
  let resolvedAnimeName = animeName.trim();

  try {
    // Stage 0: Check cache first to avoid ANY API calls
    const cacheKey = resolvedAnimeName.toLowerCase().trim();
    if (themeCache.has(cacheKey)) {
      console.log(`[Smart Match] Serving ${resolvedAnimeName} from server-side theme cache.`);
      return res.json(themeCache.get(cacheKey));
    }

    // Stage 1: Try Jikan Free API first to avoid AI Quota completely
    try {
      const variants = getSearchVariants(resolvedAnimeName);
      for (const query of variants.slice(0, 2)) {
        const searchRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.data && searchData.data.length > 0) {
            const mal_id = searchData.data[0].mal_id;
            resolvedAnimeName = searchData.data[0].title || resolvedAnimeName;
            const jikanThemes = await fetchThemesFromJikan(mal_id, resolvedAnimeName);
            if (jikanThemes && jikanThemes.length > 0) {
              baseThemes = jikanThemes;
              console.log(`[Smart Match] Jikan API successfully found ${jikanThemes.length} themes for ${resolvedAnimeName}.`);
              break;
            }
          }
        }
        if (variants.length > 1) await delay(500);
      }
    } catch (e) {
      console.warn("Jikan theme fast-path failed:", e);
    }

    // Stage 1.5: Try AnimeThemes.moe Free API as our secondary high-fidelity fallback to preserve AI Quotas
    if (baseThemes.length === 0) {
      try {
        console.log(`[Smart Match] Jikan has no themes; trying AnimeThemes.moe for ${resolvedAnimeName}...`);
        const moeThemes = await fetchThemesFromAnimeThemesMoe(resolvedAnimeName);
        if (moeThemes && moeThemes.length > 0) {
          baseThemes = moeThemes;
          console.log(`[Smart Match] AnimeThemes.moe successfully fetched ${moeThemes.length} themes for ${resolvedAnimeName}.`);
        }
      } catch (e) {
        console.warn("AnimeThemes.moe fallback failed:", e);
      }
    }

    // Stage 2: Fallback to official scrapers (Anison, AniDB) instead of Gemini AI
    if (baseThemes.length === 0) {
      console.log(`[Smart Match] Jikan and AnimeThemes failed; falling back to Anison scraping for ${resolvedAnimeName}...`);
      const anisonThemes = await scrapeAnison(resolvedAnimeName);
      if (anisonThemes && anisonThemes.length > 0) {
        baseThemes = anisonThemes;
        console.log(`[Smart Match] Anison scraper found ${anisonThemes.length} themes.`);
      }
    }

    if (baseThemes.length === 0) {
      console.log(`[Smart Match] Anison failed; trying AniDB scraper for ${resolvedAnimeName}...`);
      const anidbThemes = await scrapeAniDB(resolvedAnimeName);
      if (anidbThemes && anidbThemes.length > 0) {
        baseThemes = anidbThemes;
        console.log(`[Smart Match] AniDB scraper found ${anidbThemes.length} themes.`);
      }
    }

    // Stage 3: If ALL other steps failed, synthesize template
    if (baseThemes.length === 0) {
      console.log(`[Smart Match] All APIs and AI exhausted. Synthesizing elegant template for "${resolvedAnimeName}".`);
      baseThemes = getThemeTemplates(resolvedAnimeName);
    }

    // Dynamic Resolution: Scan YouTube live for each theme to retrieve 100% active, current YouTube video IDs
    const resolvedThemes = [];
    
    // Process sequentially (or in small batches) to correctly accumulate duplicate videoId prevention locks
    for (const theme of baseThemes.slice(0, 10)) {
      const activeYtId = await resolveYoutubeId(
        theme.title,
        theme.artist || "Unknown",
        resolvedAnimeName,
        theme.type,
        Array.from(excludedSet)
      );

      const finalId = activeYtId || "Fve_l8I0Ayk"; // Fallback to safe ID if search fails
      
      // If we found a unique active ID, exclude it from subsequent matches in the same query
      if (activeYtId) {
        excludedSet.add(activeYtId);
      }

      resolvedThemes.push({
        title: theme.title,
        artist: theme.artist || "Unknown Performer",
        type: theme.type === "OP" || theme.type === "ED" || theme.type === "OST" ? theme.type : "OP",
        youtubeId: finalId
      });
    }

    // Cache the resolved result for this session
    themeCache.set(cacheKey, resolvedThemes);
    res.json(resolvedThemes);
  } catch (error: any) {
    console.error("Theme search/resolve error:", error);
    res.status(500).json({ error: error.message || "Failed to query & verify themes" });
  }
});

// Endpoint to verify if a YouTube video is still alive or deleted
app.get("/api/verify-video", rateLimit(RATE_LIMIT_DEFAULT), async (req, res) => {
  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`;
    const checkRes = await fetch(url, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
       }
    });

    if (checkRes.ok) {
      res.json({ alive: true });
    } else {
      res.json({ alive: false, status: checkRes.status });
    }
  } catch (err: any) {
    res.json({ alive: false, error: err.message });
  }
});

// Endpoint to verify multiple YouTube videos in a single batch call (optimized)
app.post("/api/verify-batch", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: "ids must be an array of youtube video keys" });
  }

  try {
    const results: { [key: string]: boolean } = {};
    
    // Process up to 40 keys in parallel on the server to make verification lightning fast
    await Promise.all(ids.slice(0, 40).map(async (id) => {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`;
      try {
        const checkRes = await fetch(url, {
           headers: {
             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
           }
        });
        results[id] = checkRes.ok;
      } catch (err) {
        results[id] = false;
      }
    }));

    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to resolve multiple track links in a unified batch request (optimized)
app.post("/api/resolve-batch", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { tracks, existingYtIds } = req.body;
  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ error: "tracks must be an array of track items" });
  }

  try {
    const listExcluded = Array.isArray(existingYtIds) ? [...existingYtIds] : [];
    const resolved: { [trackId: string]: string } = {};

    // Execute search resolving tasks in parallel up to 10 at a time now that server logic is tuned
    const batchSize = 10;
    for (let i = 0; i < tracks.length; i += batchSize) {
      const chunk = tracks.slice(i, i + batchSize);
      await Promise.all(chunk.map(async (t: any) => {
        if (!t.title || !t.animeName) return;
        const liveId = await resolveYoutubeId(t.title, t.artist || "Unknown", t.animeName, t.type || "OP", listExcluded);
        if (liveId) {
          resolved[t.id] = liveId;
          listExcluded.push(liveId);
        }
      }));
      // Small break between chunks to be kind to YT search
      if (tracks.length > batchSize) await delay(400);
    }

    res.json({ resolved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed bulk resolution" });
  }
});

// Endpoint to smart-resolve official track art covers using iTunes and Jikan MAL APIs (failsafe & cached)
app.post("/api/resolve-track-images-batch", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { tracks, overwrite } = req.body;
  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ error: "tracks must be an array of tracks" });
  }

  try {
    const resolvedImages: { [trackId: string]: string } = {};

    // For rate limiting, process tracks in chunks
    const chunkSize = 5;
    for (let i = 0; i < tracks.length; i += chunkSize) {
      const chunk = tracks.slice(i, i + chunkSize);

      await Promise.all(chunk.map(async (track: any) => {
        // Skip if track already has customized image, unless overwrite is true (user explicitly requested replacement)
        const inlineCover = track.customImageUrl || "";
        const hasPremiumCover = inlineCover && !inlineCover.includes("youtube.com") && !inlineCover.includes("ytimg.com");
        if (hasPremiumCover && !overwrite) {
          return;
        }

        const title = track.title || "";
        const artist = track.artist || "";
        const animeName = track.animeName || "";
        const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, "").trim();
        const cleanArtist = artist === "Unknown" || artist === "Various" ? "" : artist.replace(/\(.*?\)|\[.*?\]/g, "").trim();

        // 1. Try iTunes Search API for highres album cover art (most accurate for theme song artwork)
        try {
          const searchQuery = `${cleanArtist} ${cleanTitle}`.trim() || `${animeName} ${cleanTitle}`.trim();
          const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&limit=1&entity=song`;

          const itunesRes = await fetch(itunesUrl, {
            headers: { 'User-Agent': 'aistudio-build-songs' }
          });

          if (itunesRes.ok) {
            const data = await itunesRes.json();
            if (data.results && data.results.length > 0) {
              const art100 = data.results[0].artworkUrl100;
              if (art100) {
                // Convert low-res 100x100 to beautiful deep HD highres 600x600 format!
                const highres = art100.replace("100x100bb.jpg", "600x600bb.jpg").replace("100x100", "600x600");
                resolvedImages[track.id] = highres;
                console.log(`[Smart Cover] iTunes matched "${track.title}" artwork successfully: ${highres}`);
                return;
              }
            }
          }
        } catch (itErr) {
          console.warn(`iTunes artwork fetch failed for "${track.title}":`, itErr);
        }

        // 2. Try Jikan Anime Cover as the second-best premium fallback
        try {
          const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeName)}&limit=1`;
          const jikanRes = await fetch(searchUrl, {
            headers: { 'User-Agent': 'aistudio-build-anime' }
          });

          if (jikanRes.ok) {
            const data = await jikanRes.json();
            if (data.data && data.data.length > 0) {
              const imageObj = data.data[0].images;
              const imgUrl = imageObj?.webp?.large_image_url || imageObj?.jpg?.large_image_url || imageObj?.jpg?.image_url;
              if (imgUrl) {
                resolvedImages[track.id] = imgUrl;
                console.log(`[Smart Cover] Jikan MAL anime matched "${animeName}" background cover artwork: ${imgUrl}`);
                return;
              }
            }
          }
        } catch (jikanErr) {
          console.warn(`Jikan MAL fetch failed for "${animeName}":`, jikanErr);
        }

        // 3. Fallback to youtube maxresdefault image
        if (track.youtubeId) {
          resolvedImages[track.id] = `https://img.youtube.com/vi/${track.youtubeId}/maxresdefault.jpg`;
        }
      }));

      // Throttle slightly to respect iTunes / Jikan rate limits (3 requests per second)
      if (i + chunkSize < tracks.length) {
        await delay(350);
      }
    }

    res.json({ resolvedImages });
  } catch (err: any) {
    console.error("Smart image resolution error:", err);
    res.status(500).json({ error: err.message || "Failed image batch resolution loop" });
  }
});

// Endpoint to resolve / auto-verify a single track's YouTube ID live
app.post("/api/resolve-single", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { title, artist, animeName, type, existingYtIds } = req.body;
  if (!title || !animeName) {
    return res.status(400).json({ error: "title and animeName are required." });
  }

  try {
    const listExcluded = Array.isArray(existingYtIds) ? existingYtIds : [];
    const liveId = await resolveYoutubeId(title, artist || 'Unknown', animeName, type || 'OP', listExcluded);
    
    if (!liveId) {
      return res.status(404).json({ error: "Could not locate a working YouTube video ID for this song." });
    }
    res.json({ youtubeId: liveId });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to locate live track" });
  }
});

// Endpoint to search for anime metadata via Jikan API (V4)
app.get("/api/anime-search", rateLimit(RATE_LIMIT_DEFAULT), async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: "q is required" });

  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to fetch anime theme list from Jikan API (V4)
app.get("/api/anime-themes-ext", rateLimit(RATE_LIMIT_DEFAULT), async (req, res) => {
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime/${id}/themes`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Normalizes a track title for intelligent similarity comparison and merging.
 * Isolates TV Sizes, Instrumentals, and Remixes from generic duplicates.
 */
function normalizeTitle(title: string): string {
  if (!title) return "";
  let t = title.toLowerCase();
  
  // Capture specific characteristics
  const isTvSize = t.includes("tv size") || t.includes("tv-size") || t.includes("tv edit");
  const isInstrumental = t.includes("instrumental") || t.includes("off vocal") || t.includes("karaoke") || t.includes("inst");
  const isRemix = t.includes("remix") || t.includes("arrange");
  
  // Scrub typical wrappers, bracketed notes, and special characters
  t = t
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/~.*?~/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .trim();

  // Append signatures back to prevent collapsing separate versions!
  if (isTvSize) t += "_tv";
  if (isInstrumental) t += "_inst";
  if (isRemix) t += "_remix";
  
  return t;
}

/**
 * Consolidates, aligns, and merges track entries from multiple databases.
 * Retains high-fidelity names, coordinates vocalists/composers, and prevents duplicates.
 */
function alignAndMergeTracks(listA: any[], listB: any[]): any[] {
  const merged: any[] = [];
  const mapA = new Map<string, any>();

  // Map first list by normalized title
  for (const item of listA) {
    const key = normalizeTitle(item.title);
    if (key) {
      mapA.set(key, item);
    } else {
      merged.push(item);
    }
  }

  // Iterate over second list and align / merge
  for (const itemB of listB) {
    const keyB = normalizeTitle(itemB.title);
    if (!keyB) {
      merged.push(itemB);
      continue;
    }

    if (mapA.has(keyB)) {
      const itemA = mapA.get(keyB)!;
      
      // Keep shorter (typically cleaner/official) title
      const title = itemA.title.length <= itemB.title.length ? itemA.title : itemB.title;
      
      // Retain opening/ending classifications
      const type = (itemA.type === "OP" || itemA.type === "ED") ? itemA.type : 
                   (itemB.type === "OP" || itemB.type === "ED") ? itemB.type : "OST";

      // Combine performer and composer credits
      let artist = itemA.artist || "Unknown";
      if (!artist || artist === "Various" || artist === "Various Artists" || artist === "Unknown") {
        artist = itemB.artist || "Unknown";
      } else if (itemB.artist && itemB.artist !== "Various" && itemB.artist !== "Various Artists" && itemB.artist !== "Unknown" && itemB.artist !== artist) {
        const lowerA = artist.toLowerCase();
        const lowerB = itemB.artist.toLowerCase();
        if (!lowerA.includes(lowerB) && !lowerB.includes(lowerA)) {
          // If we have both, format beautifully
          if (itemA.tags?.includes("VGMdb") || itemB.tags?.includes("VGMdb")) {
            const composer = itemA.tags?.includes("VGMdb") ? itemA.artist : itemB.artist;
            const singer = itemA.tags?.includes("VGMdb") ? itemB.artist : itemA.artist;
            artist = `${singer} (composed by ${composer})`;
          } else {
            artist = `${artist} / ${itemB.artist}`;
          }
        }
      }

      // Merge tags
      const tags = Array.from(new Set([...(itemA.tags || []), ...(itemB.tags || []), "Merged"]));

      mapA.set(keyB, {
        ...itemA,
        title,
        artist,
        type,
        tags,
        animeName: itemA.animeName || itemB.animeName
      });
    } else {
      mapA.set(keyB, itemB);
    }
  }

  merged.push(...mapA.values());
  return merged;
}

/**
 * Fetches soundtrack metadata from VGMdb. 
 * Queries vgmdb.info/search for official albums, scores them for original OST/BGM relevance,
 * scrapes their detailed tracklists, and falls back to Google Gemini AI curation on error or empty results.
 */
async function scrapeVGMdb(animeName: string): Promise<any[]> {
  try {
    const variants = getSearchVariants(animeName);
    const results: any[] = [];
    const seenTrackNames = new Set<string>();

    for (const query of variants.slice(0, 2)) {
      console.log(`[VGMdb HTML Scraper] Searching directly on vgmdb.net for: "${query}"`);
      const searchUrl = `https://vgmdb.net/search?q=${encodeURIComponent(query)}`;
      const html = await fetchWithEncoding(searchUrl);
      if (!html) continue;

      const $ = cheerio.load(html);

      // 1. Direct Redirection Check: If we landed directly on an album page
      const isAlbumPage = $("table#tracklist").length > 0;
      let albumUrls: string[] = [];

      if (isAlbumPage) {
        albumUrls.push(searchUrl);
      } else {
        // 2. Product Search Check (Products map to Anime Series!)
        const productUrls: string[] = [];
        $("a[href*='/product/'], a[href*='product/']").each((i, el) => {
          const href = $(el).attr("href") || "";
          if (href && !href.startsWith("http")) {
            productUrls.push(`https://vgmdb.net/${href.replace(/^\//, "")}`);
          } else if (href) {
            productUrls.push(href);
          }
        });

        // Fetch Product page to index its official albums
        if (productUrls.length > 0) {
          const productUrl = productUrls[0];
          console.log(`[VGMdb HTML Scraper] Indexing master franchise albums from: ${productUrl}`);
          const productHtml = await fetchWithEncoding(productUrl);
          if (productHtml) {
            const $$ = cheerio.load(productHtml);
            $$("a[href*='/album/'], a[href*='album/']").each((j, el) => {
              const href = $$(el).attr("href") || "";
              const title = $$(el).text().trim().toLowerCase();
              let fullUrl = href.startsWith("http") ? href : `https://vgmdb.net/${href.replace(/^\//, "")}`;
              
              const isOst = title.includes("soundtrack") || title.includes("ost") || title.includes("original") || title.includes("bgm") || title.includes("music") || title.includes("score");
              const isFluffy = title.includes("cover") || title.includes("tribute") || title.includes("piano") || title.includes("arrange") || title.includes("remix");
              
              if (isOst && !isFluffy && !albumUrls.includes(fullUrl)) {
                albumUrls.push(fullUrl);
              }
            });
          }
        }

        // 3. Fallback: Parse Album list on search results page directly
        if (albumUrls.length === 0) {
          $("table.equal.albumlist tr, a[href*='/album/'], a[href*='album/']").each((i, el) => {
            const anchor = $(el).is("a") ? $(el) : $(el).find("a[href*='album']");
            const href = anchor.attr("href") || "";
            const title = anchor.text().trim().toLowerCase();
            if (href && (title.includes("soundtrack") || title.includes("ost") || title.includes("original") || title.includes("bgm"))) {
              let fullUrl = href.startsWith("http") ? href : `https://vgmdb.net/${href.replace(/^\//, "")}`;
              if (!albumUrls.includes(fullUrl)) {
                albumUrls.push(fullUrl);
              }
            }
          });
        }
      }

      // 4. Crawl top album pages to extract the full detailed tracklists
      const topAlbums = albumUrls.slice(0, 4);
      console.log(`[VGMdb HTML Scraper] Scraping tracks from ${topAlbums.length} albums...`);

      for (const albumUrl of topAlbums) {
        try {
          const albumHtml = await fetchWithEncoding(albumUrl);
          if (!albumHtml) continue;

          const $$ = cheerio.load(albumHtml);
          
          let categoryText = "";
          $$("b, span.label, td").each((_, el) => {
            if ($$(el).text().trim() === "Category") {
              categoryText = $$(el).parent().text().replace("Category", "").trim().toLowerCase();
              if (!categoryText) categoryText = $$(el).next().text().trim().toLowerCase();
            }
          });
          if (categoryText.includes("game") && !categoryText.includes("animation")) {
            console.log(`[VGMdb Scraper] Skipping GAME/NON-ANIME album: ${albumUrl}`);
            continue;
          }

          let composer = "Various Artists";
          $$("table tr").each((x, tr) => {
            const label = $$(tr).find("span.smalltext").first().text().trim().toLowerCase();
            if (label.includes("composed by") || label.includes("credited to")) {
              const artists = $$(tr).find("td:nth-child(2) a").map((y, el) => $$(el).text().trim()).get();
              if (artists.length > 0) {
                composer = artists.join(", ");
              }
            }
          });

          $$("table#tracklist tr.tracklist_row, table#tracklist tr").each((j, tr) => {
            let trackTitle = "";
            $$(tr).find("span[lang='en'], span.romaji, span.english").each((_, span) => {
               if (!trackTitle && $$(span).text().trim()) trackTitle = $$(span).text().trim();
            });
            if (!trackTitle) {
              trackTitle = $$(tr).find("td.track_title, td[class*='title'], td:nth-child(2)").text().replace(/\s+/g, ' ').trim();
            }
            
            trackTitle = trackTitle.replace(/^\d+[\s.\-_]+/, "").trim();
            if (!trackTitle || trackTitle.toLowerCase().includes("track list") || trackTitle.length < 2) return;

            const normalKey = trackTitle.toLowerCase().trim();
            const normalKeyNoSymbols = normalKey.replace(/[^a-z0-9]/g, "");

            if (seenTrackNames.has(normalKeyNoSymbols)) return;

            // Discard vocals-less variations dynamically to prevent db clutter
            if (normalKey.includes("instrumental") || normalKey.includes("off vocal") || normalKey.includes("karaoke") || normalKey.includes("tv size") || normalKey.includes("tv edit") || normalKey.includes("inst.")) {
              return;
            }

            seenTrackNames.add(normalKeyNoSymbols);

            results.push({
              title: trackTitle,
              artist: composer,
              type: "OST",
              tags: ["VGMdb", "Soundtrack", "Official"],
              animeName: animeName
            });
          });
        } catch (albumErr) {
          console.log(`[VGMdb HTML Scraper] Error scraping album ${albumUrl}:`, albumErr);
        }
        await new Promise(resolve => setTimeout(resolve, 200)); 
      }

      if (results.length > 0) {
        console.log(`[VGMdb HTML Scraper] Successfully extracted ${results.length} authentic tracks from vgmdb.net!`);
        return results;
      }
    }
  } catch (err: any) {
    console.log(`[VGMdb HTML Scraper] direct scrape failed: ${err.message}. Falling back to curation.`);
  }

  // Fallback to high-quality Gemini curator
  try {
    if (globalGeminiQuotaExceeded) return [];

    console.log(`[OST Discovery] VGMdb fetch empty or failed. Requesting Gemini model fallback to curate iconic OSTs for ${animeName}...`);
    
    const prompt = `You are an expert anime music curator.
Provide a list of up to 25 of the most iconic and highly regarded Original Soundtrack (OST) / Background Music (BGM) tracks for the anime "${sanitizeForPrompt(animeName, 200)}".
Rules:
1. Include iconic background themes, character themes, battle themes, or famous insert songs.
2. DO NOT include OP (Openings) or ED (Endings) themes.
3. Absolutely NO instrumentals of vocal songs, piano covers, or karaoke entries.
4. "title" should be the official track name (Romaji or English).
5. "artist" should be the original composer (e.g., Hiroyuki Sawano, Yuki Kajiura) or vocalist.`;

    const schema = {
      type: Type.ARRAY,
      description: "List of iconic background music tracks for the anime",
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          artist: { type: Type.STRING },
          tags: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Up to 3 genre or mood tags (e.g., Epic, Emotional, Battle, Sad, Synth, Jazz)"
          }
        },
        required: ["title", "artist", "tags"]
      }
    };

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2
      }
    });

    if (!response.text) return [];

    const result = JSON.parse(response.text);
    if (!Array.isArray(result)) return [];

    return result.map((item: any) => ({
      title: item.title,
      artist: item.artist,
      type: "OST",
      tags: [...(item.tags || []).slice(0, 3).map((t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()), "BGM", "Iconic"],
      animeName: animeName
    }));
  } catch (err: any) {
    console.warn("Gemini OST curation failed:", err.message);
    if (err.message?.includes("429")) globalGeminiQuotaExceeded = true;
    return [];
  }
}

// Endpoint to discover entire original soundtracks via YouTube playlists using Gemini AI
app.get("/api/full-playlist-discovery", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const animeName = req.query.animeName as string;
  if (!animeName) return res.status(400).json({ error: "animeName is required" });

  try {
    const { searchVideos, getPlaylistVideos } = await import('./src/utils/youtubeClient');
    const q = `${animeName} anime full original soundtrack OST playlist`;
    console.log(`[Full Playlist Discovery] Searching for "${q}"...`);

    const { playlists } = await searchVideos(q, 10);
    const topPlaylists = playlists.slice(0, 10).map(p => ({
      listId: p.listId,
      title: p.title,
      author: p.author,
      videoCount: p.videoCount
    }));

    if (topPlaylists.length === 0) {
      return res.status(404).json({ error: "No playlists found for this anime" });
    }

    let bestListId = topPlaylists[0].listId; // Fallback
    if (!globalGeminiQuotaExceeded) {
      const prompt = `You are an expert anime soundtrack archivist.
We searched YouTube for the full OST background music playlist for "${sanitizeForPrompt(animeName, 200)}".
Top results:
${JSON.stringify(sanitizeArrayForPrompt(playlists, 30, 200), null, 2)}

Return the listId of the single most complete, official, and relevant playlist containing ONLY the anime's background music (OST). Avoid AMVs or generic compilations.
Return a strict JSON object: { "bestListId": "..." }`;

      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: { bestListId: { type: Type.STRING } },
              required: ["bestListId"]
            },
            temperature: 0.1
          }
        });
        if (response.text) {
          bestListId = JSON.parse(response.text).bestListId;
        }
      } catch (e: any) {
        console.warn("AI playlist selection failed, falling back to top hit.", e.message);
        if (e.message?.includes("429")) globalGeminiQuotaExceeded = true;
      }
    }

    console.log(`[Full Playlist Discovery] Fetching playlist items for ${bestListId}...`);
    const playlistVideos = await getPlaylistVideos(bestListId, 40);
    // Grabbing first 40 tracks to prevent database bloat
    const videos = playlistVideos.slice(0, 40).map(v => ({ videoId: v.videoId, rawTitle: v.title }));

    if (videos.length === 0) {
      return res.status(404).json({ error: "Playlist is empty" });
    }

    let tracks = [];
    if (!globalGeminiQuotaExceeded) {
      try {
        const prompt2 = `Extract the exact clean track title and artist from these YouTube video titles.
If the artist is not stated, use "Various Artists" or the main composer for "${sanitizeForPrompt(animeName, 200)}".
Remove bracketed text like [OST] or (Audio).
Titles:
${JSON.stringify(sanitizeArrayForPrompt(videos, 50, 200), null, 2)}`;

        const response2 = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt2,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  videoId: { type: Type.STRING },
                  title: { type: Type.STRING },
                  artist: { type: Type.STRING }
                },
                required: ["videoId", "title", "artist"]
              }
            }
          }
        });
        if (response2.text) {
          tracks = JSON.parse(response2.text).map((t: any) => ({
            title: t.title,
            artist: t.artist,
            type: "OST",
            tags: ["Iconic", "BGM", "Imported"],
            animeName: animeName,
            youtubeId: t.videoId
          }));
        }
      } catch (e: any) {
        console.warn("AI track extraction failed:", e.message);
        if (e.message?.includes("429")) globalGeminiQuotaExceeded = true;
      }
    }

    if (tracks.length === 0) {
      // Very basic local fallback extraction
      tracks = videos.map(v => ({
        title: v.rawTitle.replace(/\[.*?\]|\(.*?\)/g, "").trim(),
        artist: "Various Artists",
        type: "OST",
        tags: ["Iconic", "BGM", "RawImport"],
        animeName: animeName,
        youtubeId: v.videoId
      }));
    }

    res.json({ osts: tracks });
  } catch (err: any) {
    console.error("Full playlist discovery error:", err);
    res.status(500).json({ error: err.message });
  }
});

import { searchVideos as ytSearchVideos, getPlaylistVideos as ytGetPlaylistVideos } from './src/utils/youtubeClient';

app.get("/api/youtube-search", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: "q is required" });

  try {
    const { videos, playlists } = await ytSearchVideos(query, 30);
    res.json({
      videos: videos.map(v => ({
        title: v.title,
        videoId: v.videoId,
        duration: v.duration,
        author: v.author
      })),
      playlists: playlists.slice(0, 10).map(pl => ({
        title: pl.title,
        listId: pl.listId,
        videoCount: pl.videoCount,
        author: pl.author || 'YouTube'
      }))
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/youtube-playlist-fetch", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const listId = req.query.listId as string;
  if (!listId) return res.status(400).json({ error: "listId is required" });
  try {
    const videos = await ytGetPlaylistVideos(listId, 60);
    res.json({
      videos: videos.map(v => ({
        videoId: v.videoId,
        title: v.title,
        author: v.author,
        duration: v.duration
      }))
    });
  } catch (error: any) {
    console.error("YouTube playlist fetch error:", error);
    res.status(500).json({ error: "YouTube playlist fetch failed." });
  }
});

// Endpoint to discover entire official soundtracks using iTunes Album Search Data (Smart, safe, no-AI needed)
app.get("/api/itunes-albums", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const animeName = req.query.animeName as string;
  if (!animeName) return res.status(400).json({ error: "animeName is required" });

  try {
    // iTunes search has no per-call timeout — wrap with AbortSignal so a
    // hung connection can't blow the 10s Netlify / 30s Render limit.
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(animeName + " soundtrack")}&entity=album&limit=6`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("iTunes search failed");
    
    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: "No official albums found" });
    }

    const allTracks: any[] = [];
    const seenTitles = new Set<string>();

    // Top 4 albums (filtered to drop "cover"/"tribute"/"inspired" comps
    // since those aren't original soundtracks). Reused for both the
    // raw-album-cover picker and the track-flattening pass below.
    const albumsToFetch = (data.results as any[])
      .slice(0, 4)
      .filter(album => {
        const cName = (album.collectionName || "").toLowerCase();
        return !cName.includes("cover") && !cName.includes("tribute") && !cName.includes("inspired");
      });

    // ALSO keep the raw album objects (with artworkUrl) for the
    // CoverArtPicker tool — previously the server only returned
    // `osts` (flattened tracks) so the picker's `data.albums` check
    // always silently returned zero covers. Now both consumers get
    // what they need: AdminQueue reads `osts`, CoverArtPicker reads
    // `albums`.
    const albums = albumsToFetch.map(album => ({
      collectionId: album.collectionId,
      collectionName: album.collectionName,
      artistName: album.artistName,
      artworkUrl: album.artworkUrl,
      releaseDate: album.releaseDate,
      trackCount: album.trackCount,
    }));

    // Fetch tracks for up to 4 top-matched OST albums — IN PARALLEL via
    // Promise.allSettled. Previously these were sequential so 4 albums ×
    // ~3s per fetch = 12s+ total, blowing the 10s Netlify limit. Now
    // they all run at once and we wait for the slowest (~3s max).
    const albumResults = await Promise.allSettled(
      albumsToFetch.map(async (album) => {
        const tracksUrl = `https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song`;
        const tracksRes = await fetch(tracksUrl, { signal: AbortSignal.timeout(8000) });
        if (!tracksRes.ok) return [];
        const tracksData = await tracksRes.json();
        return (tracksData.results || [])
          .filter((t: any) => t.wrapperType === 'track')
          .map((t: any) => ({
            title: (t.trackName || "").trim(),
            artist: (t.artistName || "Unknown Artist").trim(),
            type: "OST" as const,
            tags: ["Official Album", "BGM", "Imported"],
            animeName,
            youtubeId: "",
          }))
          .filter((t: any) => t.title);  // drop empties
      }),
    );

    for (const settled of albumResults) {
      if (settled.status !== 'fulfilled') continue;
      for (const t of settled.value) {
        if (seenTitles.has(t.title.toLowerCase())) continue;
        seenTitles.add(t.title.toLowerCase());
        allTracks.push(t);
      }
    }

    res.json({ osts: allTracks, albums });
  } catch (err: any) {
    console.error("iTunes album discovery error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to fetch dynamic iconic soundtracks (OSTs) compiled directly via scrapers (VGMdb, Anison, AniDB)
app.get("/api/anime-osts", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const animeName = req.query.animeName as string;
  if (!animeName) return res.status(400).json({ error: "animeName is required" });

  const cacheKey = animeName.toLowerCase().trim();
  if (ostCache.has(cacheKey)) {
    return res.json({ osts: ostCache.get(cacheKey) });
  }

  try {
    console.log(`[OST Discovery] Initiating multi-source parallel fetch and smart merge system for "${animeName}"...`);
    
    // Fetch from all scrapers and databases in parallel to maximize efficiency
    const [anisonTracks, anidbTracks] = await Promise.all([
      scrapeAnison(animeName).catch(() => []),
      scrapeAniDB(animeName).catch(() => [])
    ]);

    console.log(`[OST Discovery] Initial counts: Anison=${anisonTracks.length}, AniDB=${anidbTracks.length}`);

    // Filter track lists to select appropriate items for OST soundtrack list (including insert songs)
    const filteredAnison = anisonTracks.filter(t => t.type === 'OST' || t.type === 'IN');
    const filteredAnidb = anidbTracks.filter(t => t.type === 'OST' || t.type === 'IN');

    // Run our incredible Consensus Alignment & Merge Pipeline
    let mergedOsts = alignAndMergeTracks(filteredAnison, filteredAnidb);

    // AI-verification of tracks list to select official OSTs and eliminate duplicates smartly
    if (!globalGeminiQuotaExceeded && mergedOsts.length > 0) {
      try {
        console.log(`[OST Discovery] Triggering Gemini AI discography curation for "${animeName}"...`);
        // Limit to top 150 candidates to avoid massive payloads
        const candidates = mergedOsts.slice(0, 150).map(t => ({
          title: t.title,
          artist: t.artist || "Various Artists"
        }));

        const prompt = `You are a world-class anime discography curator and music database expert.
We have collected a list of track candidates from official soundtrack resources for the anime series "${sanitizeForPrompt(animeName, 200)}".
Candidates:
${JSON.stringify(sanitizeArrayForPrompt(candidates, 150, 200), null, 2)}

Your goals:
1. VERIFY the correct list of official/canonical background music (BGM) and Original Soundtrack (OST) themes. Keep ONLY real background tracks, iconic insert songs, or central dramatic themes.
2. DISCARD fluffy tracks (such as duplicate karaoke/vocal-less versions, acoustic filler versions, game sound effects, duplicate instrumentals, repetitive themes, and non-musical voice drama lines).
3. DETECT DUPLICATES AND TRANSLATIONS and choose the single best title representation (prefer Romaji/English text, beautifully formatted and readable, over pure Japanese script where possible, e.g. choose "Guren no Yumiya" or "Crimson Bow & Arrow" instead of "紅蓮の弓矢" if both are present, or merge them cleanly).
4. STANDARD curation and clean capitalization. Remove track numbers, timestamps, catalog codes, or brackets like "(disc 1)" or "[OST]" unless necessary to distinguish. For instance:
   - "01 - My Theme" becomes "My Theme"
   - "Cruel Angel's Thesis (TV Size)" becomes "Cruel Angel's Thesis"
5. Do NOT over-limit. Try to return a highly complete discography representation (e.g. up to 40 of the most significant and popular themes if found, but at least 15 if there are enough candidates).

Return a strict JSON object with a single key "osts" containing the array of curated tracks:
{
  "osts": [
    { "title": "...", "artist": "..." }
  ]
}`;

        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                osts: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      artist: { type: Type.STRING }
                    },
                    required: ["title", "artist"]
                  }
                }
              },
              required: ["osts"]
            }
          }
        });

        if (response.text) {
          const resJson = JSON.parse(response.text);
          if (resJson && Array.isArray(resJson.osts) && resJson.osts.length > 0) {
            console.log(`[OST Discovery] Gemini successfully curated and aligned ${resJson.osts.length} clean tracks for "${animeName}".`);
            const finalOsts = resJson.osts.map((o: any) => ({
              title: o.title,
              artist: o.artist || "Various Artists",
              type: "OST",
              tags: ["VGMdb", "Soundtrack", "AI-Verified"],
              animeName: animeName
            }));
            
            ostCache.set(cacheKey, finalOsts);
            return res.json({ osts: finalOsts });
          }
        }
      } catch (geminiError: any) {
        console.warn(`[OST Discovery AI] AI evaluation failed, falling back to heuristic filtering:`, geminiError.message);
      }
    }

    // Heuristic fallback if AI fails or quota is exceeded
    const finalOsts = mergedOsts.slice(0, 30);
    if (finalOsts.length > 0) {
      ostCache.set(cacheKey, finalOsts);
      return res.json({ osts: finalOsts });
    }

    // Template fallback if everything is empty
    const templates = getThemeTemplates(animeName).filter(t => t.type === 'OST');
    res.json({ osts: templates });
  } catch (err: any) {
    console.error("Failed to discover OSTs:", err);
    res.status(500).json({ error: "Failed to locate soundtrack data." });
  }
});

// Endpoint to provide lyrics - synced timestamps are disabled since AI is removed.
app.post("/api/lyrics", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const { title, artist, animeName } = req.body;
  if (!title || !animeName) {
    return res.status(400).json({ error: "title and animeName are required." });
  }

  const cacheKey = `${animeName}_${title}`.toLowerCase().trim();
  if (lyricsCache.has(cacheKey)) {
    return res.json(lyricsCache.get(cacheKey));
  }

  // --- Real lyrics via LRCLIB (free, open, no-auth) ---
  // Falls back to the placeholder stub only if LRCLIB has no match.
  try {
    const { getLyrics, parseLrc } = await import('./src/utils/lrclib');
    // Anime themes often have artist = "Unknown" or the anime name itself.
    // LRCLIB searches by artist, so try both the original artist and the
    // anime name as a fallback artist hint.
    const candidates = [artist, animeName].filter(Boolean);
    let result = null;
    for (const cand of candidates) {
      result = await getLyrics({ trackName: title, artistName: cand });
      if (result) break;
    }

    if (result && (result.syncedLyrics || result.plainLyrics)) {
      const syncedLines = parseLrc(result.syncedLyrics);
      const payload = {
        source: 'lrclib',
        trackName: result.trackName,
        artistName: result.artistName,
        albumName: result.albumName,
        synced: syncedLines,                              // [{ time, text }]
        plainLyrics: result.plainLyrics,
        syncedLyrics: result.syncedLyrics,
        // Keep shape compat with the old stub consumer (TrackLeaderboard
        // karaoke mode reads .japanese / .english / .meaning).
        japanese: result.plainLyrics ? result.plainLyrics.split('\n') : [],
        romaji: [],
        english: result.plainLyrics ? result.plainLyrics.split('\n') : [],
        meaning: `Lyrics via LRCLIB — ${syncedLines.length > 0 ? 'synced (timed)' : 'plain'}.`,
      };
      lyricsCache.set(cacheKey, payload);
      return res.json(payload);
    }
  } catch (err: any) {
    console.warn('[/api/lyrics] LRCLIB fetch failed, using stub:', err.message);
  }

  // --- Stub fallback (only if LRCLIB had no match) ---
  const result = {
    source: 'stub',
    japanese: [
      "歌詞の同期にはAIが必要です",
      "ウェブサイトから直接スクレイピングしています"
    ],
    romaji: [
      "Kashi no douki ni wa AI ga hitsuyou desu",
      "Web-site kara chokusetsu scraping shiteimasu"
    ],
    english: [
      "Lyrics not found in LRCLIB — this is a placeholder.",
      "Try a different track title or add lyrics at lrclib.net"
    ],
    meaning: "No synced lyrics found in LRCLIB for this track. Karaoke mode is unavailable."
  };

  lyricsCache.set(cacheKey, result);
  res.json(result);
});

// Simple delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Robust detection for Gemini/Search quota exhaustion across various error formats
function isGeminiQuotaError(error: any): boolean {
  if (!error) return false;
  const errorStr = (typeof error === 'string' ? error : error.message || "").toLowerCase();
  const statusStr = (error.status || "").toString().toLowerCase();
  const code = error.code || (error.error && error.error.code);
  
  return code === 429 || 
         statusStr === "resource_exhausted" ||
         errorStr.includes("429") || 
         errorStr.includes("quota") || 
         errorStr.includes("rate limit") ||
         errorStr.includes("exhausted");
}

// Helper to fetch themes via Jikan API to completely bypass AI quotas
// NOTE: Jikan's /v4/anime/{id}/themes endpoint has been unreliable since MAL
// started blocking Jikan's backend (returns 504 "Jikan failed to connect to
// MyAnimeList"). As a robust fallback, we now:
//   1. Try the /themes endpoint first (in case it comes back online)
//   2. If it fails, fetch the full anime data which includes openings/endings
//      arrays in some cases
//   3. If that fails too, return null and let the caller fall through to
//      AnimeThemes.moe
async function fetchThemesFromJikan(mal_id: number, animeName: string) {
  let retries = 3;
  let backoffMs = 1500; // exponential backoff for 429s

  while (retries > 0) {
    try {
      // Try the /themes endpoint first
      const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}/themes`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      });

      if (res.status === 429) {
        console.warn(`[Jikan] Rate limit hit for ${animeName}, waiting ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
        backoffMs *= 2; // exponential backoff
        retries--;
        continue;
      }

      if (res.status === 504) {
        // MAL is blocking Jikan — don't retry, fall through to fallback
        console.warn(`[Jikan] /themes endpoint returned 504 for ${animeName} (MAL blocking Jikan). Trying /anime/{id} fallback...`);
        break;
      }

      if (res.ok) {
        const json = await res.json();
        if (json && json.data) {
          const results: any[] = [];
          const parseJikanTheme = (entry: string, type: string) => {
            const match = entry.match(/"([^"]+)"\s*(?:by\s+(.*?)(?:\s+\(eps|$))?/i);
            if (match) {
              results.push({
                title: match[1]?.trim() || "Unknown Theme",
                artist: match[2]?.trim() || "Unknown Artist",
                type,
                tags: ["Hype"],
                animeName: animeName.trim()
              });
            }
          };

          if (Array.isArray(json.data.openings)) {
            json.data.openings.slice(0, 5).forEach((str: string) => parseJikanTheme(str, "OP"));
          }
          if (Array.isArray(json.data.endings)) {
            json.data.endings.slice(0, 5).forEach((str: string) => parseJikanTheme(str, "ED"));
          }

          if (results.length > 0) return results;
        }
      }
      break; // non-429, non-504 error — don't retry
    } catch (e: any) {
      console.warn(`[Jikan] /themes fetch error for ${animeName}:`, e.message);
      break;
    }
  }

  // Fallback: fetch the full anime data — sometimes includes theme info in
  // the main response (different from the dedicated /themes endpoint)
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${mal_id}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
    });
    if (res.ok) {
      const json = await res.json();
      const data = json?.data;
      if (data) {
        const results: any[] = [];
        // Some anime have theme strings in the main response
        const themeSources = [
          { themes: data.openings, type: 'OP' },
          { themes: data.endings, type: 'ED' },
        ];
        for (const { themes, type } of themeSources) {
          if (Array.isArray(themes)) {
            for (const entry of themes.slice(0, 5)) {
              const match = entry.match(/"([^"]+)"\s*(?:by\s+(.*?)(?:\s+\(eps|$))?/i);
              if (match) {
                results.push({
                  title: match[1]?.trim() || "Unknown Theme",
                  artist: match[2]?.trim() || "Unknown Artist",
                  type,
                  tags: ["Hype"],
                  animeName: animeName.trim()
                });
              }
            }
          }
        }
        if (results.length > 0) {
          console.log(`[Jikan] Fetched ${results.length} themes from /anime/{id} fallback for ${animeName}`);
          return results;
        }
      }
    }
  } catch (e: any) {
    console.warn(`[Jikan] /anime/{id} fallback error for ${animeName}:`, e.message);
  }

  return null;
}

// Helper to fetch themes via AnimeThemes.moe API.
// AnimeThemes.moe is the canonical anime theme database and is more reliable
// than Jikan for theme data. Uses exponential backoff for rate limits.
async function fetchThemesFromAnimeThemesMoe(animeName: string) {
  let retries = 3;
  let backoffMs = 2000; // start at 2s, double each retry

  while (retries > 0) {
    try {
      // Use the /anime endpoint with comma-separated include params.
      // NOTE: Do NOT use the /search endpoint — it returns 422 when include
      // is passed as a comma-separated string. The /anime endpoint works fine.
      const searchUrl = `https://api.animethemes.moe/anime?q=${encodeURIComponent(animeName)}&include=animethemes,animethemes.song,animethemes.song.artists&limit=5`;
      const res = await fetch(searchUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
      });

      if (res.status === 429) {
        console.warn(`[AnimeThemes] Rate limit hit for ${animeName}, waiting ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
        backoffMs *= 2;
        retries--;
        continue;
      }

      if (!res.ok) {
        console.warn(`[AnimeThemes] HTTP ${res.status} for ${animeName}`);
        return null;
      }

      const json = await res.json();
      if (!json || !Array.isArray(json.anime) || json.anime.length === 0) {
        return null;
      }

      // Find the best match — prefer exact name match, else use the first result
      const lowerName = animeName.toLowerCase().trim();
      const anime = json.anime.find((a: any) =>
        (a.name || '').toLowerCase().trim() === lowerName
      ) || json.anime[0];

      const results: any[] = [];

      if (Array.isArray(anime.animethemes)) {
        for (const t of anime.animethemes) {
          const type = t.type === "ED" ? "ED" : t.type === "OP" ? "OP" : "OST";
          const songTitle = t.song?.title || "Unknown Theme";
          let artistName = "Unknown Artist";
          if (Array.isArray(t.song?.artists)) {
            artistName = t.song.artists.map((art: any) => art.name || art.as).filter(Boolean).join(", ") || "Unknown Artist";
          }
          results.push({
            title: songTitle.trim(),
            artist: artistName.trim(),
            type,
            tags: ["Hype"],
            animeName: (anime.name || animeName).trim()
          });
        }
      }

      if (results.length > 0) {
        console.log(`[AnimeThemes] Found ${results.length} themes for "${animeName}" (matched: ${anime.name})`);
      }
      return results.length > 0 ? results : null;
    } catch (err: any) {
      console.warn(`[AnimeThemes] fetch error for ${animeName}:`, err.message);
      // Network/timeout error — wait and retry
      if (retries > 1) {
        await new Promise(r => setTimeout(r, backoffMs));
        backoffMs *= 2;
      }
      retries--;
    }
  }
  return null;
}

// Failsafe dynamic theme generator to ensure things ALWAYS load gracefully if Gemini and all APIs fail
function getThemeTemplates(animeName: string) {
  const cleanName = animeName.trim();
  return [
    {
      title: `${cleanName} - Opening Theme (OP 1)`,
      artist: `Original Artist`,
      type: "OP",
      tags: ["Hype", "Vocal"],
      animeName: cleanName
    },
    {
      title: `${cleanName} - Ending Theme (ED 1)`,
      artist: `Original Artist`,
      type: "ED",
      tags: ["Melodic", "Chill"],
      animeName: cleanName
    },
    {
      title: `${cleanName} - Main Sound Theme (OST)`,
      artist: `Soundtrack Composer`,
      type: "OST",
      tags: ["Epic", "Instrumental"],
      animeName: cleanName
    }
  ];
}

/// Helper to fetch search-grounded themes for a single popular anime
async function fetchAnimeThemesForBulk(animeName: string, mal_id?: number) {
  // Step 0: Cache Check
  const cacheKey = animeName.toLowerCase().trim();
  if (themeCache.has(cacheKey)) {
    // Note: themeCache for Bulk stores the RAW objects (pre-YouTube ID) as retrieved from APIs
    console.log(`[Smart Bulk Match] Serving "${animeName}" from raw theme cache.`);
    return themeCache.get(cacheKey);
  }

  // Step 1: Try AnimeThemes.moe FIRST — it's the canonical anime theme database
  // and is more reliable than Jikan for theme data (Jikan's /themes endpoint
  // has been returning 504s because MAL blocks Jikan's backend).
  console.log(`[Smart Bulk Match] Trying AnimeThemes.moe for ${animeName}...`);
  const moeThemes = await fetchThemesFromAnimeThemesMoe(animeName);
  if (moeThemes && moeThemes.length > 0) {
    console.log(`[Smart Bulk Match] AnimeThemes.moe successfully fetched ${moeThemes.length} tracks for "${animeName}".`);
    themeCache.set(cacheKey, moeThemes);
    return moeThemes;
  }

  // Step 2: Try Jikan API if we have a MAL ID (with fallback to /anime/{id})
  if (mal_id) {
    console.log(`[Smart Bulk Match] Using Jikan API for ${animeName} (mal_id: ${mal_id})...`);
    const jikanThemes = await fetchThemesFromJikan(mal_id, animeName);
    if (jikanThemes && jikanThemes.length > 0) {
      themeCache.set(cacheKey, jikanThemes);
      return jikanThemes;
    }
  }

  // Step 3: Fast-path fallback using Jikan search if mal_id wasn't provided initially
  if (!mal_id) {
    // Try multiple query variants for high fidelity
    const queryVariants = getSearchVariants(animeName);

    for (const query of queryVariants) {
      let retries = 3;
      let backoffMs = 1500;
      while (retries > 0) {
        try {
          console.log(`[Smart Bulk Match] Trying Jikan search for "${query}"...`);
          const searchRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
          });
          if (searchRes.status === 429) {
            console.warn(`[Jikan Search] Rate limit hit for "${query}", waiting ${backoffMs}ms...`);
            await new Promise(r => setTimeout(r, backoffMs));
            backoffMs *= 2;
            retries--;
            continue;
          }
          if (searchRes.status === 504) {
            console.warn(`[Jikan Search] 504 for "${query}" (MAL blocking Jikan). Skipping Jikan.`);
            break;
          }
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.data && searchData.data.length > 0) {
              const foundMalId = searchData.data[0].mal_id;
              const foundTitle = searchData.data[0].title || animeName;
              const jikanThemes = await fetchThemesFromJikan(foundMalId, foundTitle);
              if (jikanThemes && jikanThemes.length > 0) {
                themeCache.set(cacheKey, jikanThemes);
                return jikanThemes;
              }
            }
          }
          await delay(500); // Rate limit buffer
          break; // break retry loop if not 429
        } catch (_) {
          break; // break retry loop on other errors
        }
      }
    }
  }

  // Step 4: Fall back to official scrapers
  console.log(`[Smart Bulk Match] Transitioning to database scraping for "${animeName}"...`);
  const scraped = await scrapeAnison(animeName);
  if (scraped && scraped.length > 0) {
    themeCache.set(cacheKey, scraped);
    return scraped;
  }

  const anidb = await scrapeAniDB(animeName);
  if (anidb && anidb.length > 0) {
    themeCache.set(cacheKey, anidb);
    return anidb;
  }

  console.warn(`All APIs and scrapers exhausted for "${animeName}". Returning templates.`);
  return getThemeTemplates(animeName);
}

// Endpoint: Get list of popular anime (WITHOUT fetching themes).
// Uses AniList GraphQL API (reliable, no 504s, real global popularity rankings).
// Supports pagination — page 1 = top 50, page 2 = next 50, etc.
app.get("/api/bulk-anime-list", rateLimit(RATE_LIMIT_DEFAULT), requireAdmin, async (req, res) => {
  try {
    const perPage = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.startPage as string) || 1;

    // AniList GraphQL query — fetches the most popular anime globally
    // sorted by POPULARITY_DESC (most watched/favorited on AniList).
    // Includes ALL formats (TV, Movie, OVA, Special) so you get everything.
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage currentPage lastPage }
          media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            id
            idMal
            title { romaji english native }
            coverImage { large medium }
            format
            seasonYear
            season
            episodes
            averageScore
            popularity
          }
        }
      }`;

    const graphqlRes = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ANISYNC/1.0 (https://anisync.app)',
      },
      body: JSON.stringify({ query, variables: { page, perPage } }),
      signal: AbortSignal.timeout(15000),
    });

    if (!graphqlRes.ok) {
      throw new Error(`AniList returned ${graphqlRes.status}`);
    }

    const json = await graphqlRes.json();
    const media = json?.data?.Page?.media || [];
    const pageInfo = json?.data?.Page?.pageInfo || {};

    // Map to our format — use the English title if available, else romaji
    const animeMapList = media.map((a: any) => ({
      title: a.title?.english || a.title?.romaji || a.title?.native || 'Unknown',
      mal_id: a.idMal,
      anilist_id: a.id,
      cover: a.coverImage?.large || a.coverImage?.medium,
      format: a.format,
      year: a.seasonYear,
      season: a.season,
      episodes: a.episodes,
      score: a.averageScore,
      popularity: a.popularity,
    }));

    console.log(`[Bulk-Anime-List] Fetched ${animeMapList.length} anime from AniList (page ${page}/${pageInfo.lastPage || '?'})`);

    res.json({
      anime: animeMapList,
      pageInfo: {
        currentPage: pageInfo.currentPage || page,
        hasNextPage: pageInfo.hasNextPage || false,
        lastPage: pageInfo.lastPage || 1,
      },
    });
  } catch (error: any) {
    console.error("Failed to fetch anime list:", error.message);
    res.status(500).json({ error: "Failed to fetch anime list: " + error.message });
  }
});

// Bulk Popular MAL Proxy
// NOTE: Jikan's /top/anime endpoint has been unreliable (504 errors when MAL
// blocks Jikan). We now use the /anime search endpoint with a curated list of
// popular anime as the primary source, falling back to the hardcoded list only
// if Jikan is completely down.
app.get("/api/bulk-popular", rateLimit(RATE_LIMIT_DEFAULT), requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 12;
    const startPage = parseInt(req.query.startPage as string) || 1;
    const keepOrder = req.query.keepOrder === "true";
    let animeMapList: {title: string, mal_id?: number}[] = [];

    // Curated list of popular anime (with MAL IDs) — used as the primary source
    // since Jikan's /top/anime endpoint is unreliable. The search endpoint
    // works, but searching for "popular anime" doesn't return ranked results.
    // This list is stable, well-known, and has good theme coverage.
    const curatedPopularAnime = [
      { title: "Shingeki no Kyojin", mal_id: 16498 },
      { title: "Naruto Shippuden", mal_id: 1735 },
      { title: "One Piece", mal_id: 21 },
      { title: "Fullmetal Alchemist: Brotherhood", mal_id: 5114 },
      { title: "Kimetsu no Yaiba", mal_id: 38000 },
      { title: "Jujutsu Kaisen", mal_id: 40748 },
      { title: "Death Note", mal_id: 1535 },
      { title: "Boku no Hero Academia", mal_id: 31964 },
      { title: "Hunter x Hunter (2011)", mal_id: 11061 },
      { title: "Steins;Gate", mal_id: 9253 },
      { title: "Neon Genesis Evangelion", mal_id: 30 },
      { title: "Chainsaw Man", mal_id: 44511 },
      { title: "Tokyo Ghoul", mal_id: 22319 },
      { title: "One Punch Man", mal_id: 30276 },
      { title: "Mob Psycho 100", mal_id: 32182 },
      { title: "Attack on Titan: Final Season", mal_id: 42897 },
      { title: "Demon Slayer: Entertainment District", mal_id: 42153 },
      { title: "Jujutsu Kaisen 0", mal_id: 48561 },
      { title: "Spy x Family", mal_id: 50265 },
      { title: "Bleach", mal_id: 269 },
      { title: "Code Geass", mal_id: 1575 },
      { title: "Cowboy Bebop", mal_id: 1 },
      { title: "Dragon Ball Z", mal_id: 813 },
      { title: "Fairy Tail", mal_id: 6702 },
      { title: "Sword Art Online", mal_id: 11757 },
    ];

    // Try Jikan /top/anime first (in case it's working again)
    try {
      const perPage = 25;
      const pagesToFetch = Math.max(1, Math.ceil(limit / perPage));

      for (let p = 0; p < pagesToFetch; p++) {
        const pageToFetch = (!keepOrder && limit <= 25 && startPage === 1) ? Math.floor(Math.random() * 200) + 1 : startPage + p;

        let retries = 3;
        let backoffMs = 1500;
        while (retries > 0) {
          const jikanRes = await fetch(`https://api.jikan.moe/v4/top/anime?type=tv&filter=bypopularity&page=${pageToFetch}`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
          });

          if (jikanRes.status === 429) {
            console.warn(`[Bulk-Popular] Rate limit hit for Jikan page ${pageToFetch}, waiting ${backoffMs}ms...`);
            await delay(backoffMs);
            backoffMs *= 2;
            retries--;
            continue;
          }

          if (jikanRes.status === 504) {
            // MAL blocking Jikan — break out and use curated list
            console.warn(`[Bulk-Popular] Jikan /top/anime returned 504 (MAL blocking). Using curated list.`);
            break;
          }

          if (jikanRes.ok) {
            const json = await jikanRes.json();
            if (json && json.data && Array.isArray(json.data)) {
              const pageAnimes = json.data
                .filter((a: any) => a.title)
                .map((a: any) => ({ title: a.title, mal_id: a.mal_id }));

              animeMapList.push(...pageAnimes);
            }
          }
          break; // break retry loop if completed or other error
        }

        if (animeMapList.length >= limit) break;
        await delay(1000); // Respect Jikan rate limit
      }
    } catch (err: any) {
      console.warn("[Bulk-Popular] Jikan /top/anime exception:", err.message);
    }

    // If Jikan /top/anime failed (504/timeout), use the curated list
    if (animeMapList.length === 0) {
      console.log("[Bulk-Popular] Using curated popular anime list.");
      animeMapList = curatedPopularAnime.slice(0, limit);
    }

    // Shuffle the results to get a mix and take the requested limit if not keepOrder
    if (!keepOrder) {
      animeMapList.sort(() => Math.random() - 0.5);
    }
    animeMapList = animeMapList.slice(0, limit);

    // Retrieve themes for each anime sequentially using paced requests to respect rate limits
    const nestedThemes = [];
    let numThemesFound = 0;

    for (let i = 0; i < animeMapList.length; i++) {
      const animeItem = animeMapList[i];
      console.log(`[Bulk Import] Processing anime ${i + 1}/${animeMapList.length}: "${animeItem.title}"...`);
      const themes = await fetchAnimeThemesForBulk(animeItem.title, animeItem.mal_id);

      if (themes && themes.length > 0) {
        nestedThemes.push(themes);
        numThemesFound += themes.length;
      }

      if (numThemesFound >= limit) {
        break; // Reached the desired number of tracks!
      }

      // Delay space between requests to prevent hitting Jikan rate limits (3 req/sec)
      if (i < animeMapList.length - 1) {
        await delay(350);
      }
    }
    
    const flatThemes = nestedThemes.flat();

    // Generate song-oriented tags for each track using the new tagSystem.
    // Tags are based on the SONG (genre, mood, tempo, vocal) — not anime metadata.
    const { generateSongTagsForTracks } = await import('./src/utils/songTags');
    const trackInputs = flatThemes.map((t: any) => ({
      title: t.title,
      artist: t.artist,
      animeName: t.animeName,
      type: t.type,
    }));
    console.log(`[Bulk Import] Generating song tags for ${trackInputs.length} tracks...`);
    const allTags = await generateSongTagsForTracks(trackInputs);

    const finalTracks = flatThemes.map((t: any, i: number) => ({
       id: crypto.randomUUID(),
       youtubeId: "",
       title: t.title,
       artist: t.artist,
       animeName: t.animeName,
       type: t.type,
       elo: 1200,
       matchesPlayed: 0,
       wins: 0,
       losses: 0,
       draws: 0,
       addedByUser: false,
       tags: allTags[i] || t.tags || ["Hype"]
    }));
    
    res.json({ tracks: finalTracks });
  } catch (error: any) {
    console.error("Failed to fetch bulk popular:", error);
    res.status(500).json({ error: "Failed to locate bulk data." });
  }
});

// Endpoint 1: Analyze user's music taste and playlist profile with AI (Gemini v3.5-flash)
app.post("/api/analyze-taste", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { username, favoriteTracks = [], customListsCount = 0, vibeSpectrum } = req.body;

  const resolvedSpectrum = vibeSpectrum || {
    nostalgia: 50,
    hype: 50,
    atmospheric: 50,
    symphonic: 50,
    vocalIntensity: 50
  };

  // Heuristic Fallback Engine (Offline Mode Resilience)
  const getHeuristicFallback = () => {
    let archetype = "The Harmonic Seeker";
    let tagline = "A balanced wanderer appreciating the multi-faceted soundscapes of anime history.";
    let gradient = "from-emerald-500 to-teal-600";
    let analysis = `Hello ${username || "Music Fan"}! Looking at your vibe weights, you appreciate a balanced blend of distinct musical frequencies. You don't bind yourself to a single style, drifting seamlessly from heavy rock openings to quiet, ambient ending credits.`;
    
    // Check dominant vibes
    const { nostalgia, hype, atmospheric, symphonic, vocalIntensity } = resolvedSpectrum;
    const maxVal = Math.max(nostalgia, hype, atmospheric, symphonic, vocalIntensity);

    if (maxVal === nostalgia) {
      archetype = "The Retro Horizon Chronicler";
      tagline = "A nostalgic soul seeking comfort in the hand-drawn cells and analog guitar tracks of yesteryears.";
      gradient = "from-amber-500 to-rose-600";
      analysis = `Hello ${username || "Music Fan"}! Your music taste is anchored in deep nostalgic longing. You are captivated by the organic warm production, brass sections, and raw synth lines of pre-2010 anime, finding comfort in tracks that feel like late-night VHS memories.`;
    } else if (maxVal === hype) {
      archetype = "The Shonen Overlord";
      tagline = "Fueling your everyday arc with high-intensity power chords and battle-ready vocal screams.";
      gradient = "from-orange-500 to-rose-600";
      analysis = `Hello ${username || "Music Fan"}! Your vibe profile is ultra-charged with adrenaline. You live for those legendary, fist-pumping openers that play as the main characters breakthrough their limitations, favoring blazing fast tempo, electric guitars, and intense vocal leads.`;
    } else if (maxVal === atmospheric) {
      archetype = "The Starlight Solitude Monk";
      tagline = "Drifting away in the quiet, starry nights of melancholic acoustic guitars and soft vocal murmurs.";
      gradient = "from-indigo-500 to-purple-600";
      analysis = `Hello ${username || "Music Fan"}! Your soul matches the soft, dim-lit ending themes. You prefer tracks that give you breathing space—melancholic piano motifs, soft backing string pads, and slow electronic beats that help you unwind and think in solitude.`;
    } else if (maxVal === symphonic) {
      archetype = "The Grand Orchestral Maestro";
      tagline = "Hearing anime as high-cinema, driven by magnificent choirs and epic brass melodies.";
      gradient = "from-cyan-500 to-blue-600";
      analysis = `Hello ${username || "Music Fan"}! You view anime themes as fine cinematic art. You gravitate towards epic background scores, heavy instrumental orchestrations, and rich grand compositions that feel like they have a live backing orchestra carrying the world on its strings.`;
    } else if (maxVal === vocalIntensity) {
      archetype = "The J-Pop Vocal Idol";
      tagline = "Stunned by vocal gymnastics, high note belts, and emotional performance theater.";
      gradient = "from-fuchsia-500 to-pink-600";
      analysis = `Hello ${username || "Music Fan"}! You are a true follower of sheer vocal craftsmanship. Your playlist revolves page-after-page around power singer-songwriters, rapid tempo vocaloid vocalists, and dramatic singers whose raw voice control completely dictates the emotional gravity of the series.`;
    }

    return {
      archetypeName: archetype,
      archetypeTagline: tagline,
      auraGradient: gradient,
      musicPsychAnalysis: analysis,
      moodDimensionBreakdown: {
        hypeLevel: hype > 70 ? "Unstoppable high-velocity adrenaline driver." : "Measured, focused rhythmic engine.",
        nostalgiaLevel: nostalgia > 70 ? "Anchored in classic, timeless golden age arrangements." : "Futuristic, crisp, modern wave focus.",
        atmosphericVibe: atmospheric > 70 ? "Deeply immersive, dreamy, and melancholic." : "Bright, cheerful, and outward-facing.",
        symphonicDepth: symphonic > 70 ? "Cinematic scale with organic backing instruments." : "Sleek, electronic, synth-accentuated style.",
        vocalPresence: vocalIntensity > 70 ? "Extremely narrative-heavy, high-pitched vocal gymnastics." : "Rhythmic, instrument-merged vocal textures."
      },
      aiCuratedRecommendations: [
        {
          title: "Again",
          artist: "YUI",
          animeName: "Fullmetal Alchemist: Brotherhood",
          type: "OP",
          reason: "Alchemizes high emotional vocal rapid-fire verses with a classic, highly nostalgic rock melody."
        },
        {
          title: "Gurenge",
          artist: "LiSA",
          animeName: "Demon Slayer: Kimetsu no Yaiba",
          type: "OP",
          reason: "An absolute powerhouse of hype, vocal drive, and traditional folklore-infused rock hooks."
        },
        {
          title: "Secret Base",
          artist: "Kayano Ai",
          animeName: "Anohana: The Flower We Saw That Day",
          type: "ED",
          reason: "An atmospheric tear-jerker with nostalgic acoustic guitar chords that perfectly match deep sentimental profiles."
        }
      ]
    };
  };

  if (!process.env.GEMINI_API_KEY || globalGeminiQuotaExceeded) {
    console.log("[Taste Analyzer API] Using heuristic fallback (offline or over quota).");
    return res.json(getHeuristicFallback());
  }

  try {
    const safeUsername = sanitizeForPrompt(username || "Anonymous Caller", 100);
    const safeFavorites = sanitizeArrayForPrompt(favoriteTracks, 50, 200);
    const favoritesPrompt = safeFavorites.length > 0
      ? safeFavorites.map((t: any) => `- "${t.title}" by ${t.artist} (${t.type} from "${t.animeName}")`).join("\n")
      : "No favorited songs yet (he/she is a clean state tastemaker).";

    const prompt = `You are a high-fidelity Anime Soundtrack Psychologist and taste analyst.
Analyze the user's music taste based on their specific statistics:
- Name: "${safeUsername}"
- Favorites:
${favoritesPrompt}
- Custom Playlists: ${customListsCount}
- Real-time Vibe Spectrum Weights (0 to 100 values):
  * Nostalgia: ${resolvedSpectrum.nostalgia}
  * Hype/Adrenaline: ${resolvedSpectrum.hype}
  * Atmospheric/Chill: ${resolvedSpectrum.atmospheric}
  * Symphonic/Orchestral: ${resolvedSpectrum.symphonic}
  * Vocal Intensity: ${resolvedSpectrum.vocalIntensity}

Create an exciting, incredibly stylish "Spotify Wrapped"-style profile. You must output a STRICT JSON object without any backticks, markdown code block formatting, or leading comments.

JSON Schema:
{
  "archetypeName": "A short, stylish title (e.g. 'The Sentimental Cyber-Chaser', 'The Golden Shonen Vanguard', 'The Dream-Pop Star Gazer')",
  "archetypeTagline": "A single epic, poetic sentence defining their taste",
  "auraGradient": "A Tailwind CSS gradient pair of exactly two colors (e.g. 'from-cyan-500 to-indigo-600', 'from-rose-500 to-amber-500', 'from-[#12c2e9] to-[#c471ed]')",
  "musicPsychAnalysis": "A fun, beautifully detailed, high-quality paragraph (3-4 sentences) outlining their musical psyche, explaining exactly how their vibe spectrum values and selected favorites paint a picture of their personality.",
  "moodDimensionBreakdown": {
    "hypeLevel": "1-sentence stylish commentary about their hype level",
    "nostalgiaLevel": "1-sentence stylish commentary about their nostalgia era",
    "atmosphericVibe": "1-sentence stylish commentary about their atmospheric focus",
    "symphonicDepth": "1-sentence stylish commentary about their symphonic orchestration values",
    "vocalPresence": "1-sentence stylish commentary about their vocal intensity"
  },
  "aiCuratedRecommendations": [
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "animeName": "Anime Name",
      "type": "OP" | "ED" | "OST",
      "reason": "1-sentence poetic reason why this specific song matches their vibe and counts as a must-listen."
    }
  ]
}

Ensure the recommendations are highly tailored to their vibe weights and the response is strictly valid JSON format. Provide EXACTLY 3 song recommendations. Do NOT generate markdown format tags around the output.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    let text = response.text || "";
    // Sanitize any accidentally output markdown
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(text);
    res.json(parsed);

  } catch (error: any) {
    console.error("[Taste Analyzer API] Gemini error, returning fallback:", error);
    if (error.message && error.message.includes("quota")) {
      globalGeminiQuotaExceeded = true;
    }
    res.json(getHeuristicFallback());
  }
});

// Endpoint 2: Sound profile analyzer for a specific track (with Gemini)
app.post("/api/analyze-track", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const { title, artist, animeName, type } = req.body;
  
  if (!title || !animeName) {
    return res.status(400).json({ error: "title and animeName are required." });
  }

  // Robust Heuristic Fallback for Track Sound Profiler
  const getHeuristicTrackFallback = () => {
    // Basic estimations
    const isOP = type === "OP";
    const isED = type === "ED";
    const bpm = isOP ? 168 : isED ? 112 : 124;
    const estimatedKey = isOP ? "F# Minor / A Major (Active, Soaring)" : isED ? "E Major / C# Minor (Soft Sunset)" : "D Minor (Epic Atmosphere)";
    const tools = isOP ? "Soaring overdrive electric guitars, pounding double-kick drums, and a massive lead synthesiser loop." : isED ? "Calm acoustic steel guitars, deep analog bass synth pads, and reflective warm grand piano keys." : "Full symphonic brass, emotional backing violin ensembles, and dramatic hybrid electronic percussion beats.";
    
    return {
      title,
      artist: artist || "Unknown Artist",
      animeName,
      estimatedBpm: bpm,
      estimatedKey: estimatedKey,
      instrumentation: tools,
      harmonicVibe: isOP 
        ? "Powered by an energetic four-chord progression that resolves into an explosive major lift in the chorus, inspiring intense optimism."
        : "Built on slow minor-seventh chords that float suspended, creating a sense of safety, nostalgic release, or sweet sadness.",
      contextTrivia: `This specific ${type || "theme"} perfectly underscores the emotional core of "${animeName}". It serves as a visual and auditory bookmark, signaling the dramatic arrival of key storyboard arcs.`
    };
  };

  if (!process.env.GEMINI_API_KEY || globalGeminiQuotaExceeded) {
    return res.json(getHeuristicTrackFallback());
  }

  try {
    const safeTitle = sanitizeForPrompt(title, 200);
    const safeArtist = sanitizeForPrompt(artist || "Unknown", 200);
    const safeAnimeName = sanitizeForPrompt(animeName, 200);
    const safeType = sanitizeForPrompt(type || "OP Opening", 50);

    const prompt = `You are a professional music theorist, keyboardist, and anime soundscape cataloger.
Analyze the following anime track details:
- Title: "${safeTitle}"
- Artist: "${safeArtist}"
- Anime: "${safeAnimeName}"
- Song Role: "${safeType}"

Determine or estimate creative, high-accuracy musical attributes for this specific track. Use real musical knowledge of Japanese anime bands (J-Rock chords, anime ending tropes, orchestral backing compositions by Yuki Kajiura, Sawano, etc.) or provide a beautifully crafted estimation.

You must reply with a STRICT, raw JSON object (no backticks, markdown code block markers, or comments):
{
  "title": "${safeTitle}",
  "artist": "${safeArtist}",
  "animeName": "${safeAnimeName}",
  "estimatedBpm": 128,
  "estimatedKey": "Estimated chord/key center (e.g. 'F# Minor', 'C# Major - soaring minor lift')",
  "instrumentation": "A single stylish sentence listing the key instruments that define this song's sonic texture (guitars, organs, synth, backing orchestra, brass)",
  "harmonicVibe": "A fascinating 2-sentence description of the song's chord progression feeling, harmonic tension, and melodic resolution in the chorus.",
  "contextTrivia": "A 1-to-2 sentence interesting bit of trivia regarding the artist, the visual direction of this specific opening/ending sequence, or how its music syncs with the anime storyline."
}

Ensure the output is strictly valid JSON format. Do NOT wrap output in markdown blocks.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    let text = response.text || "";
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(text);
    res.json(parsed);

  } catch (error: any) {
    console.error("[Track Analyzer API] Gemini error, returning mock:", error);
    if (error.message && error.message.includes("quota")) {
      globalGeminiQuotaExceeded = true;
    }
    res.json(getHeuristicTrackFallback());
  }
});

async function startServer() {
// Endpoint to find an artist image using iTunes search and Jikan (MAL) fallbacks + extra metadata
app.get("/api/artist-image", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const artist = req.query.artist as string;
  if (!artist) return res.status(400).json({ error: "artist parameter is required" });

  const resultData: {
    imageUrl: string | null;
    bio?: string | null;
    birthday?: string | null;
    websiteUrl?: string | null;
    malUrl?: string | null;
  } = {
    imageUrl: null,
    bio: null,
    birthday: null,
    websiteUrl: null,
    malUrl: null
  };

  try {
    // Attempt 1: iTunes musicArtist search
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=musicArtist&limit=1`;
      const searchRes = await fetch(url);
      const data = await searchRes.json();
      if (data.results && data.results.length > 0) {
        const artistUrl = data.results[0].artistLinkUrl;
        const htmlRes = await fetch(artistUrl);
        const html = await htmlRes.text();
        const match = html.match(/<meta property="og:image" content="([^"]+)"/);
        if (match) {
          resultData.imageUrl = match[1].replace("1200x630cw.png", "600x600cw.png");
          resultData.websiteUrl = artistUrl;
        }
      }
    } catch (itunesErr) {
      console.warn("iTunes musicArtist fetch issue:", itunesErr);
    }

    // Attempt 2: Jikan MyAnimeList People backup (Great for Japanese voice actors, seiyuu, composers, anime singers)
    if (!resultData.imageUrl) {
      try {
        const jikanUrl = `https://api.jikan.moe/v4/people?q=${encodeURIComponent(artist)}&limit=1`;
        const jikanRes = await fetch(jikanUrl);
        const jikanData = await jikanRes.json();
        if (jikanData.data && jikanData.data.length > 0) {
          const person = jikanData.data[0];
          if (person.images?.jpg?.image_url && !person.images.jpg.image_url.includes("questionmark")) {
            resultData.imageUrl = person.images.jpg.image_url;
          }
          resultData.bio = person.about;
          resultData.birthday = person.birthday;
          resultData.websiteUrl = person.website_url || resultData.websiteUrl;
          resultData.malUrl = person.url;
        }
      } catch (jikanErr) {
        console.warn("Jikan people search issue:", jikanErr);
      }
    }

    // If we resolved Jikan but already had iTunes image, let's still fill metadata from Jikan
    if (resultData.imageUrl && !resultData.bio) {
      try {
        // Run a silent non-blocking meta-fetch to grab bios
        const jikanUrl = `https://api.jikan.moe/v4/people?q=${encodeURIComponent(artist)}&limit=1`;
        const jikanRes = await fetch(jikanUrl);
        const jikanData = await jikanRes.json();
        if (jikanData.data && jikanData.data.length > 0) {
          const person = jikanData.data[0];
          resultData.bio = person.about;
          resultData.birthday = person.birthday;
          resultData.websiteUrl = person.website_url || resultData.websiteUrl;
          resultData.malUrl = person.url;
        }
      } catch (e) {
        // absorb
      }
    }

    // Attempt 3: iTunes album art backup
    if (!resultData.imageUrl) {
      try {
        const albumUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=album&limit=1`;
        const albumRes = await fetch(albumUrl);
        const albumData = await albumRes.json();
        if (albumData.results && albumData.results.length > 0) {
          const artwork = albumData.results[0].artworkUrl100;
          if (artwork) {
            resultData.imageUrl = artwork.replace("100x100bb.", "600x600bb.");
          }
        }
      } catch (albumErr) {
        console.warn("iTunes album fallback issue:", albumErr);
      }
    }

    return res.json(resultData);
  } catch (error) {
    console.error("Failed to fetch artist image overall:", error);
    return res.json(resultData);
  }
});

// ---------------------------------------------------------------------------
// New data-source endpoints — AnimeThemes, AniList, MusicBrainz, Last.fm
// These complement the existing Jikan/iTunes/VGMdb/AniDB sources.
// ---------------------------------------------------------------------------

// AnimeThemes — the canonical anime theme music database.
// Returns flattened track candidates matching ANISYNC's AnimeTrack shape.
app.get("/api/animethemes-search", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const animeName = req.query.animeName as string;
  if (!animeName) return res.status(400).json({ error: "animeName is required" });
  try {
    const { searchThemesByAnime, flattenThemeResults } = await import('./src/utils/animeThemes');
    // No limit — let the user see ALL themes across all seasons/movies and pick which ones to import
    const results = await searchThemesByAnime(animeName, 10);
    const tracks = flattenThemeResults(results);
    res.json({ tracks, source: 'animethemes' });
  } catch (err: any) {
    console.error('[/api/animethemes-search] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AniList — anime + staff (artist) metadata. Free, no auth.
app.get("/api/anilist-search", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const { searchAnime } = await import('./src/utils/anilist');
    const results = await searchAnime(q, 8);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/anilist-anime", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const id = parseInt(req.query.id as string, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { getAnimeById } = await import('./src/utils/anilist');
    const anime = await getAnimeById(id);
    res.json({ anime });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/anilist-staff-works", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const id = parseInt(req.query.id as string, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { getStaffWorks } = await import('./src/utils/anilist');
    const works = await getStaffWorks(id, 25);
    res.json({ works });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/anilist-staff-search", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const { searchStaff } = await import('./src/utils/anilist');
    const results = await searchStaff(q, 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// MusicBrainz — ISRC/UPC dedup + cover art fallback.
// Note: strict 1 req/sec throttle is enforced inside the client.
app.get("/api/musicbrainz-recordings", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const title = req.query.title as string;
  const artist = req.query.artist as string;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const { searchRecordings } = await import('./src/utils/musicbrainz');
    const recordings = await searchRecordings(title, artist, 10);
    res.json({ recordings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/musicbrainz-cover-art", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const title = req.query.title as string;
  const artist = req.query.artist as string;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const { findCoverArt } = await import('./src/utils/musicbrainz');
    const url = await findCoverArt(title, artist);
    if (!url) return res.status(404).json({ error: "No cover art found" });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Last.fm — artist bio + similar artists + top tags (taste analysis).
// Requires LASTFM_API_KEY env var (gracefully returns 503 if not set).
app.get("/api/lastfm-artist", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const artist = req.query.artist as string;
  if (!artist) return res.status(400).json({ error: "artist is required" });
  if (!process.env.LASTFM_API_KEY) {
    return res.status(503).json({ error: "LASTFM_API_KEY not configured" });
  }
  try {
    const { getArtistInfo } = await import('./src/utils/lastfm');
    const info = await getArtistInfo(artist);
    if (!info) return res.status(404).json({ error: "Artist not found" });
    res.json({ artist: info });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/lastfm-similar", rateLimit(RATE_LIMIT_DEFAULT), requireAuth, async (req, res) => {
  const artist = req.query.artist as string;
  if (!artist) return res.status(400).json({ error: "artist is required" });
  if (!process.env.LASTFM_API_KEY) {
    return res.status(503).json({ error: "LASTFM_API_KEY not configured" });
  }
  try {
    const { getSimilarArtists } = await import('./src/utils/lastfm');
    const similar = await getSimilarArtists(artist, 8);
    res.json({ similar });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Auto Artist Lookup — smart cascade for tracks with "Unknown Artist".
//
// Moderators run this from the Moderation Dashboard → "Artist Lookup" tab to
// backfill missing artist names in bulk. The lookup tries, in order, the
// most authoritative sources for anime music:
//
//   1. AnimeThemes.moe  — canonical anime OP/ED/OST database. Best for
//                        animeName + title + type combos because its data
//                        is curated specifically for anime music. Returns
//                        `song.artists[].name` (with an `as` field for
//                        performance aliases).
//   2. iTunes Search API — returns `artistName` from official album releases.
//                         Best for songs that have been released on iTunes
//                         (most major anime OP/ED singles are).
//   3. MusicBrainz      — open metadata database. Returns recording artist
//                         credit. Useful for OSTs and niche releases not
//                         on iTunes.
//
// The cascade returns the FIRST non-Unknown result. If all sources return
// Unknown / empty, we return `artist: null` so the UI can show "no match".
//
// Results are cached in an LRU (keyed by anime|title|type) for 24h to avoid
// hammering the upstream APIs on repeated lookups of the same track.
// ---------------------------------------------------------------------------

const artistLookupCache = new LRU<string, { artist: string | null; source: string }>(1000, 24 * 60 * 60 * 1000);

function isUnknownArtist(s: string | null | undefined): boolean {
  if (!s) return true;
  const v = s.trim().toLowerCase();
  return (
    v === '' ||
    v === 'unknown' ||
    v === 'unknown artist' ||
    v === 'unknown performer' ||
    v === 'various' ||
    v === 'various artists' ||
    v === 'n/a' ||
    v === 'original artist' ||
    v === 'soundtrack composer' ||
    v === 'original composer'
  );
}

/**
 * Single-track artist lookup. Tries AnimeThemes → iTunes → MusicBrainz.
 * Returns { artist, source } — artist is null if no source could resolve it.
 *
 * The `type` param ('OP' | 'ED' | 'OST') is critical for AnimeThemes matching
 * because it disambiguates which theme song of an anime we're looking for.
 */
async function lookupArtistForTrack(
  animeName: string,
  title: string,
  type?: string,
): Promise<{ artist: string | null; source: string; candidates: Array<{ artist: string; source: string; confidence: number }> }> {
  const candidates: Array<{ artist: string; source: string; confidence: number }> = [];

  // ── Run the three sources in PARALLEL via Promise.allSettled ─────────
  // Previously these were sequential (AnimeThemes → iTunes → MusicBrainz)
  // which made the per-track worst case = sum of all three (~55s). Running
  // them concurrently makes it = max of any one source (~19s) — a ~3x
  // speedup on slow tracks and the main reason bulk lookups used to time
  // out the request handler.
  //
  // Each source is also wrapped in a 12s hard timeout via Promise.race so
  // a single hung fetch can never block the whole track.
  const targetTitle = title.trim().toLowerCase();
  const targetType = (type || '').toUpperCase();

  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>(resolve => setTimeout(() => {
        console.warn(`[lookupArtist] ${label} timed out after ${ms}ms — abandoning`);
        resolve(null);
      }, ms)),
    ]);

  const [atRes, itunesRes, mbRes] = await Promise.allSettled([
    withTimeout((async () => {
      const { searchThemesByAnime, flattenThemeResults } = await import('./src/utils/animeThemes');
      const results = await searchThemesByAnime(animeName, 5);
      const flat = flattenThemeResults(results);
      if (flat.length === 0) return null;
      let match =
        flat.find(
          (t) =>
            t.title.trim().toLowerCase() === targetTitle &&
            (targetType === '' || t.type === targetType),
        ) ||
        flat.find((t) => t.title.trim().toLowerCase() === targetTitle) ||
        flat.find(
          (t) =>
            t.title.trim().toLowerCase().includes(targetTitle) ||
            targetTitle.includes(t.title.trim().toLowerCase()),
        );
      if (match && !isUnknownArtist(match.artist)) {
        return { artist: match.artist, source: 'animethemes', confidence: 100 };
      }
      if (flat.length > 0 && !isUnknownArtist(flat[0].artist)) {
        return { artist: flat[0].artist, source: 'animethemes', confidence: 35 };
      }
      return null;
    })(), 12000, 'AnimeThemes'),

    withTimeout((async () => {
      const itunesQuery = `${title} ${animeName}`.trim();
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&limit=5&entity=song`;
      // Single attempt only in this path — the batch caller already paces
      // requests, and 3-attempt exponential backoff per track was the
      // main contributor to the old 55s-per-track worst case. If iTunes
      // is rate-limiting, return null and let MusicBrainz/AnimeThemes
      // fill the gap; the next batch will pick it up from cache.
      const r = await fetch(itunesUrl, {
        headers: { 'User-Agent': 'ANISYNC/1.0 (https://anisync.app)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const data: any = await r.json();
      const ranked = (data.results || [])
        .filter((r: any) => r.artistName && !isUnknownArtist(r.artistName))
        .map((r: any) => {
          const trackName = (r.trackName || '').trim().toLowerCase();
          let score = 0;
          if (trackName === targetTitle) score = 100;
          else if (trackName.startsWith(targetTitle)) score = 80;
          else if (trackName.includes(targetTitle)) score = 60;
          else if (targetTitle.includes(trackName)) score = 50;
          if ((r.collectionName || '').toLowerCase().includes(animeName.toLowerCase())) {
            score += 15;
          }
          return { artist: r.artistName, score };
        })
        .filter((r: any) => r.score > 0)
        .sort((a: any, b: any) => b.score - a.score);
      if (ranked.length === 0) return null;
      return { artist: ranked[0].artist, source: 'itunes', confidence: Math.min(95, ranked[0].score) };
    })(), 12000, 'iTunes'),

    withTimeout((async () => {
      const { searchRecordings } = await import('./src/utils/musicbrainz');
      const recordings = await searchRecordings(title, animeName, 5);
      const ranked = recordings
        .filter((r) => r.artist && !isUnknownArtist(r.artist))
        .map((r) => {
          const recTitle = (r.title || '').trim().toLowerCase();
          let score = 0;
          if (recTitle === targetTitle) score = 85;
          else if (recTitle.startsWith(targetTitle)) score = 70;
          else if (recTitle.includes(targetTitle)) score = 55;
          return { artist: r.artist as string, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
      if (ranked.length === 0) return null;
      return { artist: ranked[0].artist, source: 'musicbrainz', confidence: ranked[0].score };
    })(), 12000, 'MusicBrainz'),
  ]);

  // Note: Promise.allSettled never rejects — a thrown source becomes
  // { status: 'rejected', reason: ... } which we just log and skip.
  if (atRes.status === 'fulfilled' && atRes.value) candidates.push(atRes.value);
  else if (atRes.status === 'rejected') console.warn('[lookupArtist] AnimeThemes threw:', atRes.reason?.message);

  if (itunesRes.status === 'fulfilled' && itunesRes.value) candidates.push(itunesRes.value);
  else if (itunesRes.status === 'rejected') console.warn('[lookupArtist] iTunes threw:', itunesRes.reason?.message);

  if (mbRes.status === 'fulfilled' && mbRes.value) candidates.push(mbRes.value);
  else if (mbRes.status === 'rejected') console.warn('[lookupArtist] MusicBrainz threw:', mbRes.reason?.message);

  // ── Pick the best candidate ──────────────────────────────────────────
  candidates.sort((a, b) => b.confidence - a.confidence);
  if (candidates.length === 0) {
    return { artist: null, source: 'none', candidates: [] };
  }
  return { artist: candidates[0].artist, source: candidates[0].source, candidates };
}

app.post("/api/lookup-artist", rateLimit(RATE_LIMIT_DEFAULT), requireAdmin, async (req, res) => {
  const { animeName, title, type } = req.body;
  if (!animeName || !title) {
    return res.status(400).json({ error: "animeName and title are required." });
  }
  try {
    const cacheKey = `${animeName.trim().toLowerCase()}|${title.trim().toLowerCase()}|${(type || '').toUpperCase()}`;
    const cached = artistLookupCache.get(cacheKey);
    if (cached) {
      return res.json({ artist: cached.artist, source: cached.source, cached: true });
    }
    const result = await lookupArtistForTrack(animeName, title, type);
    artistLookupCache.set(cacheKey, { artist: result.artist, source: result.source });
    res.json({
      artist: result.artist,
      source: result.source,
      candidates: result.candidates,
    });
  } catch (err: any) {
    console.error('[/api/lookup-artist] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk lookup — takes an array of { id, animeName, title, type } and runs
 * lookups in concurrency-limited batches (5 at a time) so we don't blow
 * through rate limits on iTunes / MusicBrainz.
 *
 * Capped at 50 tracks per request — the CLIENT is now responsible for
 * chunking larger catalogs into 50-track batches with a 2s pause between
 * them (see ModerationDashboard.tsx → lookupAll). This makes the queue
 * rate-limit-safe for catalogs of any size.
 *
 * Returns a map: trackId → { artist, source }
 *
 * Admin-only — this is a moderately expensive operation.
 */
app.post("/api/lookup-artists-batch", rateLimit(RATE_LIMIT_AI), requireAdmin, async (req, res) => {
  const { tracks } = req.body as {
    tracks: Array<{ id: string; animeName: string; title: string; type?: string }>;
  };
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: "tracks array is required." });
  }
  // Cap lowered 50 → 8. With 3 parallel sources per track + per-source
  // 12s timeout + per-track Promise.allSettled semantics, a single track
  // takes ~12-19s worst case. 8 tracks / 4 concurrency = 2 chunks → 25s
  // overall worst case, comfortably under the 30s Render/Koyeb limit.
  // The client chunks the queue into 8-track batches with a 1.5s pause.
  if (tracks.length > 8) {
    return res.status(400).json({
      error: "Max 8 tracks per batch (was 50 — caused hosting-platform timeouts). Chunk your queue into 8-track batches on the client side.",
    });
  }

  // CONCURRENCY 5 → 4. With the per-source timeout of 12s and 3 sources
  // per track running in parallel (see lookupArtistForTrack), 4 tracks
  // in flight = up to 12 parallel upstream connections. That's already
  // at the iTunes polite-use limit. Going higher just triggers 429s.
  const CONCURRENCY = 4;
  const INTER_CHUNK_PAUSE_MS = 250;
  // Hard overall timeout — if we haven't finished all tracks in 25s,
  // return whatever we have so far. This guarantees the client always
  // gets a response before the hosting platform kills the request,
  // even if some upstream is hanging.
  const OVERALL_TIMEOUT_MS = 25_000;
  const results: Record<string, { artist: string | null; source: string }> = {};
  const startTime = Date.now();
  let timedOut = false;

  const overallTimer = new Promise<'timeout'>(resolve => {
    setTimeout(() => resolve('timeout'), OVERALL_TIMEOUT_MS);
  });

  const processAll = (async () => {
    for (let i = 0; i < tracks.length; i += CONCURRENCY) {
      if (timedOut) break;
      const chunk = tracks.slice(i, i + CONCURRENCY);
      // Promise.allSettled — one bad track can never reject the chunk.
      // Each individual lookupArtistForTrack already swallows source
      // errors, so this is a belt-and-suspenders guarantee.
      const chunkResults = await Promise.allSettled(
        chunk.map(async (t) => {
          const cacheKey = `${t.animeName.trim().toLowerCase()}|${t.title.trim().toLowerCase()}|${(t.type || '').toUpperCase()}`;
          const cached = artistLookupCache.get(cacheKey);
          if (cached) {
            return [t.id, cached] as const;
          }
          const r = await lookupArtistForTrack(t.animeName, t.title, t.type);
          const entry = { artist: r.artist, source: r.source };
          artistLookupCache.set(cacheKey, entry);
          return [t.id, entry] as const;
        }),
      );
      for (const settled of chunkResults) {
        if (settled.status === 'fulfilled') {
          const [id, entry] = settled.value;
          results[id] = entry;
        } else {
          console.warn('[/api/lookup-artists-batch] track threw:', settled.reason?.message);
        }
      }
      if (i + CONCURRENCY < tracks.length) {
        await new Promise(r => setTimeout(r, INTER_CHUNK_PAUSE_MS));
      }
    }
  })();

  // Race the processing against the overall timeout. Whichever resolves
  // first wins — if the timer fires first, we still respond with the
  // partial `results` we've collected so far instead of letting the
  // hosting platform kill the request.
  await Promise.race([processAll, overallTimer]).then(result => {
    if (result === 'timeout') {
      timedOut = true;
      console.warn(`[/api/lookup-artists-batch] hit ${OVERALL_TIMEOUT_MS}ms hard timeout — returning partial results (${Object.keys(results).length}/${tracks.length})`);
    }
  });

  const elapsed = Date.now() - startTime;
  res.json({
    results,
    partial: timedOut,
    elapsed_ms: elapsed,
    resolved_count: Object.keys(results).length,
    total_count: tracks.length,
  });
});

// ---------------------------------------------------------------------------
// Vibe Spectrum — derives a user's taste profile from real song tags.
//
// Replaces the old heuristic in UserProfileSection that used keyword matching
// on track titles + anime names (which falsely flagged any track with "moon"
// in the title as both nostalgic AND atmospheric).
//
// Flow:
//   1. Client sends a list of { id, title, artist, animeName, type } for the
//      user's favorite tracks + tracks in their custom playlists.
//   2. Server generates tags for each track via generateSongTags (Last.fm +
//      keyword analysis, with built-in 1h cache + 200ms rate limit between
//      Last.fm calls).
//   3. Aggregates tag counts across all tracks.
//   4. Maps tag distribution → 5 vibe categories (0-100 each):
//        nostalgia:      Retro, Nostalgic, Bittersweet + classic-anime bias
//        hype:           Hype, Epic, Energetic, Aggressive, Fast, Driving
//        atmospheric:    Chill, Melancholic, Sad, Dreamy, Ambient, Serene
//        symphonic:      Orchestral, Classical, Instrumental, Acoustic
//        vocalIntensity: Powerful Vocals, Emotional, Anthemic + vocal tags
//
// Cached server-side for 24h keyed by the sorted track-ID list, so re-opening
// the profile doesn't re-fetch Last.fm for the same tracks.
//
// Auth: requireAuth (any signed-in user can compute their own vibe).
// ---------------------------------------------------------------------------

const vibeCache = new LRU<string, any>(500, 24 * 60 * 60 * 1000); // 500 users, 24h TTL

interface VibeInput {
  id: string;
  title: string;
  artist: string;
  animeName: string;
  type: string;
}

app.post("/api/vibe-spectrum", rateLimit(RATE_LIMIT_AI), requireAuth, async (req, res) => {
  const tracks = req.body?.tracks as VibeInput[];
  if (!Array.isArray(tracks) || tracks.length === 0) {
    // Empty input — return a neutral 50/50/50/50/50 vibe so the radar renders.
    return res.json({
      vibe: { nostalgia: 50, hype: 50, atmospheric: 50, symphonic: 50, vocalIntensity: 50 },
      tagCounts: {},
      trackCount: 0,
      cached: false,
    });
  }
  if (tracks.length > 100) {
    return res.status(400).json({ error: "Max 100 tracks per vibe request." });
  }

  // Cache key — sorted unique track IDs. Stable across re-orderings.
  const cacheKey = Array.from(new Set(tracks.map(t => t.id))).sort().join('|');
  const cached = vibeCache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const { generateSongTagsForTracks } = await import('./src/utils/songTags');
    const tagArrays = await generateSongTagsForTracks(
      tracks.map(t => ({ title: t.title, artist: t.artist || '', animeName: t.animeName || '', type: t.type || 'OP' })),
    );

    // Tally tag counts across all tracks.
    const tagCounts: Record<string, number> = {};
    for (const tags of tagArrays) {
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Helper: sum counts for a set of tag names (case-sensitive — tags are
    // canonicalized by generateSongTags so they always come back in Title Case).
    const sumTags = (tagNames: string[]): number => {
      let total = 0;
      for (const t of tagNames) {
        total += tagCounts[t] || 0;
      }
      return total;
    };

    // ── Map tag counts → 5 vibe axes ────────────────────────────────────
    // Each axis sums the counts of its relevant tags. The maximum possible
    // count on any axis is roughly trackCount * 4 (each track can contribute
    // up to ~4 tags per axis). We normalize to 0-100 by dividing by an
    // empirical soft-cap.
    const trackCount = tracks.length;
    const SOFT_CAP = Math.max(3, trackCount * 1.5); // prevents max-100 spike on tiny libraries

    const nostalgiaTags = ['Nostalgic', 'Bittersweet', 'Brooding'];
    const hypeTags = ['Hype', 'Epic', 'Energetic', 'Aggressive', 'Intense', 'Fast', 'Driving', 'Anthemic', 'Triumphant', 'Tense'];
    const atmosphericTags = ['Chill', 'Melancholic', 'Sad', 'Dreamy', 'Ambient', 'Serene', 'Mysterious', 'Whimsical', 'Romantic', 'Hopeful'];
    const symphonicTags = ['Orchestral', 'Classical', 'Instrumental', 'Acoustic', 'Choir'];
    const vocalTags = ['Male Vocal', 'Female Vocal', 'Group Vocal', 'Duet', 'Falsetto', 'Rap', 'Screamo'];

    const norm = (count: number): number =>
      Math.min(100, Math.max(10, Math.round((count / SOFT_CAP) * 100)));

    const nostalgia = norm(sumTags(nostalgiaTags));
    const hype = norm(sumTags(hypeTags));
    const atmospheric = norm(sumTags(atmosphericTags));
    const symphonic = norm(sumTags(symphonicTags));
    // Vocal intensity: vocal tags + emotional mood tags boost the score.
    const vocalIntensity = norm(sumTags(vocalTags) + (tagCounts['Emotional'] || 0) + (tagCounts['Uplifting'] || 0));

    const vibe = { nostalgia, hype, atmospheric, symphonic, vocalIntensity };
    const payload = { vibe, tagCounts, trackCount };

    vibeCache.set(cacheKey, payload);
    res.json({ ...payload, cached: false });
  } catch (err: any) {
    console.error('[/api/vibe-spectrum] error:', err.message);
    res.status(500).json({
      error: err.message,
      vibe: { nostalgia: 50, hype: 50, atmospheric: 50, symphonic: 50, vocalIntensity: 50 },
      tagCounts: {},
      trackCount: tracks.length,
    });
  }
});

  // Initialize Helmet + Firebase Admin inside startServer (these need async
  // init and were previously top-level awaits which broke the CJS bundle).
  try { helmet = (await import("helmet")).default; } catch { /* optional dep */ }
  installHelmet(app);

  try {
    // firebase-admin is a CJS module with no ESM entry point. When bundled with
    // esbuild as CJS, `await import("firebase-admin")` returns a namespace
    // object where the actual module exports live under `.default`. We unwrap
    // it here so `admin.credential.cert(sa)` works.
    // See: https://github.com/firebase/firebase-admin-node/issues/1061
    const adminMod: any = await import("firebase-admin");
    const admin: any = adminMod.default ?? adminMod;
    // Note: admin.apps may be undefined on first load in some environments.
    // Use optional chaining + nullish coalescing to avoid the
    // "Cannot read properties of undefined (reading 'length')" error.
    const existingApps = admin.apps ?? [];
    if (existingApps.length === 0) {
      // Three ways to provide Firebase Admin credentials (tried in order):
      //
      // 1. FIREBASE_SERVICE_ACCOUNT = JSON string (Netlify, Vercel, Render —
      //    PaaS where you can only set env vars, not upload files).
      //
      // 2. GOOGLE_APPLICATION_CREDENTIALS = file path (local dev, Oracle VM,
      //    GCP — where you can upload a JSON file). We read the file ourselves
      //    and pass it to credential.cert() — more reliable than
      //    applicationDefault() which has known issues on Windows with
      //    relative paths.
      //
      // 3. Fall back to applicationDefault() (GCP metadata server, etc.).
      const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (saJson) {
        const sa = JSON.parse(saJson);
        // Fix the #1 cause of credential errors: private_key has literal \n
        // (backslash + n) instead of actual newlines. This happens because
        // .env files and shell env vars often don't process escape sequences.
        if (sa.private_key && typeof sa.private_key === 'string') {
          sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        }
        admin.initializeApp({
          credential: admin.credential.cert(sa),
        });
        console.log("[Auth] firebase-admin initialized from FIREBASE_SERVICE_ACCOUNT env var.");
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Read the file directly and parse the JSON — avoids the Windows
        // relative-path bug in applicationDefault().
        const fs = await import("fs");
        const path = await import("path");
        const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        // ALWAYS use an absolute path — applicationDefault() and fs.readFileSync
        // resolve relative paths against process.cwd(), which differs on Windows.
        const fullPath = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${fullPath}`);
        }
        const fileContent = fs.readFileSync(fullPath, "utf-8");
        const sa = JSON.parse(fileContent);
        // Defensive: fix \n escaping even when reading from a file (some editors
        // mangle the private_key when saving).
        if (sa.private_key && typeof sa.private_key === 'string') {
          sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        }
        admin.initializeApp({
          credential: admin.credential.cert(sa),
        });
        console.log(`[Auth] firebase-admin initialized from file: ${fullPath}`);
      } else {
        // Last resort: GCP metadata server / ambient ADC.
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
        console.log("[Auth] firebase-admin initialized from applicationDefault().");
      }
    }
    adminAuth = admin.auth();
  } catch (err: any) {
    console.warn("[Auth] firebase-admin not initialized. Auth-protected endpoints will 401.");
    console.warn("[Auth]   Set either GOOGLE_APPLICATION_CREDENTIALS (file path) or FIREBASE_SERVICE_ACCOUNT (JSON string) env var.");
    console.warn("[Auth]   Error:", err.message);
    if (err.stack) {
      console.warn("[Auth]   Stack:", err.stack.split('\n').slice(0, 5).join('\n'));
    }
  }

  // ---------------------------------------------------------------------------
  // Vite dev middleware / static serving / HTTP server — ONLY when running as
  // a standalone server (NOT on Netlify). On Netlify, the function wrapper
  // (netlify/functions/api.ts) handles request dispatch; static files are
  // served by Netlify's CDN directly from dist/.
  // ---------------------------------------------------------------------------
  if (!process.env.NETLIFY) {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath, {
        maxAge: '1h',
        etag: true,
        setHeaders: (res, filePath) => {
          // Hashed assets in /assets can be cached aggressively.
          if (filePath.includes(path.join('dist', 'assets'))) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    const server = http.createServer(app);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    });

    // ---------------------------------------------------------------------------
    // Graceful shutdown — give in-flight Gemini/scraping requests up to 25s to
    // finish (Cloud Run gives 60s; we leave headroom).
    // ---------------------------------------------------------------------------
    const SHUTDOWN_TIMEOUT_MS = 25_000;
    let shuttingDown = false;
    function shutdown(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[Server] ${signal} received. Shutting down gracefully (max ${SHUTDOWN_TIMEOUT_MS}ms).`);
      server.close((err) => {
        if (err) console.error("[Server] Error closing server:", err);
        process.exit(err ? 1 : 0);
      });
      setTimeout(() => {
        console.warn("[Server] Forcing exit after shutdown timeout.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref?.();
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
      console.error('[Server] Unhandled promise rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[Server] Uncaught exception:', err);
      // Don't exit immediately — let in-flight requests finish if possible.
      // The next SIGTERM/SIGINT or a follow-up error will terminate.
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point — only start the standalone server when NOT running on Netlify.
// On Netlify, the Express `app` is imported by netlify/functions/api.ts and
// wrapped with serverless-http. The startServer() call above still runs to
// register routes + init Helmet/Firebase Admin, but the listen() is skipped.
// ---------------------------------------------------------------------------
if (!process.env.NETLIFY) {
  startServer().catch((err) => {
    console.error("[Server] Failed to start:", err);
    process.exit(1);
  });
} else {
  // On Netlify — fire startServer() to register routes + init, but don't exit
  // on error (the function can still serve unauthenticated endpoints).
  startServer().catch((err) => {
    console.error("[Server] Init error (non-fatal on Netlify):", err);
  });
}

// Export the Express app for the Netlify serverless function wrapper.
export { app };
