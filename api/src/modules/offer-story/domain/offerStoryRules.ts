/** Regras fixas do story de oferta (spec `.specs/features/offer-story/spec.md`). */
export const OFFER_STORY_COUPON_MAX = 20;
export const OFFER_STORY_DISCOUNT_MIN = 1;
export const OFFER_STORY_DISCOUNT_MAX = 90;
export const OFFER_STORY_HEADLINE_MAX = 60;
/** Rótulo gravado em `ai_usage_logs.purpose` (sem prompt nem resposta). */
export const OFFER_STORY_HEADLINE_AI_PURPOSE = 'offer_story_headline';

export const OFFER_STORY_WARNINGS = ['NO_IMAGE', 'NO_PRICE', 'AI_FALLBACK'] as const;
export type OfferStoryWarning = (typeof OFFER_STORY_WARNINGS)[number];
