/* AniSync v12.1 runtime patches — YouTube embed engine + request diet +
 * hash navigation.
 *
 * Rebuilt after the backup regression: this file had decayed to the v4-era
 * 72-line watcher (one blind swap per video, first candidate wins, no
 * disambiguation). v12 restored the FIXES.md §17/§18 semantics on top of the
 * v12 server; v12.1 adds the client half of the NAS request diet.
 *
 *  1. EMBED ERROR WATCHER (works on any iframe with enablejsapi=1 — the
 *     GlobalPlayer builds its src with it).
 *       - Hard codes (2 invalid id / 5 player error / 100 removed / 101
 *         embed-blocked) condemn in EVERY environment: an ad blocker cannot
 *         fake those. -> repair immediately + report to /api/embed-feedback-batch.
 *         (Error 100 was the gap that made the v4 engine sit idle while the
 *         player cycled through dead tracks — “link selection broken”.)
 *       - Error 150 is AMBIGUOUS (ad blockers manufacture it on ad-bearing
 *         videos). Before churning the track, the patch cross-checks the
 *         server's multi-signal verdict (/api/verify-video): server-alive ->
 *         NO database churn, just a "Watch on YouTube" pill (v11 §18.1
 *         positive-only policy). Server-dead -> repair.
 *       - A video that already reached PLAYING state before erroring is
 *         treated as ad-churn, not a dead link.
 *       - Repair: POST /api/embed-fallback (v2) -> the server returns
 *         ONLY probe-verified candidates (v12.1: InnerTube playability is
 *         authoritative, so region/auth-dead videos can never be picked)
 *         sorted by the points system; the patch picks candidates[0], swaps
 *         the iframe src (keeping query params), then confirms so the DB
 *         persists the replacement. Max 3 hops per track per session;
 *         failures fall back to the Watch-on-YouTube pill.
 *  2. REQUEST DIET (v12.1) — the SPA polls /api/db/tracks + /history (+
 *     tournaments/users/proposals) every few seconds, and two components
 *     often poll the SAME url concurrently (the doubled XHR pairs in the
 *     field log) while /api/auth/refresh fires twice per cycle. A fetch()
 *     interceptor now: serves GETs from a 4s in-memory snapshot cache,
 *     coalesces identical in-flight GETs into one network call, and
 *     single-flights auth/refresh. Combined with the server's ETag/max-age
 *     conditional-GETs, the storm costs the NAS ~nothing. Analytics beacons
 *     (plausible) are stubbed out — the script tag was removed from
 *     index.html; this is belt-and-braces.
 *  3. HASH NAVIGATION (#arena, #tournament, #leaderboard, #moderation,
 *     #submissions, #profile) with back/forward support — clicks the SPA's
 *     real tab buttons (#tab-<route>-btn) so no app internals are touched.
 *
 * Debug hook: window.__anisyncPatchesV12__
 */
(function () {
  'use strict';
  if (window.__ANISYNC_STABLE_PATCHES__) return;
  window.__ANISYNC_STABLE_PATCHES__ = true;

  var LOG = '[AniSync]';
  var MAX_HOPS_PER_TRACK = 3;

  // Deployment canary — one glance at the console answers “did the new
  // engine actually land?”. The v12.1 server reports the same stamp at
  // /health ("engine":"12.1").
  console.info(LOG + ' v12.1 engine online — error-100 repair, ' +
    'points-verified swaps, request diet, hash nav.');

  // videoId -> true while a repair for that id is in flight
  var inFlight = {};
  // trackKey (trackId or videoId) -> hop count this session
  var hops = {};
  // videoId -> last "repair refused" timestamp (cooldown mirror of the server)
  var refusedAt = {};
  // videoId -> true once the player reached PLAYING for that id
  var playedLatch = {};

  var stats = {
    errorsSeen: 0,
    adBlocker150s: 0,
    repairs: 0,
    suppressedChurns: 0,
    watchFallbacks: 0,
    lastReceipt: null,
    dietCacheHits: 0,
    dietCoalesced: 0
  };
  window.__anisyncPatchesV12__ = { version: '12.1', stats: stats, hops: hops };

  // ---------------------------------------------------------------------------
  // REQUEST DIET (v12.1) — fetch() interception for the API poll storm.
  // The app is 100% fetch-based (apiFetch wrapper + raw refresh calls), so
  // one choke point covers everything. POSTs that must stay fresh (votes,
  // verify-batch, embed-fallback) are passed through untouched.
  // ---------------------------------------------------------------------------
  (function installRequestDiet() {
    if (typeof window.fetch !== 'function' || typeof window.Response !== 'function') return;

    var DB_GET_RE = /\/api\/db\/(tracks|history|tournaments|users|proposals|artist-profiles)(\?|$)/;
    var REFRESH_RE = /\/api\/auth\/refresh/;
    var GET_TTL_MS = 4000;   // seconds of staleness nobody can perceive
    var SNAP_MAX = 16;       // bounded memory on long sessions

    var snaps = {};          // url -> {t, txt, status, ct}
    var netInflight = {};    // url -> Promise (resolves AFTER the snapshot is stored)
    var origFetch = window.fetch.bind(window);

    function trimSnaps() {
      var keys = Object.keys(snaps);
      for (var k = 0; k < keys.length - SNAP_MAX; k++) delete snaps[keys[k]];
    }

    function serveSnapshot(url) {
      var s = snaps[url];
      if (!s) {
        // Only reachable if the snapshot write itself failed (bizarre stream
        // error). Fail loudly for the coalesced caller rather than mis-issue
        // a fresh request with the wrong method — the original caller's
        // response already went through, and every fetch consumer here has
        // its own catch path.
        return Promise.reject(new Error('anisync diet: snapshot unavailable'));
      }
      // Null-body statuses (204/304) cannot carry a body in the Response
      // constructor — construct those with null. (Our list endpoints always
      // answer 200, this is just defensive.)
      var body = (s.status === 204 || s.status === 205 || s.status === 304) ? null : s.txt;
      return Promise.resolve(new Response(body, {
        status: s.status,
        headers: { 'Content-Type': s.ct }
      }));
    }

    function startMonitoredGet(url, input, init) {
      var p = origFetch(input, init).then(function (res) {
        var mirror = res.clone();
        return mirror.text().then(function (txt) {
          try {
            snaps[url] = {
              t: Date.now(),
              txt: txt,
              status: res.status,
              ct: (res.headers && res.headers.get && res.headers.get('content-type')) || 'application/json'
            };
            trimSnaps();
          } catch (e) { /* caching must never break the app */ }
          return res;
        }, function () {
          // Body unreadable — still store a status-only snapshot so coalesced
          // callers get a coherent (if empty) response instead of a reject.
          try {
            snaps[url] = {
              t: Date.now(),
              txt: '',
              status: res.status,
              ct: 'application/json'
            };
            trimSnaps();
          } catch (e) {}
          return res;
        });
      });
      netInflight[url] = p;
      var clear = function () { delete netInflight[url]; };
      p.then(clear, clear);
      return p;
    }

    window.fetch = function (input, init) {
      var url = '';
      var method = 'GET';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
        var m = (init && init.method) || (input && typeof input.method === 'string' ? input.method : '') || 'GET';
        method = String(m).toUpperCase();
      } catch (e) { return origFetch(input, init); }

      // Hot list GETs: TTL snapshot cache + in-flight coalescing.
      if (method === 'GET' && DB_GET_RE.test(url)) {
        var s = snaps[url];
        if (s && Date.now() - s.t < GET_TTL_MS) {
          stats.dietCacheHits++;
          return serveSnapshot(url);
        }
        if (netInflight[url]) {
          stats.dietCoalesced++;
          return netInflight[url].then(function () { return serveSnapshot(url); });
        }
        return startMonitoredGet(url, input, init);
      }

      // auth/refresh: two independent timers double-fire it per cycle; merge
      // concurrent refreshes into one round trip (the snapshot replay keeps
      // every caller's .json() contract intact).
      if (method === 'POST' && REFRESH_RE.test(url)) {
        if (netInflight[url]) {
          stats.dietCoalesced++;
          return netInflight[url].then(function () { return serveSnapshot(url); });
        }
        return startMonitoredGet(url, input, init);
      }

      return origFetch(input, init);
    };

    // Analytics beacons: the plausible script tag was removed from
    // index.html (LAN deployment — no reason to phone home). If any stray
    // call survives, make it a silent noop instead of a network request.
    // Guarded so a re-enabled real script (loaded before this one, defer
    // order) is left alone.
    if (typeof window.plausible !== 'function') {
      window.plausible = function () { return { destroy: function () {} }; };
    }
  })();

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.ok ? res.json() : null; });
  }

  function extractVideoId(iframe) {
    var m = (iframe.getAttribute('src') || '').match(/\/embed\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  function findIframeBySource(win) {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === win) return frames[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Watch-on-YouTube fallback pill
  // ---------------------------------------------------------------------------
  function showWatchOnYoutube(iframe, videoId, hint) {
    if (!iframe || !iframe.parentNode || !videoId) return;
    var host = iframe.parentNode;
    if (host.querySelector('.anisync-watch-pill')) return; // one pill per player

    var pill = document.createElement('div');
    pill.className = 'anisync-watch-pill';
    pill.setAttribute('style',
      'position:absolute;top:8px;right:8px;z-index:40;display:flex;align-items:center;gap:8px;' +
      'background:rgba(7,7,10,0.92);border:1px solid rgba(255,255,255,0.18);border-radius:8px;' +
      'padding:6px 10px;font:700 11px/1.2 ui-monospace,monospace;color:#fff;cursor:default;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.55);pointer-events:auto;');

    var label = document.createElement('span');
    label.setAttribute('style', 'color:#c9c9d4;text-transform:uppercase;letter-spacing:0.06em;');
    label.textContent = hint || 'Player blocked';

    var link = document.createElement('a');
    link.href = 'https://www.youtube.com/watch?v=' + videoId;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('style',
      'color:#ff3d2e;text-decoration:none;text-transform:uppercase;letter-spacing:0.06em;cursor:pointer;');
    link.textContent = 'Watch on YouTube \u2197';

    var close = document.createElement('span');
    close.textContent = '\u2715';
    close.setAttribute('style', 'color:#7a7a85;cursor:pointer;padding-left:2px;');
    close.onclick = function () { if (pill.parentNode) pill.parentNode.removeChild(pill); };

    pill.appendChild(label);
    pill.appendChild(link);
    pill.appendChild(close);
    host.appendChild(pill);
    stats.watchFallbacks++;
    console.warn(LOG + ' No working embed found — offering Watch-on-YouTube for ' + videoId);
  }

  // ---------------------------------------------------------------------------
  // Repair chain: /api/embed-fallback v2 -> swap -> confirm
  // ---------------------------------------------------------------------------
  function repairStream(iframe, currentVid, code) {
    if (inFlight[currentVid]) return;
    inFlight[currentVid] = true;

    post('/api/embed-fallback', { videoId: currentVid, code: code, v: 2 }).then(function (data) {
      if (!data) { done(); return; }
      if (data.candidates && data.candidates.length > 0) {
        var best = data.candidates[0];
        if (best && best.videoId && best.videoId !== currentVid) {
          var trackKey = data.trackId || currentVid;
          hops[trackKey] = (hops[trackKey] || 0) + 1;
          if (hops[trackKey] > MAX_HOPS_PER_TRACK) {
            showWatchOnYoutube(iframe, currentVid, 'Repair limit reached');
            done(); return;
          }

          // Receipt (FIXES.md §18.3) — the server's points race, logged.
          var receipt = (best.points && best.points.join(', ')) || 'no receipt';
          stats.lastReceipt = { videoId: best.videoId, score: best.score, points: receipt };
          console.log(
            LOG + ' [POINTS] ' + (best.title || best.videoId) +
            ' | ' + receipt + ' | score ' + best.score + 's | via ' + (best.via || 'embed')
          );

          if (!iframe.isConnected) { done(); return; }
          var src = iframe.getAttribute('src') || '';
          var newSrc = src.replace('/embed/' + currentVid, '/embed/' + best.videoId);
          iframe.setAttribute('src', newSrc);
          stats.repairs++;
          console.log(LOG + ' Swapped ' + currentVid + ' -> ' + best.videoId);

          // Persist the confirmed replacement (fire-and-forget).
          post('/api/embed-fallback', {
            videoId: currentVid,
            trackId: data.trackId,
            confirmId: best.videoId,
            code: code,
            v: 2
          }).catch(function () {});
        } else {
          showWatchOnYoutube(iframe, currentVid, 'No replacement found');
        }
      } else if (data.candidates && data.candidates.length === 0) {
        // Cooldown / nothing above the points floor: do not hammer the NAS.
        refusedAt[currentVid] = Date.now();
        showWatchOnYoutube(iframe, currentVid, data.cooldown ? 'Repair cooldown' : 'No replacement found');
      }
      done();
    }).catch(function () {
      refusedAt[currentVid] = Date.now();
      done();
    });

    function done() { delete inFlight[currentVid]; }
  }

  function reportToServer(videoId, code) {
    // Hard failures only — an ad blocker cannot manufacture 2/5/100/101, so
    // these reports are trustworthy and teach future audits (v8 policy).
    post('/api/embed-feedback-batch', { reports: [{ videoId: videoId, code: code }] })
      .catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // Error 150 disambiguation: ask the server before churning (v11 §18.1)
  // ---------------------------------------------------------------------------
  function handleAmbiguous150(iframe, currentVid) {
    if (playedLatch[currentVid]) {
      // This stream demonstrably played here before erroring — classic
      // ad-blocker mid-roll churn. No DB churn, just the escape hatch.
      stats.adBlocker150s++;
      stats.suppressedChurns++;
      showWatchOnYoutube(iframe, currentVid, 'Playback interrupted');
      return;
    }
    fetch('/api/verify-video?id=' + encodeURIComponent(currentVid))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (v) {
        if (!v) { repairStream(iframe, currentVid, 150); return; }
        if (v.alive) {
          // Server's multi-signal probe says the embed is healthy -> the 150
          // is local (ad blocker). Positive-only: never churn, never report.
          stats.adBlocker150s++;
          stats.suppressedChurns++;
          console.info(LOG + ' Error 150 on ' + currentVid + ' contradicted by server (' +
            (v.state || 'ok') + ') — ad-blocker noise, no repair.');
          showWatchOnYoutube(iframe, currentVid, 'Blocked by ad filter');
        } else {
          console.warn(LOG + ' Error 150 on ' + currentVid + ' confirmed dead server-side (' +
            (v.reason || v.state || '') + ').');
          repairStream(iframe, currentVid, 150);
        }
      })
      .catch(function () {
        // Server unreachable: fall back to repairing (old behavior), but the
        // server-side cooldown prevents hammering.
        repairStream(iframe, currentVid, 150);
      });
  }

  // ---------------------------------------------------------------------------
  // YouTube postMessage listener
  // ---------------------------------------------------------------------------
  window.addEventListener('message', function (e) {
    if (typeof e.origin !== 'string' || e.origin.indexOf('youtube') === -1) return;

    var d;
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch (err) {
      return;
    }
    if (!d || typeof d !== 'object') return;

    if (d.event === 'onStateChange' && d.info === 1) {
      // 1 = PLAYING — latch the health signal for this id.
      var f = findIframeBySource(e.source);
      var latchedVid = f ? extractVideoId(f) : '';
      if (latchedVid) playedLatch[latchedVid] = true;
      return;
    }

    if (d.event !== 'onError') return;
    var code = d.info;
    if (code !== 101 && code !== 150 && code !== 2 && code !== 5 && code !== 100) return;

    var iframe = findIframeBySource(e.source);
    if (!iframe) return;
    var currentVid = extractVideoId(iframe);
    if (!currentVid) return;

    stats.errorsSeen++;
    console.warn(LOG + ' YouTube error ' + code + ' on ' + currentVid);

    // 150 is the only code an ad blocker fakes; everything else is hard-dead.
    if (code === 150) {
      handleAmbiguous150(iframe, currentVid);
      return;
    }

    if (refusedAt[currentVid] && Date.now() - refusedAt[currentVid] < 60000) return;
    reportToServer(currentVid, code);
    repairStream(iframe, currentVid, code);
  });

  // ---------------------------------------------------------------------------
  // Hash page navigation (#arena, #tournament, ...) with back/forward support
  // ---------------------------------------------------------------------------
  var ROUTES = ['leaderboard', 'arena', 'tournament', 'moderation', 'submissions', 'profile'];
  var suppressHash = null;

  function tabButton(route) {
    return document.getElementById('tab-' + route + '-btn');
  }

  function navigateFromHash(hash) {
    var route = (hash || '').replace(/^#/, '').replace(/\/$/, '');
    if (ROUTES.indexOf(route) === -1) return;
    var btn = tabButton(route);
    if (btn) {
      btn.click();
      window.scrollTo(0, 0);
      console.info(LOG + ' Navigated to #' + route);
    }
  }

  window.addEventListener('hashchange', function () {
    var hash = window.location.hash;
    if (hash === suppressHash) { suppressHash = null; return; }
    navigateFromHash(hash);
  });

  // Keep the URL in sync when the user clicks the SPA's own tab buttons, so
  // back/forward and page reloads restore the view.
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn) return;
    var m = (btn.id || '').match(/^tab-([a-z_]+)-btn$/);
    if (!m || ROUTES.indexOf(m[1]) === -1) return;
    suppressHash = '#' + m[1];
    if (window.location.hash !== '#' + m[1]) window.location.hash = m[1];
    // If the SPA already sits on this hash, hashchange won't fire — clear now.
    if (window.location.hash !== '#' + m[1]) suppressHash = null;
  }, true);

  // Restore deep-linked view after the SPA mounts (buttons may not exist at
  // script-eval time — retry briefly).
  var navTries = 0;
  var navTimer = setInterval(function () {
    navTries++;
    if (!window.location.hash || tabButton('arena') || navTries > 40) {
      if (window.location.hash && navTries <= 40) navigateFromHash(window.location.hash);
      clearInterval(navTimer);
    } else if (window.location.hash) {
      navigateFromHash(window.location.hash);
      if (tabButton((window.location.hash || '').replace(/^#/, ''))) clearInterval(navTimer);
    }
  }, 500);

  console.log(LOG + ' v12.1 stable player engine initialized (error-100 repair, points-verified swaps, ' +
    '150 disambiguation, watch-on-YouTube fallback, request diet, hash navigation).');
})();
