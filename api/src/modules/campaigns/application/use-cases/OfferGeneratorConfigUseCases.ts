import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { OFFER_DISPATCH_ORDERS, type OfferDispatchOrder } from '../../domain/entities/OfferGeneratorConfig';

/** Grupos por configuração quando o plano não define `broadcast_groups`: teto técnico. */
export const OFFER_GROUPS_HARD_MAX = 200;
export const BROADCAST_GROUPS = 'broadcast_groups';
/** Entitlement: quantas sessões de WhatsApp o plano permite (e, por tabela, quantas disparam). */
export const WHATSAPP_SESSIONS = 'whatsapp_sessions';
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
  /** Entitlement `broadcast_groups`; null = sem limite do plano. */
  groupLimit: number | null;
  /** Entitlement `whatsapp_sessions`; null = sem limite do plano. */
  sessionLimit: number | null;
  /** false = tenant nunca salvou (valores padrão). */
  configured: boolean;
}

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
    const [config, groups, groupLimit, sessionLimit] = await Promise.all([
      this.deps.configs.find(tenantId),
      this.deps.configs.listGroups(tenantId),
      this.deps.entitlements.getNumber(tenantId, BROADCAST_GROUPS),
      this.deps.entitlements.getNumber(tenantId, WHATSAPP_SESSIONS),
    ]);
    return {
      sessionIds: config?.sessionIds ?? [],
      intervalMinSeconds: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
      intervalMaxSeconds: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
      dispatchOrder: config?.dispatchOrder ?? 'SEQUENTIAL',
      groups: toGroups(groups),
      groupLimit,
      sessionLimit,
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
    const sessionLimit = await entitlements.getNumber(tenantId, WHATSAPP_SESSIONS);
    if (sessionLimit !== null && sessionIds.length > sessionLimit) throw new PlanLimitReachedError(WHATSAPP_SESSIONS, sessionLimit);

    const ids = [...new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > OFFER_GROUPS_HARD_MAX) {
      throw new OfferInvalidInputError(`At most ${OFFER_GROUPS_HARD_MAX} groups`, 'conversationIds');
    }
    const limit = await entitlements.getNumber(tenantId, BROADCAST_GROUPS);
    if (limit !== null && ids.length > limit) throw new PlanLimitReachedError(BROADCAST_GROUPS, limit);

    const sessions = await configs.findSessions(tenantId, sessionIds);
    if (sessions.length !== sessionIds.length) {
      const found = new Set(sessions.map((x) => x.id));
      throw new NotFoundError('Session', sessionIds.find((id) => !found.has(id)));
    }

    if (ids.length > 0) {
      const valid = new Set(await configs.filterSessionGroups(tenantId, sessionIds, ids));
      const invalid = ids.filter((id) => !valid.has(id)).length;
      if (invalid > 0) throw new NotFoundError('Group conversation', `${invalid} of ${ids.length}`);
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
