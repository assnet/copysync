import { offerStrings as t } from '../strings';

/** O que a tela faz com o erro além de mostrar a mensagem. */
export type OfferErrorAction = 'credentials' | 'config' | 'sessions' | 'none';

export interface OfferErrorView {
  code: string | null;
  message: string;
  action: OfferErrorAction;
  /** Erro do campo de link: aparece sob o campo, não num alerta. */
  isLinkField: boolean;
}

const CREDENTIAL_CODES = new Set(['AFFILIATE_CREDENTIAL_NOT_FOUND', 'AFFILIATE_CREDENTIAL_REJECTED']);
const CONFIG_CODES = new Set(['OFFER_CONFIG_MISSING', 'OFFER_NO_DESTINATIONS']);
const LINK_CODES = new Set(['OFFER_URL_UNSUPPORTED', 'OFFER_LINK_NOT_OWNED', 'OFFER_LINK_NOT_AFFILIATE', 'VALIDATION_ERROR']);

function actionFor(code: string | null): OfferErrorAction {
  if (!code) return 'none';
  if (CREDENTIAL_CODES.has(code)) return 'credentials';
  if (CONFIG_CODES.has(code)) return 'config';
  if (code === 'SESSION_NOT_CONNECTED') return 'sessions';
  return 'none';
}

/** Traduz o erro do `apiClient` (que anexa `code` e `meta`) para a tela. */
export function toOfferError(err: unknown, fallbackLimit?: number | null): OfferErrorView {
  const e = err as { code?: unknown; meta?: { limit?: unknown; key?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : null;

  if (code === 'PLAN_LIMIT_REACHED') {
    const limit = typeof e?.meta?.limit === 'number' ? e.meta.limit : null;
    if (e?.meta?.key === 'broadcast_groups') {
      return { code, message: limit != null ? t.groupLimit(limit) : t.errors.generic, action: 'none', isLinkField: false };
    }
    const daily = limit ?? fallbackLimit;
    return { code, message: daily != null ? t.planLimit(daily) : t.planLimitNoValue, action: 'none', isLinkField: false };
  }

  return {
    code,
    message: (code && t.errors[code]) || t.errors.generic,
    action: actionFor(code),
    isLinkField: code != null && LINK_CODES.has(code),
  };
}
