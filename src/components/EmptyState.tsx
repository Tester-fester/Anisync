import React from 'react';
import { motion } from 'motion/react';
import { RefreshCw } from '@/utils/icons';

/**
 * Shared EmptyState + ErrorState components.
 *
 * Standardizes the visual pattern across the app: icon (top), title (bold),
 * message (muted), optional CTA button. Replaces ad-hoc empty/error markup
 * scattered across components.
 */

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, message, action, className = '' }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex flex-col items-center justify-center p-12 text-center ${className}`}
    >
      {icon && <div className="text-zinc-700 mb-4">{icon}</div>}
      <h3 className="text-base font-display font-bold text-zinc-300 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {message && (
        <p className="text-sm text-zinc-500 max-w-md mx-auto mb-6 leading-relaxed">
          {message}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="bg-brand-primary/10 border border-brand-primary/30 text-brand-primary hover:bg-brand-primary/20 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-widest transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not reach the arena. Check your connection and try again.',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex flex-col items-center justify-center p-12 text-center border border-rose-deep/30 bg-rose-deep/10 rounded-2xl ${className}`}
    >
      <div className="text-vermillion mb-4 text-3xl">⚠</div>
      <h3 className="text-base font-display font-bold text-vermillion-tint uppercase tracking-wider mb-2">
        {title}
      </h3>
      <p className="text-sm text-vermillion-tint/70 max-w-md mx-auto mb-6 leading-relaxed">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 bg-rose-deep/10 border border-rose-deep/30 text-vermillion-tint hover:bg-rose-deep/20 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-widest transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </motion.div>
  );
}
