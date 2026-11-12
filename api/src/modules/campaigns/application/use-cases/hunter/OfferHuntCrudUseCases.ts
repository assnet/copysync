import type { IOfferHuntRepository } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHunt, OfferHuntDefinition } from '../../../domain/hunter/OfferHunt';
import { HUNTER_LIMITS } from '../../../domain/services/hunter/hunterLimits';
import { nextHuntRunAt } from '../../../domain/services/hunter/huntSchedule';
import { validateHuntDefinition } from '../../../domain/services/hunter/validateHuntDefinition';
import { ALL_WEEKDAYS_MASK, MINUTES_PER_DAY } from '../../../domain/services/postingWindow';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { OfferInvalidInputError } from '../../../../../shared/errors/internal/OfferErrors';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import { OfferHuntLimitReachedError, OfferHuntNotFoundError } from '../../../../../shared/errors/internal/OfferHuntErrors';

/** Campos que o painel manda; ausentes usam o padrão da criação ou o valor atual na edição. */
export type OfferHuntDefinitionInput = Partial<OfferHuntDefinition>;

/** Padrões da criação (o assistente do painel aplica a predefinição antes). */
export const OFFER_HUNT_DEFAULTS: Omit<OfferHuntDefinition, 'name'> = {
  sort: 'RECOMMENDED',
  categoryId: null,
  commissionBand: null,
  keyword: null,
  filters: {},
  aiEnabled: false,
  topN: HUNTER_LIMITS.topNDefault,
  repeatAfterDays: HUNTER_LIMITS.repeatAfterDaysDefault,
  deliveryMode: 'REVIEW',
  intervalMinutes: 60,
  windowStartMinute: 0,
  windowEndMinute: MINUTES_PER_DAY,
  weekdaysMask: ALL_WEEKDAYS_MASK,
};

type Hunts = Pick<IOfferHuntRepository, 'createWithinLimit' | 'findById' | 'listByTenant' | 'update' | 'delete' | 'pause' | 'resume'>;

export interface OfferHuntCrudDeps {
  hunts: Hunts;
  entitlements: IEntitlementReader;
  now?: () => Date;
}

/** Só campos conhecidos (o corpo HTTP já é fechado pelo schema; isto blinda chamadas internas). */
function pickDefinition(input: OfferHuntDefinitionInput): OfferHuntDefinitionInput {
  const out: OfferHuntDefinitionInput = {};
  const keys: (keyof OfferHuntDefinition)[] = [
    'name', 'sort', 'categoryId', 'commissionBand', 'keyword', 'filters', 'aiEnabled', 'topN', 'repeatAfterDays',
    'deliveryMode', 'intervalMinutes', 'windowStartMinute', 'windowEndMinute', 'weekdaysMask',
  ];
  for (const k of keys) if (input[k] !== undefined) (out as Record<string, unknown>)[k] = input[k];
  return out;
}

function checked(def: OfferHuntDefinition): OfferHuntDefinition {
  const r = validateHuntDefinition(def);
  if (!r.ok) throw new OfferInvalidInputError(r.reason, r.field);
  return r.value;
}

const schedule = (d: OfferHuntDefinition) => ({
  intervalMinutes: d.intervalMinutes, startMinute: d.windowStartMinute, endMinute: d.windowEndMinute, weekdaysMask: d.weekdaysMask,
});

async function requireHunterEnabled(entitlements: IEntitlementReader, tenantId: string): Promise<void> {
  if ((await entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) !== true) {
    throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
  }
}

async function load(hunts: Pick<IOfferHuntRepository, 'findById'>, tenantId: string, id: string): Promise<OfferHunt> {
  const hunt = await hunts.findById(tenantId, id);
  if (!hunt) throw new OfferHuntNotFoundError();
  return hunt;
}

abstract class OfferHuntUseCase {
  protected readonly now: () => Date;
  constructor(protected readonly deps: OfferHuntCrudDeps) {
    this.now = deps.now ?? (() => new Date());
  }
}

/** Cria ativa, sob o teto de caçadas do tenant (atômico no repositório), com a 1ª execução agendada. */
export class CreateOfferHuntUseCase extends OfferHuntUseCase {
  async execute(input: { tenantId: string; definition: OfferHuntDefinitionInput }): Promise<OfferHunt> {
    const { tenantId } = input;
    await requireHunterEnabled(this.deps.entitlements, tenantId);
    const def = checked({ ...OFFER_HUNT_DEFAULTS, name: '', ...pickDefinition(input.definition) });
    const created = await this.deps.hunts.createWithinLimit(
      { ...def, tenantId, nextRunAt: nextHuntRunAt(this.now(), schedule(def)) },
      HUNTER_LIMITS.huntsPerTenantMax,
    );
    if (!created) throw new OfferHuntLimitReachedError(HUNTER_LIMITS.huntsPerTenantMax);
    return created;
  }
}

/** Edita (parcial). Ativa: a próxima execução é recalculada a partir de agora; pausada fica sem agenda nova. */
export class UpdateOfferHuntUseCase extends OfferHuntUseCase {
  async execute(input: { tenantId: string; huntId: string; definition: OfferHuntDefinitionInput }): Promise<OfferHunt> {
    const { tenantId, huntId } = input;
    const current = await load(this.deps.hunts, tenantId, huntId);
    const def = checked({ ...current, ...pickDefinition(input.definition) });
    const patch = current.status === 'ACTIVE' ? { ...def, nextRunAt: nextHuntRunAt(this.now(), schedule(def)) } : def;
    const updated = await this.deps.hunts.update(tenantId, huntId, patch);
    if (!updated) throw new OfferHuntNotFoundError();
    return updated;
  }
}

/** Exclui; execuções e achados ficam no histórico (huntId vira null). */
export class DeleteOfferHuntUseCase extends OfferHuntUseCase {
  async execute(input: { tenantId: string; huntId: string }): Promise<void> {
    if (!(await this.deps.hunts.delete(input.tenantId, input.huntId))) throw new OfferHuntNotFoundError();
  }
}

/** Pausa pelo usuário (motivo `USER`; substitui pausa automática anterior). */
export class PauseOfferHuntUseCase extends OfferHuntUseCase {
  async execute(input: { tenantId: string; huntId: string }): Promise<OfferHunt> {
    const { tenantId, huntId } = input;
    if (!(await this.deps.hunts.pause(tenantId, huntId, 'USER'))) throw new OfferHuntNotFoundError();
    return load(this.deps.hunts, tenantId, huntId);
  }
}

/** Retoma: limpa motivo, zera falhas e agenda a próxima a partir de agora. Já ativa: devolve como está. */
export class ResumeOfferHuntUseCase extends OfferHuntUseCase {
  async execute(input: { tenantId: string; huntId: string }): Promise<OfferHunt> {
    const { tenantId, huntId } = input;
    const hunt = await load(this.deps.hunts, tenantId, huntId);
    if (hunt.status === 'ACTIVE') return hunt;
    await requireHunterEnabled(this.deps.entitlements, tenantId);
    await this.deps.hunts.resume(tenantId, huntId, nextHuntRunAt(this.now(), schedule(hunt)));
    return load(this.deps.hunts, tenantId, huntId);
  }
}

export class GetOfferHuntUseCase extends OfferHuntUseCase {
  execute(input: { tenantId: string; huntId: string }): Promise<OfferHunt> {
    return load(this.deps.hunts, input.tenantId, input.huntId);
  }
}

/** Todas do tenant (no máx. 5), mais nova primeiro: lista curta, sem paginação. */
export class ListOfferHuntsUseCase extends OfferHuntUseCase {
  execute(tenantId: string): Promise<OfferHunt[]> {
    return this.deps.hunts.listByTenant(tenantId);
  }
}
