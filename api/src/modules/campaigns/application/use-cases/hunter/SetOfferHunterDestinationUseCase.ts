import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { IOfferGeneratorConfigRepository } from '../../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IBroadcastGroupUsageReader } from '../../../domain/contracts/IBroadcastGroupUsageReader';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHunterSettings } from '../../../domain/hunter/OfferHunt';
import { countDistinctBroadcastGroups, type BroadcastGroupRow } from '../../../domain/services/broadcastGroupUnion';
import { channelOfEngine, limitKeyOfChannel } from '../../../../tenants/domain/channelLimits';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';
import { OfferInvalidInputError } from '../../../../../shared/errors/internal/OfferErrors';
import { PlanFeatureUnavailableError, PlanLimitReachedError } from '../../../../../shared/errors/internal/PlanErrors';

export interface SetOfferHunterDestinationInput {
  tenantId: string;
  sessionId: string;
  conversationId: string;
}

export interface SetOfferHunterDestinationDeps {
  settings: Pick<IOfferHunterSettingsRepository, 'upsert'>;
  /** Sessão do tenant e grupo da sessão: o mesmo filtro do gerador. */
  configs: Pick<IOfferGeneratorConfigRepository, 'findSession' | 'filterSessionGroups'>;
  /** União gerador ⋃ monitoramentos ⋃ caçador (D3). */
  groupUsage: Pick<IBroadcastGroupUsageReader, 'listRows'>;
  entitlements: IEntitlementReader;
}

/**
 * Grupo de destino do caçador (R4: 1 por tenant). Valida sessão e grupo do tenant e o limite de grupos de
 * disparo pela união (D3): grupo já usado pelo gerador ou monitoramento não conta de novo. Nada muda se falhar.
 */
export class SetOfferHunterDestinationUseCase {
  constructor(private readonly deps: SetOfferHunterDestinationDeps) {}

  async execute(input: SetOfferHunterDestinationInput): Promise<OfferHunterSettings> {
    const tenantId = input.tenantId;
    const sessionId = input.sessionId?.trim();
    const conversationId = input.conversationId?.trim();
    if (!sessionId) throw new OfferInvalidInputError('Session required', 'sessionId');
    if (!conversationId) throw new OfferInvalidInputError('Group required', 'conversationId');
    if ((await this.deps.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) !== true) {
      throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
    }
    const session = await this.deps.configs.findSession(tenantId, sessionId);
    if (!session) throw new NotFoundError('Session', sessionId);
    const [group] = await this.deps.configs.filterSessionGroups(tenantId, [sessionId], [conversationId]);
    if (!group) throw new NotFoundError('Group conversation', conversationId);

    const requested: BroadcastGroupRow & { engine: string } = {
      sessionId, groupJid: group.groupJid ?? `conversation:${conversationId}`, engine: session.engine,
    };
    const others = await this.deps.groupUsage.listRows(tenantId, { exceptHunter: true });
    const union = countDistinctBroadcastGroups<BroadcastGroupRow & { engine: string }>([...others, requested], (r) => r.engine);
    const channel = channelOfEngine(session.engine);
    const key = limitKeyOfChannel('broadcastGroups', channel);
    const limit = await this.deps.entitlements.getNumber(tenantId, key);
    if (limit !== null && union[channel] > limit) throw new PlanLimitReachedError(key, limit);

    return this.deps.settings.upsert(tenantId, sessionId, conversationId);
  }
}
