import type { SyncErrorCode } from '../contract/messages.js';

/**
 * Erro interno da extensão: sempre carrega um `SyncErrorCode` (chave i18n
 * `err_<code>`). Texto cru da API ou do Chrome só entra em `detail`, que é
 * exibido apenas em DEV (ver `syncSession.ts`).
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

/** Garante que qualquer `unknown` capturado vire `SyncError` com um código previsível. */
export const toSyncError = (error: unknown, fallback: SyncErrorCode): SyncError => {
  if (error instanceof SyncError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SyncError(fallback, detail);
};
