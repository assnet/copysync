import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { PlanFeatureUnavailableError, PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import {
  countByChannel, LIMIT_CHANNELS, limitKeyOfChannel, requiresCrossSession, type LimitChannel,
} from '../../../tenants/domain/channelLimits';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { OFFER_DISPATCH_ORDERS, type OfferDispatchOrder } from '../../domain/entities/OfferGeneratorConfig';

/** Grupos por configuração quando o plano não define `broadcast_groups`: teto técnico. */
export const OFFER_GROUPS_HARD_MAX = 200;
/** WhatsApp; Telegram em `telegram_broadcast_groups`. Chave por canal: `limitKeyOfChannel`. */
export const BROADCAST_GROUPS = ENTITLEMENT_KEYS.BROADCAST_GROUPS;
/** Sessões de WhatsApp que disparam; Telegram em `telegram_sessions` (limite por canal). */
export const WHATSAPP_SESSIONS = ENTITLEMENT_KEYS.WHATSAPP_SESSIONS;
/** Entitlement: 2+ sessões do MESMO canal disparando (Business). Ausente = bloqueado. */
export const CROSS_SESSION_DISPATCH = ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH;
export const OFFER_SESSIONS_HARD_MAX = 10;
/** Intervalo entre grupos em segundos; o painel opera em minutos inteiros (1–60). */
export const OFFER_INTERVAL_MIN_SECONDS = 60;
export const OFFER_INTERVAL_MAX_SECONDS = 3600;
export const DEFAULT_INTERVAL = { min: 120, max: 300 } as const;

export interface OfferGeneratorConfigDTO {
  /** Na ordem de envio. Vazio = nunca configurado ou sessões apagadas. */
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
  groups: { id: string; title: string | null; avatarUrl: string | null; sessionId: string | null }[];
  /** Legado = `limits.whatsapp.broadcastGroups` (`broadcast_groups`); null = sem limite do plano. */
  groupLimit: number | null;
  /** Legado = `limits.whatsapp.sessions` (`whatsapp_sessions`); null = sem limite do plano. */
  sessionLimit: number | null;
  /** Entitlement `cross_session_dispatch`: 2+ sessões do MESMO canal disparando. Ausente = false. */
  crossSessionDispatch: boolean;
  /** Limites por canal (canal = engine da sessão; do grupo = da sessão dona). null = sem limite. */
  limits: Record<LimitChannel, OfferChannelLimitsDTO>;
  /** Uso da configuração salva por canal (sessões configuradas e grupos delas). */
  usage: Record<LimitChannel, OfferChannelUsageDTO>;
  /** false = tenant nunca salvou (valores padrão). */
  configured: boolean;
}

export interface OfferChannelLimitsDTO { sessions: number | null; broadcastGroups: number | null }
export interface OfferChannelUsageDTO { sessions: number; broadcastGroups: number }

export interface SaveOfferGeneratorConfigInput {
  tenantId: string;
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
  conversationIds: string[];
}

interface Deps {
  configs: IOfferGeneratorConfigRepository;
  entitlements: IEntitlementReader;
}

function toGroups(views: OfferDestinationView[]): OfferGeneratorConfigDTO['groups'] {
  return views.map((v) => ({ id: v.conversationId, title: v.title, avatarUrl: v.avatarUrl, sessionId: v.sessionId }));
}

/** Configuração atual (GEN-01). Sem configuração: padrões, sem sessão nem grupos. */
export class GetOfferGeneratorConfigUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<OfferGeneratorConfigDTO> {
    const { configs, entitlements } = this.deps;
    const num = (kind: 'sessions' | 'broadcastGroups', ch: LimitChannel) => entitlements.getNumber(tenantId, limitKeyOfChannel(kind, ch));
    const [config, groups, waGroups, waSessions, tgGroups, tgSessions, crossSession] = await Promise.all([
      configs.find(tenantId),
      configs.listGroups(tenantId),
      num('broadcastGroups', 'whatsapp'),
      num('sessions', 'whatsapp'),
      num('broadcastGroups', 'telegram'),
      num('sessions', 'telegram'),
      entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH),
    ]);
    const sessions = config?.sessionIds.length ? await configs.findSessions(tenantId, config.sessionIds) : [];
    const engineById = new Map(sessions.map((x) => [x.id, x.engine]));
    const sessionCount = countByChannel(sessions, (x) => x.engine);
    const groupCount = countByChannel(groups.filter((g) => g.sessionId != null && engineById.has(g.sessionId)), (g) => engineById.get(g.sessionId!));
    return {
      sessionIds: config?.sessionIds ?? [],
      intervalMinSeconds: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
      intervalMaxSeconds: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
      dispatchOrder: config?.dispatchOrder ?? 'SEQUENTIAL',
      groups: toGroups(groups),
      groupLimit: waGroups,
      sessionLimit: waSessions,
      crossSessionDispatch: crossSession === true,
      limits: {
        whatsapp: { sessions: waSessions, broadcastGroups: waGroups },
        telegram: { sessions: tgSessions, broadcastGroups: tgGroups },
      },
      usage: {
        whatsapp: { sessions: sessionCount.whatsapp, broadcastGroups: groupCount.whatsapp },
        telegram: { sessions: sessionCount.telegram, broadcastGroups: groupCount.telegram },
      },
      configured: config !== null,
    };
  }
}

/**
 * Salva sessão + grupos + intervalo (GEN-01). Tudo validado antes; a gravação troca config e
 * destinos numa transação. Qualquer id fora da sessão/tenant ou que não seja grupo → nada muda.
 */
export class SaveOfferGeneratorConfigUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: SaveOfferGeneratorConfigInput): Promise<OfferGeneratorConfigDTO> {
    const { tenantId } = input;
    const { configs, entitlements } = this.deps;
    validateInterval(input.intervalMinSeconds, input.intervalMaxSeconds);
    if (!OFFER_DISPATCH_ORDERS.includes(input.dispatchOrder)) {
      throw new OfferInvalidInputError('Unknown dispatch order', 'dispatchOrder');
    }

    const sessionIds = [...new Set(input.sessionIds.map((id) => id.trim()).filter(Boolean))];
    if (sessionIds.length === 0) throw new OfferInvalidInputError('At least one session', 'sessionIds');
    if (sessionIds.length > OFFER_SESSIONS_HARD_MAX) {
      throw new OfferInvalidInputError(`At most ${OFFER_SESSIONS_HARD_MAX} sessions`, 'sessionIds');
    }
    const ids = [...new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > OFFER_GROUPS_HARD_MAX) {
      throw new OfferInvalidInputError(`At most ${OFFER_GROUPS_HARD_MAX} groups`, 'conversationIds');
    }

    const sessions = await configs.findSessions(tenantId, sessionIds);
    if (sessions.length !== sessionIds.length) {
      const found = new Set(sessions.map((x) => x.id));
      throw new NotFoundError('Session', sessionIds.find((id) => !found.has(id)));
    }
    // Sessões por canal (whatsapp_sessions / telegram_sessions)
    const sessionsByChannel = countByChannel(sessions, (x) => x.engine);
    for (const ch of LIMIT_CHANNELS) {
      if (sessionsByChannel[ch] === 0) continue;
      const key = limitKeyOfChannel('sessions', ch);
      const limit = await entitlements.getNumber(tenantId, key);
      if (limit !== null && sessionsByChannel[ch] > limit) throw new PlanLimitReachedError(key, limit);
    }
    // 2+ sessões do mesmo canal disparando: feature do plano, não quantidade. Canais diferentes sempre podem
    if (requiresCrossSession(sessions) && (await entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH)) !== true) {
      throw new PlanFeatureUnavailableError(CROSS_SESSION_DISPATCH);
    }

    if (ids.length > 0) {
      const valid = await configs.filterSessionGroups(tenantId, sessionIds, ids);
      const invalid = ids.length - new Set(valid.map((v) => v.conversationId)).size;
      if (invalid > 0) throw new NotFoundError('Group conversation', `${invalid} of ${ids.length}`);
      // Grupos por canal (canal do grupo = engine da sessão dona)
      const engineById = new Map(sessions.map((x) => [x.id, x.engine]));
      const groupsByChannel = countByChannel(valid, (v) => engineById.get(v.sessionId));
      for (const ch of LIMIT_CHANNELS) {
        if (groupsByChannel[ch] === 0) continue;
        const key = limitKeyOfChannel('broadcastGroups', ch);
        const limit = await entitlements.getNumber(tenantId, key);
        if (limit !== null && groupsByChannel[ch] > limit) throw new PlanLimitReachedError(key, limit);
      }
    }

    await configs.save({
      tenantId,
      sessionIds,
      intervalMinSeconds: input.intervalMinSeconds,
      intervalMaxSeconds: input.intervalMaxSeconds,
      dispatchOrder: input.dispatchOrder,
      conversationIds: ids,
    });
    return new GetOfferGeneratorConfigUseCase(this.deps).execute(tenantId);
  }
}

function validateInterval(min: number, max: number): void {
  const ok = (v: number) =>
    Number.isInteger(v) && v >= OFFER_INTERVAL_MIN_SECONDS && v <= OFFER_INTERVAL_MAX_SECONDS;
  if (!ok(min)) {
    throw new OfferInvalidInputError(
      `Interval must be ${OFFER_INTERVAL_MIN_SECONDS}–${OFFER_INTERVAL_MAX_SECONDS} s (1–60 min)`,
      'intervalMinSeconds',
    );
  }
  if (!ok(max) || max < min) {
    throw new OfferInvalidInputError(`Max interval must be ≥ min and ≤ ${OFFER_INTERVAL_MAX_SECONDS} s (60 min)`, 'intervalMaxSeconds');
  }
}
