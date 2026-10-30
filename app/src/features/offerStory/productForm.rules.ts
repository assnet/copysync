/** Mesmas regras do schema da API (`offer-story/domain/offerStoryRules.ts`). A API revalida. */
export const OFFER_STORY_RULES = {
  couponMax: 20,
  discountMin: 1,
  discountMax: 90,
  /** Igual ao gerador de ofertas: letras, números, `_ . -` e espaço. */
  couponPattern: /^[\p{L}\p{N}_.\- ]+$/u,
} as const;
