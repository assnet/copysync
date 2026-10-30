import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { normalizeCoupon } from '../../../campaigns/application/use-cases/offerCoupon';
import { findOfferStoryTemplate } from '../../domain/offerStoryTemplates';
import {
  OFFER_STORY_COUPON_MAX,
  OFFER_STORY_HEADLINE_AI_PURPOSE,
  OFFER_STORY_WARNINGS,
  type OfferStoryWarning,
} from '../../domain/offerStoryRules';
import { computeStoryPrice, type StoryPrice } from '../../domain/services/computeStoryPrice';
import { sanitizeStoryHeadline } from '../../domain/services/storyHeadline';
import { AppError } from '../../../../shared/errors/AppError';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import {
  OfferStoryProductIncompleteError,
  OfferStoryTemplateNotFoundError,
} from '../../../../shared/errors/internal/OfferStoryErrors';
import { logger } from '../../../../shared/logger/logger';
import { requireOfferStoryEnabled, type OfferStoryUseCaseDeps } from './offerStoryUseCaseDeps';

const AI_TIMEOUT_MS = 8_000;
const AI_MAX_OUTPUT_TOKENS = 80;
/** Sentinela do timeout da IA (não é erro de produto: vira fallback). */
const AI_TIMEOUT = new Error('AI_TIMEOUT');
const AI_SYSTEM = [
  'Você escreve títulos curtos para stories de ofertas no Instagram, em português do Brasil.',
  'Reescreva o nome do produto em no máximo 60 caracteres, mantendo marca, modelo e o que o produto é.',
  'Responda só com o título, em uma linha: sem aspas, sem emoji, sem preço, sem valores em reais e sem hashtags.',
].join(' ');

export interface RenderOfferStoryInput {
  tenantId: string;
  templateId: string;
  url: string;
  coupon?: { code: string; discountPercent?: number | null } | null;
}

export interface RenderOfferStoryOutput {
  /** `data:image/jpeg;base64,...` (JSON padrão: erros e gate iguais às outras rotas). */
  image: string;
  width: number;
  height: number;
  templateId: string;
  headline: string;
  provider: AffiliateProvider;
  affiliateUrl: string;
  attributionVerified: boolean;
  price: StoryPrice;
  coupon: { code: string; discountPercent: number | null } | null;
  warnings: OfferStoryWarning[];
}

/**
 * Link colado → arte 1080×1920 do story (design.md "Aplicação", passos 1–10). Nada é gravado:
 * a arte volta em data URL. IA e foto nunca derrubam a arte (viram `warnings`).
 */
export class RenderOfferStoryUseCase {
  constructor(private readonly deps: OfferStoryUseCaseDeps) {}

  async execute(input: RenderOfferStoryInput): Promise<RenderOfferStoryOutput> {
    const { tenantId } = input;
    await requireOfferStoryEnabled(this.deps.entitlements, tenantId);

    const template = findOfferStoryTemplate(input.templateId);
    if (!template) throw new OfferStoryTemplateNotFoundError(input.templateId);

    const coupon = this.parseCoupon(input.coupon);

    // Erros OFFER_* (allowlist, dono do link, sem afiliação) sobem como estão
    const resolved = await this.deps.resolveProduct.execute(tenantId, input.url);
    const { product } = resolved;
    const title = product.title?.trim();
    if (!title) throw new OfferStoryProductIncompleteError();

    const warnings = new Set<OfferStoryWarning>();
    const [productImage, headline] = await Promise.all([
      this.fetchImage(product.imageSourceUrl),
      this.headline(tenantId, title),
    ]);
    if (headline.fallback) warnings.add('AI_FALLBACK');

    const price = computeStoryPrice(product, coupon?.discountPercent ?? null);
    if (price.toCents === null) warnings.add('NO_PRICE');

    let rendered;
    try {
      rendered = await this.deps.renderer.render({ template, headline: headline.text, productImage, price, coupon });
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ tenantId, templateId: template.id, err }, 'offer story render failed');
      throw new MediaProcessingFailedError('Offer story render failed');
    }
    if (!productImage || rendered.imageDropped) warnings.add('NO_IMAGE');

    return {
      image: `data:${rendered.mimeType};base64,${rendered.buffer.toString('base64')}`,
      width: rendered.width,
      height: rendered.height,
      templateId: template.id,
      headline: headline.text,
      provider: resolved.provider,
      affiliateUrl: resolved.affiliateUrl,
      attributionVerified: resolved.attributionVerified,
      price,
      coupon,
      warnings: OFFER_STORY_WARNINGS.filter((w) => warnings.has(w)),
    };
  }

  /** Código obrigatório (padrão do gerador) e ≤ 20 na arte; `discountPercent` sem código já barrado no schema. */
  private parseCoupon(raw: RenderOfferStoryInput['coupon']): RenderOfferStoryOutput['coupon'] {
    if (!raw) return null;
    const code = normalizeCoupon(raw.code);
    if (code === null) throw new OfferInvalidInputError('Coupon code is required', 'coupon');
    if (code.length > OFFER_STORY_COUPON_MAX) {
      throw new OfferInvalidInputError(`Coupon exceeds ${OFFER_STORY_COUPON_MAX} characters`, 'coupon');
    }
    return { code, discountPercent: raw.discountPercent ?? null };
  }

  /** Bytes da foto ou null (sem URL, fora da allowlist, falha de rede). */
  private async fetchImage(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      return (await this.deps.imageFetcher.fetch(url))?.buffer ?? null;
    } catch {
      return null;
    }
  }

  /** Título curto pela IA; qualquer erro, timeout ou resposta inválida → título original. Prompt/resposta fora do log. */
  private async headline(tenantId: string, title: string): Promise<{ text: string; fallback: boolean }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(AI_TIMEOUT), this.deps.aiTimeoutMs ?? AI_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.deps.ai.generate({
          tenantId,
          purpose: OFFER_STORY_HEADLINE_AI_PURPOSE,
          system: AI_SYSTEM,
          prompt: title,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        }),
        timeout,
      ]);
      const text = sanitizeStoryHeadline(result.text);
      if (text) return { text, fallback: false };
      logger.warn({ tenantId, code: 'AI_RESPONSE_INVALID' }, 'offer story headline AI fallback');
    } catch (err) {
      // Mensagem de erro cru não vai ao log (pode ecoar a resposta do provedor)
      const code = err instanceof AppError ? err.code : err === AI_TIMEOUT ? 'AI_TIMEOUT' : 'AI_UNEXPECTED_ERROR';
      logger.warn({ tenantId, code }, 'offer story headline AI fallback');
    } finally {
      clearTimeout(timer);
    }
    return { text: title, fallback: true };
  }
}
