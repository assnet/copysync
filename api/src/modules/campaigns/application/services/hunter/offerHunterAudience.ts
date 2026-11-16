import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IFeatureAudienceReader } from '../../../../tenants/domain/contracts/IFeatureAudienceRepository';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';

export interface OfferHunterAudienceInput {
  /** Do token (`request.user.isSuperAdmin`), não do papel no tenant. */
  isSuperAdmin: boolean;
  /** Tenant já validado (membro ou super admin); null = sem tenant resolvido. */
  tenantId: string | null;
}

/**
 * Portão de audiência do caçador (rotas e menu), pela flag do admin (`platform_settings.feature_audience`,
 * "Só super admin" em `/admin/plan-entitlements`; nunca gravada = `OFFER_HUNTER_AUDIENCE`). Ligada: só super
 * admin, sem olhar o plano (a execução cobra os portões do plano à parte). Desligada: qualquer membro de tenant com
 * `offer_hunter_enabled === true` (ausente = fora). Sem estado: flag e entitlement lidos a cada uso.
 */
export class OfferHunterAudienceGate {
  constructor(
    private readonly entitlements: Pick<IEntitlementReader, 'getBoolean'>,
    private readonly audience: IFeatureAudienceReader,
  ) {}

  /** Flag atual: `true` = só super admin. */
  superAdminOnly(): Promise<boolean> {
    return this.audience.superAdminOnly(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
  }

  /** `superAdminOnly` já lido (o `/access` decide antes se precisa do tenant). */
  async allows(input: OfferHunterAudienceInput, superAdminOnly?: boolean): Promise<boolean> {
    const onlySuperAdmin = superAdminOnly ?? (await this.superAdminOnly());
    if (onlySuperAdmin) return input.isSuperAdmin === true;
    if (!input.tenantId) return false;
    return (await this.entitlements.getBoolean(input.tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) === true;
  }
}
