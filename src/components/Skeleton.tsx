import React from 'react';

/**
 * Skeleton loader primitives for Suspense fallbacks and content loading states.
 *
 * Usage:
 *   <Suspense fallback={<LeaderboardSkeleton />}>
 *     <TrackLeaderboard ... />
 *   </Suspense>
 *
 * Or for individual elements:
 *   <SkeletonLine className="h-4 w-32" />
 */

export function SkeletonBox({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`skeleton h-3 ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-900">
      <SkeletonBox className="w-8 h-8 rounded-md shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <SkeletonLine className="w-2/3" />
        <SkeletonLine className="w-1/3 h-2" />
      </div>
      <SkeletonBox className="w-12 h-6 rounded shrink-0" />
      <SkeletonBox className="w-12 h-6 rounded shrink-0" />
      <SkeletonBox className="w-12 h-6 rounded shrink-0" />
    </div>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="border border-zinc-900 rounded-2xl overflow-hidden bg-zinc-950/50">
      {/* Filter bar skeleton */}
      <div className="flex items-center gap-2 p-4 border-b border-zinc-900">
        <SkeletonBox className="w-20 h-8 rounded-lg" />
        <SkeletonBox className="w-20 h-8 rounded-lg" />
        <SkeletonBox className="w-20 h-8 rounded-lg" />
        <div className="flex-1" />
        <SkeletonBox className="w-32 h-8 rounded-lg" />
      </div>
      {/* Rows */}
      {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

export function ArenaSkeleton() {
  return (
    <div className="flex flex-col md:flex-row gap-4 h-[460px] md:h-[520px] lg:h-[60vh] max-h-[640px]">
      <div className="flex-1 rounded-xl border border-zinc-900 bg-zinc-950/50 p-6 flex flex-col justify-end">
        <SkeletonBox className="w-20 h-20 rounded-md mb-4" />
        <SkeletonLine className="w-3/4 h-4 mb-2" />
        <SkeletonLine className="w-1/2 h-3 mb-4" />
        <SkeletonBox className="w-24 h-8 rounded-lg" />
      </div>
      <div className="flex-1 rounded-xl border border-zinc-900 bg-zinc-950/50 p-6 flex flex-col justify-end">
        <SkeletonBox className="w-20 h-20 rounded-md mb-4" />
        <SkeletonLine className="w-3/4 h-4 mb-2" />
        <SkeletonLine className="w-1/2 h-3 mb-4" />
        <SkeletonBox className="w-24 h-8 rounded-lg" />
      </div>
    </div>
  );
}

export function GenericSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
        <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
      <p className="font-mono text-zinc-500 text-xs uppercase tracking-widest">{label}</p>
    </div>
  );
}
