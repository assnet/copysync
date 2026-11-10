import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { AFFILIATE_PROVIDERS, type AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import { currentRiskNoticeVersion } from '../../domain/services/marketplaceRiskNotice';
import { marketplaceEntitlementKey } from '../../../campaigns/domain/services/marketplaceEntitlement';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IPlanEntitlementPresetRepository } from '../../../tenants/domain/contracts/IPlanEntitlementPresetRepository';
import { PLAN_SLUGS, type PlanSlug } from '../../../tenants/domain/planPresets';

export interface MarketplaceRiskNoticeState {
  version: string;
  /** Aceite da versão vigente pelo tenant; null = falta aceitar (ou versão nova). */
  acceptedAt: Date | null;
  acceptedByMe: boolean;
}

export interface MarketplaceAvailability {
  /** O plano do tenant libera o marketplace. Provider sem chave de plano = true. */
  enabled: boolean;
  /** Planos cujo preset libera o marketplace (selo do card travado). Provider sem chave = []. */
  plans: PlanSlug[];
  /** null = marketplace sem aviso de risco. */
  riskNotice: MarketplaceRiskNoticeState | null;
}

export interface AffiliateCredentialListResult {
  items: AffiliateCredential[];
  marketplaceAvailability: Record<AffiliateProvider, MarketplaceAvailability>;
}

export interface ListAffiliateCredentialsInput {
  tenantId: string;
  userId: string;
}

/** Lista as credenciais do tenant. Não usa a cifra: responde mesmo sem chave configurada. */
export class ListAffiliateCredentialsUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly entitlements: IEntitlementReader,
    private readonly presets: IPlanEntitlementPresetRepository,
    private readonly riskAcceptances: IMarketplaceRiskAcceptanceRepository,
  ) {}

  async execute(input: ListAffiliateCredentialsInput): Promise<AffiliateCredentialListResult> {
    const keys = AFFILIATE_PROVIDERS.map(marketplaceEntitlementKey).filter((k): k is NonNullable<typeof k> => k !== null);
    const [items, presetRows] = await Promise.all([
      this.repo.listByTenant(input.tenantId),
      this.presets.listByKeys(keys),
    ]);

    const entries = await Promise.all(
      AFFILIATE_PROVIDERS.map(async (provider): Promise<[AffiliateProvider, MarketplaceAvailability]> => {
        const key = marketplaceEntitlementKey(provider);
        const enabled = key === null || (await this.entitlements.getBoolean(input.tenantId, key)) === true;
        const plans = key === null
          ? []
          : PLAN_SLUGS.filter((plan) => presetRows.some((r) => r.key === key && r.planSlug === plan && r.value === true));
        return [provider, { enabled, plans, riskNotice: await this.riskNotice(input, provider) }];
      }),
    );

    return {
      items,
      marketplaceAvailability: Object.fromEntries(entries) as Record<AffiliateProvider, MarketplaceAvailability>,
    };
  }

  private async riskNotice(
    input: ListAffiliateCredentialsInput,
    provider: AffiliateProvider,
  ): Promise<MarketplaceRiskNoticeState | null> {
    const version = currentRiskNoticeVersion(provider);
    if (version === null) return null;
    const accepted = await this.riskAcceptances.findCurrent(input.tenantId, provider, version);
    return {
      version,
      acceptedAt: accepted?.acceptedAt ?? null,
      acceptedByMe: accepted?.acceptedByUserId === input.userId,
    };
  }
}
