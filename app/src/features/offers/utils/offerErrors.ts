import { plansAbove, type PlanLimitKind } from '@/features/linkRotation/planUpsell';
import { isMercadoLivreTagLimit } from '@/features/plans/planGate';
import { describeAffiliateLinkError } from '@/features/affiliateLinks/linkErrors';
import type { LimitChannel } from '@/types/api.types';
import { offerStrings as t } from '../strings';

/** O que a tela faz com o erro além de mostrar a mensagem. */
export type OfferErrorAction = 'credentials' | 'config' | 'sessions' | 'none';

export interface OfferErrorView {
  code: string | null;
  message: string;
  action: OfferErrorAction;
  /** Erro do campo de link: aparece sob o campo, não num alerta. */
  isLinkField: boolean;
  /** Limite do plano (sessões/grupos por canal, etiquetas do ML): abre o aviso de upgrade. */
  planLimit?: { kind: PlanLimitKind; limit: number };
  /** `meta` do erro (ex.: `meta.provider`): escolhe o rótulo do botão de conectar a loja. */
  meta?: unknown;
}

/** Chave de entitlement (`meta.key` do 403) → canal, o que estourou e o aviso de upgrade. */
const CHANNEL_LIMIT_KEYS: Record<string, { channel: LimitChannel; what: 'sessions' | 'groups'; kind: PlanLimitKind }> = {
  whatsapp_sessions: { channel: 'whatsapp', what: 'sessions', kind: 'whatsappSessions' },
  telegram_sessions: { channel: 'telegram', what: 'sessions', kind: 'telegramSessions' },
  broadcast_groups: { channel: 'whatsapp', what: 'groups', kind: 'whatsappBroadcastGroups' },
  telegram_broadcast_groups: { channel: 'telegram', what: 'groups', kind: 'telegramBroadcastGroups' },
};

const CREDENTIAL_CODES = new Set([
  'AFFILIATE_CREDENTIAL_REQUIRED',
  'AFFILIATE_CREDENTIAL_NOT_FOUND',
  'AFFILIATE_CREDENTIAL_REJECTED',
  'MARKETPLACE_RISK_NOT_ACCEPTED',
  // Etiqueta da conta do ML ainda não vinculada (há vaga): a correção é vincular nas credenciais
  'AFFILIATE_IDENTIFIER_NOT_LINKED',
]);
const CONFIG_CODES = new Set(['OFFER_CONFIG_MISSING', 'OFFER_NO_DESTINATIONS']);
/** Erro do campo de link (aparece sob o campo). `OFFER_TEXT_FOREIGN_LINK` não entra: é da edição do texto (alerta da página). */
const LINK_CODES = new Set([
  'OFFER_URL_UNSUPPORTED',
  'OFFER_LINK_REBUILD_FAILED',
  'AFFILIATE_API_RATE_LIMITED',
  'AFFILIATE_API_UNAVAILABLE',
  'VALIDATION_ERROR',
]);

function actionFor(code: string | null): OfferErrorAction {
  if (!code) return 'none';
  if (CREDENTIAL_CODES.has(code)) return 'credentials';
  if (CONFIG_CODES.has(code)) return 'config';
  if (code === 'SESSION_NOT_CONNECTED') return 'sessions';
  return 'none';
}

/** Traduz o erro do `apiClient` (que anexa `code` e `meta`) para a tela. */
export function toOfferError(err: unknown, fallbackLimit?: number | null): OfferErrorView {
  const e = err as { code?: unknown; meta?: { limit?: unknown; key?: unknown; field?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : null;

  if (code === 'PLAN_LIMIT_REACHED') {
    const limit = typeof e?.meta?.limit === 'number' ? e.meta.limit : null;
    // Etiqueta da conta do ML sem vaga: sem este ramo cairia no texto do limite diário
    if (isMercadoLivreTagLimit(err)) {
      const canUpgrade = limit == null || plansAbove('mercadoLivreTags', limit).length > 0;
      const message = t.mercadoLivreTagLimit(limit, canUpgrade);
      return limit == null
        ? { code, message, action: 'none', isLinkField: false }
        : { code, message, action: 'none', isLinkField: false, planLimit: { kind: 'mercadoLivreTags', limit } };
    }
    const channelKey = typeof e?.meta?.key === 'string' ? CHANNEL_LIMIT_KEYS[e.meta.key] : undefined;
    if (channelKey) {
      if (limit == null) return { code, message: t.errors.generic, action: 'none', isLinkField: false };
      const message = channelKey.what === 'groups' ? t.channelGroupLimit(channelKey.channel, limit) : t.channelSessionLimit(channelKey.channel, limit);
      return { code, message, action: 'none', isLinkField: false, planLimit: { kind: channelKey.kind, limit } };
    }
    const daily = limit ?? fallbackLimit;
    return { code, message: daily != null ? t.planLimit(daily) : t.planLimitNoValue, action: 'none', isLinkField: false };
  }

  if (code === 'PLAN_FEATURE_UNAVAILABLE' && e?.meta?.key === 'cross_session_dispatch') {
    return { code, message: t.crossSessionUnavailable, action: 'config', isLinkField: false };
  }

  // Shein fora do plano: sem este ramo cairia no texto genérico de PLAN_FEATURE_UNAVAILABLE (outra função)
  if (code === 'PLAN_FEATURE_UNAVAILABLE' && e?.meta?.key === 'marketplace_shein_enabled') {
    return { code, message: t.sheinUnavailable, action: 'none', isLinkField: true };
  }

  if (code === 'OFFER_INVALID_INPUT' && e?.meta?.field === 'scheduledAt') {
    return { code, message: t.schedule.invalid, action: 'none', isLinkField: false };
  }

  // Texto comum dos erros de link de afiliado; a ação e o lugar (campo × alerta) seguem os mapas daqui
  const shared = describeAffiliateLinkError(code, e?.meta);
  return {
    code,
    message: shared?.message ?? ((code && t.errors[code]) || t.errors.generic),
    action: actionFor(code),
    isLinkField: code != null && LINK_CODES.has(code),
    ...(e?.meta !== undefined && { meta: e.meta }),
  };
}
