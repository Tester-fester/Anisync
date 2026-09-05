import { ConfirmDialog as ConfirmDialogComponent, useConfirm, ConfirmState } from '../components/ConfirmDialog';
import React from 'react';

/**
 * Global confirm() replacement.
 *
 * USAGE (anywhere in the app):
 *   import { confirm } from '../utils/confirm';
 *   if (await confirm({ title: 'Delete?', danger: true })) { ... }
 *
 * SETUP (once, at App root):
 *   <ConfirmHost />
 *
 * This is a singleton implementation — there's only one ConfirmDialog mounted
 * at the app root, and `confirm()` returns a Promise that resolves when the
 * user clicks confirm/cancel.
 *
 * Why: window.confirm() blocks the main thread and looks out of place in a
 * motion-based UI. This replaces it without requiring every component to
 * thread a useConfirm hook through props.
 */

let openConfirm: ((options: ConfirmState['options']) => Promise<boolean>) | null = null;

export function registerConfirmHost(opener: (options: ConfirmState['options']) => Promise<boolean>) {
  openConfirm = opener;
}

export function confirm(options: ConfirmState['options']): Promise<boolean> {
  if (!openConfirm) {
    // Fallback to window.confirm if the host isn't mounted yet (e.g., during
    // initial render). Once the host mounts, this path won't be hit.
    return Promise.resolve(window.confirm(options.title));
  }
  return openConfirm(options);
}

export function ConfirmHost() {
  const { confirm: openDialog, state, handleClose } = useConfirm();
  React.useEffect(() => {
    registerConfirmHost(openDialog);
    return () => registerConfirmHost(() => Promise.resolve(false));
  }, [openDialog]);
  return <ConfirmDialogComponent state={state} onClose={handleClose} />;
}
