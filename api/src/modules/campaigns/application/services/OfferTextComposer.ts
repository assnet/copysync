import type { IAiTextGenerator } from '../../../assistants/domain/contracts/IAiTextGenerator';
import type { OfferAudience } from '../../domain/enums/OfferAudience';
import {
  buildOfferTextPrompt,
  ensureOfferLink,
  OFFER_AI_MAX_OUTPUT_TOKENS,
} from '../../domain/services/buildOfferTextPrompt';
import { renderOfferText } from '../../domain/services/renderOfferText';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

/** Plano sem reescrita com IA (`ai_rewrite_enabled` = false, LITE): sai o modelo, sem chamar a IA. */
export const AI_PLAN_UNAVAILABLE = 'AI_PLAN_UNAVAILABLE';

export const OFFER_TEXT_AI_PURPOSE = 'offer.text';
/** Teto do texto gravado (o mesmo da edição manual). */
const TEXT_HARD_MAX = 4096;

export interface ComposeOfferTextInput {
  tenantId: string;
  audience: OfferAudience;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  coupon: string | null;
  affiliateUrl: string;
}

export interface ComposedOfferText {
  text: string;
  /** true = público pedia IA, mas saiu o modelo fixo. */
  aiFallback: boolean;
  /** Código `AI_*` (ou `AI_EMPTY_RESPONSE`) quando houve fallback. */
  aiErrorCode?: string;
}

/**
 * Texto da oferta: `STANDARD` usa o modelo fixo; os demais públicos pedem à IA e caem no modelo
 * em qualquer erro `AI_*`. O link exato é garantido no fim. Prompt e resposta nunca vão para log.
 */
export class OfferTextComposer {
  constructor(
    private readonly ai: IAiTextGenerator,
    /** Ausente = sem trava de plano (testes antigos). Só `false` explícito bloqueia. */
    private readonly entitlements?: Pick<IEntitlementReader, 'getBoolean'>,
  ) {}

  async compose(input: ComposeOfferTextInput): Promise<ComposedOfferText> {
    const template = () =>
      renderOfferText({
        title: input.title,
        priceCents: input.priceCents,
        originalPriceCents: input.originalPriceCents,
        affiliateUrl: input.affiliateUrl,
        coupon: input.coupon,
      });
    if (input.audience === 'STANDARD') return { text: template(), aiFallback: false };
    // Trava única do plano: cobre gerar, gerar novamente e monitoramento (vale também com chave do tenant)
    if (this.entitlements && (await this.entitlements.getBoolean(input.tenantId, ENTITLEMENT_KEYS.AI_REWRITE_ENABLED)) === false) {
      return { text: template(), aiFallback: true, aiErrorCode: AI_PLAN_UNAVAILABLE };
    }

    const { system, prompt } = buildOfferTextPrompt({ ...input, audience: input.audience });
    try {
      const result = await this.ai.generate({
        tenantId: input.tenantId,
        purpose: OFFER_TEXT_AI_PURPOSE,
        system,
        prompt,
        maxOutputTokens: OFFER_AI_MAX_OUTPUT_TOKENS,
      });
      const raw = result.text?.trim() ?? '';
      if (!raw) return { text: template(), aiFallback: true, aiErrorCode: 'AI_EMPTY_RESPONSE' };
      const text = ensureOfferLink(raw, input.affiliateUrl);
      if (text === null) return { text: template(), aiFallback: true, aiErrorCode: 'AI_RESPONSE_INVALID' };
      if (text.length > TEXT_HARD_MAX) return { text: template(), aiFallback: true, aiErrorCode: 'AI_RESPONSE_TOO_LONG' };
      return { text, aiFallback: false };
    } catch (err) {
      if (err instanceof AppError && err.code.startsWith('AI_')) {
        logger.warn({ tenantId: input.tenantId, code: err.code }, 'offer text AI fallback');
        return { text: template(), aiFallback: true, aiErrorCode: err.code };
      }
      throw err;
    }
  }
}
