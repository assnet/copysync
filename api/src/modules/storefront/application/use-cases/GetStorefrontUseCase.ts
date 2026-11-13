import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { STOREFRONT_CATEGORIES } from '../../domain/services/storefrontCategories';
import { STOREFRONT_SUBTITLE_SUGGESTIONS } from '../../domain/services/storefrontRules';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import type { StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { storefrontPublicUrl } from './storefrontPageModel';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'offers' | 'entitlements' | 'domains'>;

export interface GetStorefrontOutput {
  /** null = tenant ainda não criou a página (o painel abre o form vazio). */
  storefront: Storefront | null;
  /** `https://<slug>.<hostname>`; null sem página ou sem endereço. */
  publicUrl: string | null;
  offers: { drafts: StorefrontOffer[]; published: StorefrontOffer[] };
  /** Catálogo fixo (chave + rótulo pt-BR) para os chips do form. */
  categories: { key: string; label: string }[];
  subtitleSuggestions: readonly string[];
  /** Domínios ACTIVE para o tenant escolher o endereço. */
  domains: { id: string; hostname: string }[];
  /**
   * Presente só quando o plano não libera a página mas ela existe: resumo para o tenant conseguir
   * excluir (ofertas, catálogo e domínios vêm vazios; nada é editável, as demais rotas seguem 403).
   */
  planLocked?: { offersCount: number };
}

/** Tela da página: configuração, ofertas por aba e o que o form precisa para escolher. */
export class GetStorefrontUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<GetStorefrontOutput> {
    const { storefronts, offers, domains, entitlements } = this.deps;
    const enabled = (await entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.STOREFRONT_ENABLED)) === true;
    if (!enabled) return this.planLocked(tenantId);

    const [page, active] = await Promise.all([storefronts.findByTenant(tenantId), domains.listActive()]);
    const list = page ? await offers.listByStorefront(tenantId, page.id) : [];

    let publicUrl: string | null = null;
    if (page?.address) {
      const { domainId, slug } = page.address;
      // Domínio pausado sai de `listActive`, mas o endereço gravado continua sendo o da página.
      const domain = active.find((d) => d.id === domainId) ?? (await domains.findById(domainId));
      if (domain) publicUrl = storefrontPublicUrl(domain.hostname, slug);
    }

    return {
      storefront: page,
      publicUrl,
      offers: {
        drafts: list.filter((o) => o.status === StorefrontOfferStatus.DRAFT),
        published: list.filter((o) => o.status === StorefrontOfferStatus.PUBLISHED),
      },
      categories: STOREFRONT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
      subtitleSuggestions: STOREFRONT_SUBTITLE_SUGGESTIONS,
      domains: active.map((d) => ({ id: d.id, hostname: d.hostname })),
    };
  }

  /**
   * Plano sem a página. Sem página criada: 403 como sempre (o painel leva aos planos). Com página
   * (perdeu o plano): resumo só para chegar à exclusão. Status é sempre o efetivo `PAUSED_BY_PLAN`,
   * mesmo se a linha ainda não foi atualizada pelo billing.
   */
  private async planLocked(tenantId: string): Promise<GetStorefrontOutput> {
    const { storefronts, offers, domains } = this.deps;
    const page = await storefronts.findByTenant(tenantId);
    if (!page) throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.STOREFRONT_ENABLED);

    const [counts, domain] = await Promise.all([
      offers.countByStorefront(tenantId, page.id),
      page.address ? domains.findById(page.address.domainId) : null,
    ]);
    return {
      storefront: { ...page, status: StorefrontStatus.PAUSED_BY_PLAN },
      publicUrl: domain && page.address ? storefrontPublicUrl(domain.hostname, page.address.slug) : null,
      offers: { drafts: [], published: [] },
      categories: [],
      subtitleSuggestions: [],
      domains: [],
      planLocked: { offersCount: counts.total },
    };
  }
}
