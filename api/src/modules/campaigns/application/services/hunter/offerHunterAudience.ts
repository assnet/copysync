import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';

/** `OFFER_HUNTER_AUDIENCE`: prévia só para super admin, ou aberto a todo tenant com o entitlement. */
export type OfferHunterAudience = 'super_admin' | 'entitled';

export interface OfferHunterAudienceInput {
  audience: OfferHunterAudience;
  /** Do token (`request.user.isSuperAdmin`), não do papel no tenant. */
  isSuperAdmin: boolean;
  /** Tenant já validado (membro ou super admin); null = sem tenant resolvido. */
  tenantId: string | null;
}

/**
 * Portão de audiência do caçador (rotas e menu). `super_admin`: só super admin, sem olhar o plano (a
 * execução cobra os portões do plano à parte). `entitled`: qualquer membro de tenant com
 * `offer_hunter_enabled === true` (ausente = fora). Sem estado: a env e o entitlement são lidos a cada uso.
 */
export class OfferHunterAudienceGate {
  constructor(private readonly entitlements: Pick<IEntitlementReader, 'getBoolean'>) {}

  async allows(input: OfferHunterAudienceInput): Promise<boolean> {
    if (input.audience === 'super_admin') return input.isSuperAdmin === true;
    if (!input.tenantId) return false;
    return (await this.entitlements.getBoolean(input.tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) === true;
  }
}
