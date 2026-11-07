import { redirectLinksStrings as s } from './strings';

type ApiErr = { code?: unknown; meta?: { reason?: unknown } } | null;

/** Mensagem amigável a partir do código (e do motivo, quando houver) do erro da API. */
export function redirectLinkErrorMessage(err: unknown): string {
  const e = err as ApiErr;
  const reason = e?.meta?.reason;
  if (e?.code === 'REDIRECT_LINK_INVALID' && typeof reason === 'string' && s.reasons[reason]) return s.reasons[reason];
  const code = e?.code;
  return (typeof code === 'string' && s.errors[code]) || s.errors.generic;
}
