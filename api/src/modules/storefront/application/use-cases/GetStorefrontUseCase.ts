import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { STOREFRONT_CATEGORIES } from '../../domain/services/storefrontCategories';
import { STOREFRONT_SUBTITLE_SUGGESTIONS } from '../../domain/services/storefrontRules';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
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
}

/** Tela da página: configuração, ofertas por aba e o que o form precisa para escolher. */
export class GetStorefrontUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<GetStorefrontOutput> {
    await requireStorefrontEnabled(this.deps.entitlements, tenantId);
    const { storefronts, offers, domains } = this.deps;

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
}
