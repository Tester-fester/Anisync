import React, { useEffect } from 'react';

interface AdBannerProps {
  layout?: 'horizontal' | 'vertical'; // default horizontal
  className?: string;
  adClient?: string; // e.g., 'ca-pub-XXXXXXXXXXXXXXXX'
  adSlot?: string;   // e.g., '1234567890'
}

/**
 * AdBanner — Google AdSense slot with a graceful empty state.
 *
 * Previously the fallback said "AdSense Space / Requires Publisher ID" to end
 * users, which looked broken. Now the fallback renders as a subtle empty card
 * with just an "Advertisement" disclosure label, so non-pro users who don't
 * have AdSense configured still see a polished UI instead of a debug message.
 */
export function AdBanner({ layout = 'horizontal', className = '', adClient = 'ca-pub-placeholder', adSlot = 'placeholder' }: AdBannerProps) {
  const hasRealAdClient = adClient && adClient !== 'ca-pub-placeholder';

  useEffect(() => {
    if (!hasRealAdClient) return; // No-op until a real publisher ID is configured.
    try {
      if (typeof window !== 'undefined' && (window as any).adsbygoogle) {
        ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
      }
    } catch (err) {
      console.error("AdSense error", err);
    }
  }, [hasRealAdClient]);

  return (
    <div className={`w-full bg-zinc-950/40 relative rounded-2xl overflow-hidden border border-zinc-900 flex items-center justify-center p-4 ${className} ${layout === 'vertical' ? 'min-h-[600px]' : 'min-h-[120px]'}`}>
      <div className="absolute top-2 right-3 text-[11px] uppercase tracking-widest text-zinc-600 font-black font-mono">
        Advertisement
      </div>

      {/* Google AdSense Integration Tag — only renders when a real publisher
          ID is configured. Until then the slot is an empty reserved space. */}
      {hasRealAdClient && (
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', height: '100%' }}
          data-ad-client={adClient}
          data-ad-slot={adSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      )}

      {/* Fallback: subtle "Your ad could go here" message — only shown in dev
          so operators know the slot is reserved. In production without a real
          publisher ID, the slot is just an empty card. */}
      {!hasRealAdClient && import.meta.env.DEV && (
        <div className="absolute inset-0 flex items-center justify-center flex-col text-center z-[-1]">
          <span className="text-zinc-700 font-mono text-sm uppercase tracking-widest font-bold">Ad slot reserved</span>
          <span className="text-zinc-800 font-mono text-[11px] uppercase mt-1">Configure AdSense in production</span>
        </div>
      )}
    </div>
  );
}
