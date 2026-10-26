import { offerStrings as t } from '../strings';

/** O que a tela faz com o erro além de mostrar a mensagem. */
export type OfferErrorAction = 'credentials' | 'destinations' | 'none';

export interface OfferErrorView {
  code: string | null;
  message: string;
  action: OfferErrorAction;
  /** Erro do campo de link: aparece sob o campo, não num alerta. */
  isLinkField: boolean;
}

const CREDENTIAL_CODES = new Set(['AFFILIATE_CREDENTIAL_NOT_FOUND', 'AFFILIATE_CREDENTIAL_REJECTED']);

/** Traduz o erro do `apiClient` (que anexa `code` e `meta`) para a tela. */
export function toOfferError(err: unknown, fallbackLimit?: number | null): OfferErrorView {
  const e = err as { code?: unknown; meta?: { limit?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : null;

  if (code === 'PLAN_LIMIT_REACHED') {
    const limit = typeof e?.meta?.limit === 'number' ? e.meta.limit : fallbackLimit;
    return { code, message: limit != null ? t.planLimit(limit) : t.planLimitNoValue, action: 'none', isLinkField: false };
  }

  return {
    code,
    message: (code && t.errors[code]) || t.errors.generic,
    action: code && CREDENTIAL_CODES.has(code) ? 'credentials' : code === 'OFFER_NO_DESTINATIONS' ? 'destinations' : 'none',
    isLinkField: code === 'OFFER_URL_UNSUPPORTED' || code === 'VALIDATION_ERROR',
  };
}
