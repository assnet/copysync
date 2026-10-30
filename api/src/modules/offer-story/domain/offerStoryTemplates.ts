/**
 * Catálogo de templates do story (ordem = ordem da grade no painel). Só identidade e tamanho:
 * o visual de cada id vive no renderer (`infrastructure/adapters/templates/`), e o teste do
 * renderer exige um layout por id. Thumbnail: `app/public/assets/offer-story/<id>.webp`.
 */
export interface OfferStoryTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
}

const STORY = { width: 1080, height: 1920 } as const;

export const OFFER_STORY_TEMPLATES: readonly OfferStoryTemplate[] = [
  { id: 'flash-night', name: 'Oferta relâmpago', ...STORY },
  { id: 'blue-burst', name: 'Super oferta', ...STORY },
  { id: 'pink-week', name: 'Promoção da semana', ...STORY },
  { id: 'gold-neon', name: 'Achadinho do dia', ...STORY },
  { id: 'fresh-mint', name: 'Baixou o preço', ...STORY },
  { id: 'hot-deal', name: 'Oferta quente', ...STORY },
  { id: 'clean-light', name: 'Vale cada centavo', ...STORY },
  { id: 'news-violet', name: 'Novidade', ...STORY },
];

export function findOfferStoryTemplate(id: string): OfferStoryTemplate | null {
  return OFFER_STORY_TEMPLATES.find((t) => t.id === id) ?? null;
}
