import React, { Component, ErrorInfo, ReactNode } from 'react';

/**
 * Global error boundary — prevents a single component crash from
 * white-screening the entire app. Renders a recoverable fallback with a
 * "reload" button.
 *
 * Also detects stale chunk errors ("error loading dynamically imported module")
 * and auto-reloads the page ONCE to fetch fresh HTML with new chunk hashes.
 * This happens when you redeploy on Netlify — old HTML references old chunk
 * filenames that no longer exist on the server.
 */
interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}
interface State {
  error: Error | null;
  isChunkError: boolean;
}

const STALE_CHUNK_PATTERNS = [
  'error loading dynamically imported module',
  'failed to fetch dynamically imported module',
  'disallowed mime type',
  'importing a module script failed',
];

function isStaleChunkError(error: Error): boolean {
  const msg = (error.message || '').toLowerCase();
  return STALE_CHUNK_PATTERNS.some(p => msg.includes(p));
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, isChunkError: false };
  static reloadedForChunkError = false;

  static getDerivedStateFromError(error: Error): State {
    const isChunk = isStaleChunkError(error);
    // If this is a stale chunk error AND we haven't already reloaded, trigger
    // a page reload. This catches the case where React's error boundary
    // catches the dynamic import failure BEFORE the window 'error' or
    // 'unhandledrejection' listeners in main.tsx can fire.
    if (isChunk && !ErrorBoundary.reloadedForChunkError) {
      ErrorBoundary.reloadedForChunkError = true;
      console.warn('[ErrorBoundary] Stale chunk detected, auto-reloading...', error.message);
      // Use a short timeout so the console warning is visible before reload
      setTimeout(() => window.location.reload(), 100);
    }
    return { error, isChunkError: isChunk };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null, isChunkError: false });
  };

  render(): ReactNode {
    if (this.state.error) {
      // For stale chunk errors, show a minimal "reloading" message
      if (this.state.isChunkError) {
        return (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-5xl animate-pulse">🔄</div>
            <h2 className="font-mono uppercase tracking-widest text-zinc-300 text-sm">
              Updating...
            </h2>
            <p className="text-xs text-zinc-500 max-w-md font-mono">
              A new version of the app was deployed. Reloading...
            </p>
          </div>
        );
      }

      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-5xl">📺</div>
          <h2 className="font-mono uppercase tracking-widest text-zinc-300 text-sm">
            Something broke on this screen
          </h2>
          <p className="text-xs text-zinc-500 max-w-md font-mono">
            {this.state.error.message || 'Unknown error'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 bg-gold-bright/10 border border-gold-bright/30 text-gold-bright rounded-lg text-xs font-mono uppercase tracking-widest hover:bg-gold-bright/20 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-xs font-mono uppercase tracking-widest hover:bg-zinc-700 transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
