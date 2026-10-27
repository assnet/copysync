import type { SyncErrorCode } from './store.js';

/**
 * Internal error — always carries a `SyncErrorCode` (i18n key `err_<code>`).
 * Raw API/Chrome text only in `detail`, shown only in DEV.
 */
export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = 'SyncError';
  }
}

export const toSyncError = (error: unknown, fallback: SyncErrorCode): SyncError => {
  if (error instanceof SyncError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SyncError(fallback, detail);
};
