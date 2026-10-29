import { isStorefrontCategory } from '../../domain/services/storefrontCategories';
import {
  normalizeHexColor,
  STOREFRONT_DEFAULT_COLORS,
  STOREFRONT_NAME_MAX_LENGTH,
  STOREFRONT_SUBTITLE_MAX_LENGTH,
} from '../../domain/services/storefrontRules';
import { normalizeSlug, validateSlug } from '../../../link-rotation/domain/services/slugRules';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { storefrontPublicUrl, toStorefrontTemplateModel } from './storefrontPageModel';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'offers' | 'entitlements' | 'domains' | 'template'>;

/** Rascunho do form (ainda não salvo). Campos soltos: a prévia nunca recusa, só normaliza. */
export interface PreviewStorefrontDraft {
  title: string;
  subtitle?: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: readonly string[];
  /** Endereço do rascunho; ausente = o da página. Só aparece no modelo (sem OG na prévia). */
  slug?: string;
  domainId?: string;
}

export interface PreviewStorefrontDTO {
  tenantId: string;
  draft: PreviewStorefrontDraft;
  viewport: 'mobile' | 'desktop';
}

const clip = (raw: string | null | undefined, max: number): string => (raw ?? '').trim().slice(0, max);

/**
 * HTML da prévia (iframe `sandbox` no painel). Validação leve, sem erro: cor fora de `#RRGGBB`
 * vira o padrão, categoria fora do catálogo some, texto é cortado no limite. Ofertas = publicadas
 * do tenant; sem nenhuma, o template mostra exemplos com selo. Fotos vêm da página salva.
 */
export class PreviewStorefrontUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: PreviewStorefrontDTO): Promise<{ html: string }> {
    const { tenantId, draft } = input;
    await requireStorefrontEnabled(this.deps.entitlements, tenantId);
    const page = await this.deps.storefronts.findByTenant(tenantId);
    const offers = page ? await this.deps.offers.listPublished(tenantId, page.id) : [];

    const categories = [...new Set(draft.categories.filter(isStorefrontCategory))];
    const model = toStorefrontTemplateModel(
      {
        title: clip(draft.title, STOREFRONT_NAME_MAX_LENGTH),
        subtitle: clip(draft.subtitle, STOREFRONT_SUBTITLE_MAX_LENGTH) || null,
        avatarUrl: page?.avatarUrl ?? null,
        coverUrl: page?.coverUrl ?? null,
        colorPrimary: normalizeHexColor(draft.colorPrimary) ?? STOREFRONT_DEFAULT_COLORS.colorPrimary,
        colorBackground: normalizeHexColor(draft.colorBackground) ?? STOREFRONT_DEFAULT_COLORS.colorBackground,
        colorCard: normalizeHexColor(draft.colorCard) ?? STOREFRONT_DEFAULT_COLORS.colorCard,
        categories,
      },
      offers,
      await this.publicUrl(draft.domainId ?? page?.address?.domainId, draft.slug ?? page?.address?.slug),
    );
    const { html } = this.deps.template.page(model, { isPreview: true, viewport: input.viewport });
    return { html };
  }

  /** Endereço só se o nome tem formato válido e o domínio existe; senão vazio (sem erro). */
  private async publicUrl(domainId: string | undefined, raw: string | undefined): Promise<string> {
    if (!domainId || !raw || validateSlug(raw).kind === 'invalid') return '';
    const domain = await this.deps.domains.findById(domainId);
    return domain ? storefrontPublicUrl(domain.hostname, normalizeSlug(raw)) : '';
  }
}
