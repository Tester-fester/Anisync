import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initTactileAudioGlobal } from './utils/tactileAudio';
import { initAudio } from './utils/howlerAudio';
import { ErrorBoundary } from './components/ErrorBoundary';

// Register the global tactile click listener + the gesture-unlock listener
// for the SFX engine. Neither creates an AudioContext on load — the context
// is created lazily inside SfxEngine.init() on the FIRST user gesture,
// which complies with browser autoplay policies.
initTactileAudioGlobal();
initAudio();

// ---------------------------------------------------------------------------
// Auto-reload on stale chunk errors (Netlify/Cloudflare Pages)
// ---------------------------------------------------------------------------
// When you redeploy, the old HTML in a user's browser references old chunk
// filenames (e.g. TournamentBracket-6M82lBqA.js) that no longer exist on the
// server. The SPA fallback returns index.html (MIME text/html), which the
// browser rejects with "disallowed MIME type" / "error loading dynamically
// imported module". This listener detects those errors and force-reloads the
// page ONCE so the browser fetches the fresh HTML with the new chunk hashes.
let reloadedForChunkError = false;
window.addEventListener('error', (event) => {
  const target = event.target as any;
  // Dynamic import failures surface on event.target (the script/link tag),
  // not on event.message. Check for the typical signatures.
  if (target?.tagName === 'SCRIPT' || target?.tagName === 'LINK') {
    const src = target.href || target.src || '';
    if (src.includes('/assets/') && !reloadedForChunkError) {
      reloadedForChunkError = true;
      console.warn('[ChunkLoader] Stale chunk detected, reloading for fresh HTML...', src);
      // Force reload — bypass cache
      window.location.reload();
    }
  }
});

// Also catch the "error loading dynamically imported module" TypeError
// which fires on window (not on a specific element).
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = (reason?.message || String(reason || '')).toLowerCase();
  if (
    !reloadedForChunkError &&
    (msg.includes('error loading dynamically imported module') ||
     msg.includes('failed to fetch dynamically imported module') ||
     msg.includes('disallowed mime type'))
  ) {
    reloadedForChunkError = true;
    console.warn('[ChunkLoader] Dynamic import failed, reloading for fresh HTML...');
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
