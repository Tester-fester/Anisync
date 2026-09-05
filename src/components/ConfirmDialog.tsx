import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle } from '@/utils/icons';

/**
 * A custom ConfirmDialog that replaces window.confirm().
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete track?', body: 'This cannot be undone.' })) { ... }
 *
 * Why: window.confirm() blocks the main thread and is visually inconsistent
 * with the rest of the app's motion-based UI. Sonner handles transient
 * toasts; this handles destructive confirmations.
 */

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmState {
  open: boolean;
  options: ConfirmOptions;
  resolve: ((value: boolean) => void) | null;
}

const DEFAULT_STATE: ConfirmState = {
  open: false,
  options: { title: '' },
  resolve: null,
};

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(DEFAULT_STATE);
  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve });
    });
  }, []);
  const handleClose = useCallback((result: boolean) => {
    setState((prev) => {
      prev.resolve?.(result);
      return DEFAULT_STATE;
    });
  }, []);
  return { confirm, state, handleClose };
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: (result: boolean) => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open, and handle Escape to cancel.
  useEffect(() => {
    if (!state.open) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      if (e.key === 'Enter') onClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, onClose]);

  return (
    <AnimatePresence>
      {state.open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onClose(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <motion.div
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full shadow-2xl"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              {state.options.danger && (
                <AlertTriangle className="w-5 h-5 text-vermillion flex-shrink-0 mt-0.5" />
              )}
              <div>
                <h3 id="confirm-dialog-title" className="text-sm font-mono uppercase tracking-widest text-zinc-100">
                  {state.options.title}
                </h3>
                {state.options.body && (
                  <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                    {state.options.body}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => onClose(false)}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                {state.options.cancelLabel || 'Cancel'}
              </button>
              <button
                ref={confirmBtnRef}
                onClick={() => onClose(true)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest rounded-lg transition-colors ${
                  state.options.danger
                    ? 'bg-vermillion-hover hover:bg-vermillion text-white'
                    : 'bg-gold-bright hover:bg-gold text-black'
                }`}
              >
                {state.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
