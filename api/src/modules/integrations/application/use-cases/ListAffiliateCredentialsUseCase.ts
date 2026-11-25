import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { AFFILIATE_PROVIDERS, type AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import { currentRiskNoticeVersion } from '../../domain/services/marketplaceRiskNotice';
import { affiliateIdentifierLimitKey } from '../../domain/services/affiliateIdentifierEntitlement';
import { identifierLimitOf } from '../../../tenants/domain/services/affiliateIdentifierLimit';
import { marketplaceEntitlementKey } from '../../../campaigns/domain/services/marketplaceEntitlement';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IPlanEntitlementPresetRepository } from '../../../tenants/domain/contracts/IPlanEntitlementPresetRepository';
import { PLAN_SLUGS, type PlanSlug } from '../../../tenants/domain/planPresets';
import type { FeatureAudienceViewer } from '../../../tenants/application/services/FeatureAudienceGate';
import type { MarketplaceAudienceGate } from '../../../campaigns/application/services/MarketplaceAudienceGate';

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
  /** Só as lojas visíveis ao viewer: ausência = loja oculta (o painel esconde o card). */
  marketplaceAvailability: Partial<Record<AffiliateProvider, MarketplaceAvailability>>;
  /** Limite efetivo de etiquetas vinculadas, só para provider com lista da conta (hoje o ML). */
  identifierLimits: Partial<Record<AffiliateProvider, number>>;
}

export interface ListAffiliateCredentialsInput {
  tenantId: string;
  userId: string;
  /** Loja com audiência "Só super admin" some de `items` e de `marketplaceAvailability` para quem não a vê. */
  viewer: FeatureAudienceViewer;
}

/** Lista as credenciais do tenant. Não usa a cifra: responde mesmo sem chave configurada. */
export class ListAffiliateCredentialsUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly entitlements: IEntitlementReader,
    private readonly presets: IPlanEntitlementPresetRepository,
    private readonly riskAcceptances: IMarketplaceRiskAcceptanceRepository,
    private readonly audience: Pick<MarketplaceAudienceGate, 'isVisible'>,
  ) {}

  async execute(input: ListAffiliateCredentialsInput): Promise<AffiliateCredentialListResult> {
    const visibility = await Promise.all(AFFILIATE_PROVIDERS.map((p) => this.audience.isVisible(p, input.viewer)));
    const providers = AFFILIATE_PROVIDERS.filter((_, i) => visibility[i]);
    const keys = providers.map(marketplaceEntitlementKey).filter((k): k is NonNullable<typeof k> => k !== null);
    const [allItems, presetRows, identifierLimits] = await Promise.all([
      this.repo.listByTenant(input.tenantId),
      this.presets.listByKeys(keys),
      this.identifierLimits(input.tenantId),
    ]);

    const entries = await Promise.all(
      providers.map(async (provider): Promise<[AffiliateProvider, MarketplaceAvailability]> => {
        const key = marketplaceEntitlementKey(provider);
        const enabled = key === null || (await this.entitlements.getBoolean(input.tenantId, key)) === true;
        const plans = key === null
          ? []
          : PLAN_SLUGS.filter((plan) => presetRows.some((r) => r.key === key && r.planSlug === plan && r.value === true));
        return [provider, { enabled, plans, riskNotice: await this.riskNotice(input, provider) }];
      }),
    );

    return {
      items: allItems.filter((c) => providers.includes(c.provider)),
      marketplaceAvailability: Object.fromEntries(entries) as Partial<Record<AffiliateProvider, MarketplaceAvailability>>,
      identifierLimits,
    };
  }

  private async identifierLimits(tenantId: string): Promise<Partial<Record<AffiliateProvider, number>>> {
    const out: Partial<Record<AffiliateProvider, number>> = {};
    for (const provider of AFFILIATE_PROVIDERS) {
      const key = affiliateIdentifierLimitKey(provider);
      if (key) out[provider] = identifierLimitOf(await this.entitlements.getNumber(tenantId, key));
    }
    return out;
  }

  private async riskNotice(
    input: ListAffiliateCredentialsInput,
    provider: AffiliateProvider,
  ): Promise<MarketplaceRiskNoticeState | null> {
    const version = currentRiskNoticeVersion(provider);
    if (version === null) return null;
    const accepted = await this.riskAcceptances.findCurrent(input.tenantId, provider, 'AFFILIATE_LINK', version);
    return {
      version,
      acceptedAt: accepted?.acceptedAt ?? null,
      acceptedByMe: accepted?.acceptedByUserId === input.userId,
    };
  }
}
