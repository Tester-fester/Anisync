import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      // Default is 500 KB; the app has a legitimately large main chunk
      // (Firebase + motion + recharts + lucide). Raising slightly silences
      // the warning without lying about the size. Real wins come from the
      // manualChunks split below.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // Split vendor deps into stable, cacheable chunks so a single
          // app-code change doesn't bust the user's firebase/recharts cache.
          manualChunks: {
            // Firebase client SDK is huge and rarely changes — isolate it.
            // NOTE: firebase-admin is server-only (used by server.ts). It is
            // NOT bundled for the browser — never add it here, or Vite will
            // try to bundle it and pull in WASM deps (farmhash-modern) that
            // fail in the browser.
            'vendor-firebase': [
              'firebase/app',
              'firebase/auth',
              'firebase/firestore',
            ],
            // Charts are heavy and only used on profile pages.
            'vendor-charts': ['recharts'],
            // Animation lib used everywhere.
            'vendor-motion': ['motion'],
            // Icons — Phosphor (via @/utils/icons shim, bold weight default).
            // Tree-shaken but still benefits from a stable chunk.
            'vendor-icons': ['@phosphor-icons/react'],
            // Toast + confetti are loaded on demand for gamification.
            'vendor-feedback': ['sonner', 'canvas-confetti'],
          },
        },
      },
    },
  };
});
