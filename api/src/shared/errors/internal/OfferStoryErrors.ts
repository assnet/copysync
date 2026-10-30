import { AppError } from '../AppError';

// ── Story de Oferta (.specs/features/offer-story/design.md "Erros") ─────────
//
// Link fora da allowlist/sem afiliação reusa `OFFER_*` (OfferErrors.ts); cupom inválido reusa
// `OFFER_INVALID_INPUT`; falha do renderer reusa `MEDIA_PROCESSING_FAILED`.

/** `templateId` fora do catálogo. */
export class OfferStoryTemplateNotFoundError extends AppError {
  constructor(templateId: string) {
    super('OFFER_STORY_TEMPLATE_NOT_FOUND', 'Story template not found', 400, { templateId });
  }
}

/** Produto extraído sem o mínimo para a arte (título). */
export class OfferStoryProductIncompleteError extends AppError {
  constructor() {
    super('OFFER_STORY_PRODUCT_INCOMPLETE', 'Product title could not be read from the link', 422);
  }
}
