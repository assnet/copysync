import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

/** Grupos por configuração quando o plano não define `broadcast_groups`: teto técnico. */
export const OFFER_GROUPS_HARD_MAX = 200;
export const BROADCAST_GROUPS = 'broadcast_groups';
export const OFFER_INTERVAL_MIN_SECONDS = 5;
export const OFFER_INTERVAL_MAX_SECONDS = 120;
export const DEFAULT_INTERVAL = { min: 8, max: 15 } as const;

export interface OfferGeneratorConfigDTO {
  sessionId: string | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  groups: { id: string; title: string | null; sessionId: string | null }[];
  /** Entitlement `broadcast_groups`; null = sem limite do plano. */
  groupLimit: number | null;
  /** false = tenant nunca salvou (valores padrão). */
  configured: boolean;
}

export interface SaveOfferGeneratorConfigInput {
  tenantId: string;
  sessionId: string;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  conversationIds: string[];
}

interface Deps {
  configs: IOfferGeneratorConfigRepository;
  entitlements: IEntitlementReader;
}

function toGroups(views: OfferDestinationView[]): OfferGeneratorConfigDTO['groups'] {
  return views.map((v) => ({ id: v.conversationId, title: v.title, sessionId: v.sessionId }));
}

/** Configuração atual (GEN-01). Sem configuração: padrões, sem sessão nem grupos. */
export class GetOfferGeneratorConfigUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<OfferGeneratorConfigDTO> {
    const [config, groups, groupLimit] = await Promise.all([
      this.deps.configs.find(tenantId),
      this.deps.configs.listGroups(tenantId),
      this.deps.entitlements.getNumber(tenantId, BROADCAST_GROUPS),
    ]);
    return {
      sessionId: config?.sessionId ?? null,
      intervalMinSeconds: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
      intervalMaxSeconds: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
      groups: toGroups(groups),
      groupLimit,
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
    const { tenantId, sessionId } = input;
    const { configs, entitlements } = this.deps;
    validateInterval(input.intervalMinSeconds, input.intervalMaxSeconds);

    const ids = [...new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > OFFER_GROUPS_HARD_MAX) {
      throw new OfferInvalidInputError(`At most ${OFFER_GROUPS_HARD_MAX} groups`, 'conversationIds');
    }
    const limit = await entitlements.getNumber(tenantId, BROADCAST_GROUPS);
    if (limit !== null && ids.length > limit) throw new PlanLimitReachedError(BROADCAST_GROUPS, limit);

    const session = await configs.findSession(tenantId, sessionId);
    if (!session) throw new NotFoundError('Session', sessionId);

    if (ids.length > 0) {
      const valid = new Set(await configs.filterSessionGroups(tenantId, sessionId, ids));
      const invalid = ids.filter((id) => !valid.has(id)).length;
      if (invalid > 0) throw new NotFoundError('Group conversation', `${invalid} of ${ids.length}`);
    }

    await configs.save({
      tenantId,
      sessionId,
      intervalMinSeconds: input.intervalMinSeconds,
      intervalMaxSeconds: input.intervalMaxSeconds,
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
      `Interval must be ${OFFER_INTERVAL_MIN_SECONDS}–${OFFER_INTERVAL_MAX_SECONDS} s`,
      'intervalMinSeconds',
    );
  }
  if (!ok(max) || max < min) {
    throw new OfferInvalidInputError('Max interval must be ≥ min and ≤ 120 s', 'intervalMaxSeconds');
  }
}
