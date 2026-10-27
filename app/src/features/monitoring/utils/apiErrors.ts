import { monitoringStrings } from '../strings';

const t = monitoringStrings.errors;

/** Onde o erro aconteceu: muda o sentido de `NOT_FOUND` e do limite do plano. */
export interface MonitoringErrorContext {
  scope: 'groups' | 'settings' | 'captured';
  /** Limite do plano para o texto de PLAN_LIMIT_REACHED (quando a API não mandar `meta.limit`). */
  max?: number | null;
  /** Nome do grupo pelo JID, para citar o grupo em conflito. */
  groupTitle?: (groupJid: string) => string | null;
}

interface ApiErrorShape {
  code?: unknown;
  meta?: Record<string, unknown> | null;
  field?: unknown;
}

/**
 * Erro da API → frase em pt-BR para o usuário. Nunca devolve a `message` da API nem ids:
 * código desconhecido cai no texto genérico.
 */
export function monitoringErrorMessage(err: unknown, ctx: MonitoringErrorContext): string {
  const e = (err ?? {}) as ApiErrorShape;
  const code = typeof e.code === 'string' ? e.code : null;
  const meta = e.meta ?? {};
  switch (code) {
    case 'SESSION_NOT_CONNECTED':
      return t.sessionNotConnected;
    case 'ENGINE_NOT_READY':
    case 'ENGINE_TEMPORARILY_UNAVAILABLE':
    case 'RECOVERABLE_CONNECTION_ERROR':
      return t.engineUnavailable;
    case 'SESSION_NOT_FOUND':
      return t.sessionNotFound;
    case 'CAPTURED_OFFER_NOT_FOUND':
      return t.capturedNotFound;
    case 'NOT_FOUND':
      return ctx.scope === 'groups' ? t.groupNotFound : ctx.scope === 'captured' ? t.capturedNotFound : t.sessionNotFound;
    case 'GROUP_MONITOR_GROUP_CONFLICT': {
      const jid = typeof meta.groupJid === 'string' ? meta.groupJid : null;
      const role = meta.role === 'monitored' || meta.role === 'broadcast' ? meta.role : null;
      return t.groupConflict(jid ? ctx.groupTitle?.(jid) ?? null : null, role);
    }
    case 'GROUP_MONITOR_INVALID_INPUT': {
      const field = typeof meta.field === 'string' ? meta.field : typeof e.field === 'string' ? e.field : null;
      return t.invalidInput(field ? t.fields[field] ?? null : null);
    }
    case 'PLAN_LIMIT_REACHED': {
      const limit = typeof meta.limit === 'number' ? meta.limit : ctx.max ?? null;
      return t.planLimit(limit);
    }
    case 'PLAN_FEATURE_UNAVAILABLE':
      return t.planFeature;
    case 'CAPTURED_OFFER_NOT_RETRYABLE':
      return t.notRetryable;
    default:
      return t.generic;
  }
}

/** Quantos grupos esta sessão pode ter: limite do plano menos o que as outras sessões usam. */
export function sessionGroupCap(limit: number | null, tenantUsage: number, thisSession: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - (tenantUsage - thisSession));
}

/** Erro já traduzido para o usuário (a mensagem pode ser exibida como está). */
export class MonitoringUiError extends Error {}

/** Mensagem exibível: a do erro já traduzido, senão o mapeamento pelo código da API. */
export function uiErrorMessage(err: unknown, ctx: MonitoringErrorContext): string {
  return err instanceof MonitoringUiError ? err.message : monitoringErrorMessage(err, ctx);
}
