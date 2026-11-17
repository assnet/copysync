import { describeSaverError } from '@/features/saver/errors';
import { saverAdminStrings as s } from './strings';

/**
 * Cursor recusado pela API (assinatura, validade ou filtros diferentes): a lista recomeça. Os filtros já
 * passaram na 1ª página, então 400 no "carregar mais" é o cursor.
 */
export function isInvalidCursorError(err: unknown): boolean {
  const e = (err && typeof err === 'object' ? err : null) as { code?: unknown; status?: unknown } | null;
  return e?.code === 'SAVER_CURSOR_INVALID' || e?.status === 400;
}

export function platformErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && s.codes[code]) return s.codes[code]!;
  return describeSaverError(err).message;
}
