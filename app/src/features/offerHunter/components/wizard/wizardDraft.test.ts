import { describe, expect, it } from 'vitest';
import { huntOptions, mlOptions } from '../../test/fixtures';
import type { HuntAiSuggestion } from '../../types';
import { applyAiSuggestion, initialDraft, seedProvider } from './wizardDraft';

const suggestion = (provider: 'SHEIN' | 'MERCADO_LIVRE', filters: HuntAiSuggestion['draft']['filters']): HuntAiSuggestion => ({
  draft: { provider, name: 'Sugerida', categoryId: null, keyword: null, sort: null, sourceOptions: {}, filters, aiEnabled: null, topN: null },
  reasons: { 'filters.onlyWithExtra': 'Ganho maior' },
  dropped: [],
  sourceUsed: false,
  remainingToday: 3,
});

describe('applyAiSuggestion', () => {
  it('sugestão de outra loja não é aplicada', () => {
    const draft = seedProvider({ ...initialDraft(mlOptions()), provider: 'MERCADO_LIVRE' }, mlOptions());
    expect(applyAiSuggestion(draft, suggestion('SHEIN', { minDiscountPct: 30 }), huntOptions())).toBe(draft);
  });

  it('ML: "só com extra" local vira o filtro da fonte, com o motivo da IA', () => {
    const draft = seedProvider({ ...initialDraft(mlOptions()), provider: 'MERCADO_LIVRE' }, mlOptions());
    const out = applyAiSuggestion(draft, suggestion('MERCADO_LIVRE', { onlyWithExtra: true }), mlOptions());
    expect(out.filters.onlyWithExtra).toBeNull();
    expect(out.sourceOptions.extraEarningsOnly).toBe(true);
    expect(out.ai.hints).toEqual(expect.objectContaining({ 'sourceOptions.extraEarningsOnly': 'Ganho maior' }));
    expect(out.ai.hints).not.toHaveProperty('filters.onlyWithExtra');
  });

  it('SHEIN: "só com extra" fica no filtro local', () => {
    const draft = seedProvider({ ...initialDraft(huntOptions()), provider: 'SHEIN' }, huntOptions());
    const out = applyAiSuggestion(draft, suggestion('SHEIN', { onlyWithExtra: true }), huntOptions());
    expect(out.filters.onlyWithExtra).toBe(true);
    expect(out.ai.hints).toHaveProperty('filters.onlyWithExtra');
  });
});
