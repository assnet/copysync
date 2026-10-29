import type { IPublicPageRenderer, PublicPageAddress, RenderedPublicPage } from '../../domain/contracts/IPublicPageRenderer';
import { StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import type { StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { storefrontPublicUrl, toStorefrontTemplateModel } from './storefrontPageModel';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'offers' | 'domains' | 'template'>;

/**
 * Página pública `<slug>.<domínio>` (sem tenant context: o Host decide). Status espelha o rodízio
 * (design §4.2): sem página → null (hook segue o fallback → 404 da marca); tenant não ativo → 503
 * genérica (sem dado do tenant); `PAUSED_BY_PLAN` → 200 pausada; ativa sem publicadas → 200
 * "em breve"; ativa com publicadas → 200, única resposta cacheável.
 */
export class RenderPublicStorefrontUseCase implements IPublicPageRenderer {
  constructor(private readonly deps: Deps) {}

  async render(address: PublicPageAddress): Promise<RenderedPublicPage | null> {
    const { storefronts, offers, domains, template } = this.deps;
    const found = await storefronts.findPublicByAddress(address.domainId, address.slug);
    if (!found) return null;
    const { storefront: page, tenantActive } = found;

    if (!tenantActive) return { status: 503, ...template.unavailable(), cacheable: false };
    if (page.status === StorefrontStatus.PAUSED_BY_PLAN) return { status: 200, ...template.paused(page.title), cacheable: false };

    const published = await offers.listPublished(page.tenantId, page.id);
    if (published.length === 0) return { status: 200, ...template.comingSoon(page.title), cacheable: false };

    const domain = await domains.findById(address.domainId);
    const publicUrl = domain ? storefrontPublicUrl(domain.hostname, address.slug) : '';
    const rendered = template.page(toStorefrontTemplateModel(page, published, publicUrl), { isPreview: false });
    return { status: 200, ...rendered, cacheable: true };
  }
}
