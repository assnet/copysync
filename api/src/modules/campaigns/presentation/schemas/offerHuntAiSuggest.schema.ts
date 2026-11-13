import { HUNT_PROVIDERS } from '../../domain/hunter/HuntProvider';
import { HUNTER_AI_LIMITS as AL } from '../../domain/services/hunter/hunterAiLimits';

/** Corpo de `POST /offer-hunts/ai-suggest`. A intenção é sanitizada de novo no use case (dado não confiável). */
export const aiSuggestBodySchema = {
  type: 'object',
  required: ['provider'],
  additionalProperties: false,
  properties: {
    provider: { type: 'string', enum: [...HUNT_PROVIDERS] },
    intent: { type: ['string', 'null'], maxLength: AL.intentMaxLength },
    pickProduct: { type: 'boolean', default: false },
  },
} as const;

const nullable = (type: string) => ({ type: [type, 'null'] });

/** Resposta fechada: só o rascunho validado, motivos, descartes e contagem. */
export const aiSuggestResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        draft: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            name: nullable('string'),
            categoryId: nullable('string'),
            keyword: nullable('string'),
            sort: nullable('string'),
            sourceOptions: {
              type: 'object',
              properties: { sort: nullable('string'), extraEarningsOnly: nullable('boolean'), bestSellersOnly: nullable('boolean') },
            },
            filters: {
              type: 'object',
              properties: {
                minPriceCents: nullable('integer'), maxPriceCents: nullable('integer'), minDiscountPct: nullable('integer'),
                minCommissionPct: nullable('number'), commissionOperator: nullable('string'), minCommissionCents: nullable('integer'),
                minRating: nullable('number'), minSales: nullable('integer'), minReviews: nullable('integer'),
                onlyWithExtra: nullable('boolean'), endsWithinDays: nullable('integer'),
              },
            },
            aiEnabled: nullable('boolean'),
            topN: nullable('integer'),
          },
        },
        reasons: { type: 'object', additionalProperties: { type: 'string' } },
        dropped: { type: 'array', items: { type: 'string' } },
        sourceUsed: { type: 'boolean' },
        remainingToday: { type: 'integer' },
      },
    },
  },
} as const;
