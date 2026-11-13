import type { SuggestHuntConfigOutput } from '../../application/use-cases/hunter/SuggestHuntConfigUseCase';

/** Rascunho da IA para o assistente: campos explícitos (nada além do que o schema da resposta conhece). */
export const OfferHuntAiSuggestPresenter = {
  suggestion(out: SuggestHuntConfigOutput) {
    const { draft } = out;
    return {
      draft: {
        provider: draft.provider,
        name: draft.name,
        categoryId: draft.categoryId,
        keyword: draft.keyword,
        sort: draft.sort,
        sourceOptions: { ...draft.sourceOptions },
        filters: { ...draft.filters },
        aiEnabled: draft.aiEnabled,
        topN: draft.topN,
      },
      reasons: { ...out.reasons },
      dropped: [...out.dropped],
      sourceUsed: out.sourceUsed,
      remainingToday: out.remainingToday,
    };
  },
};
