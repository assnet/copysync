import type { HuntCandidate } from '../../../domain/hunter/HuntCandidate';
import type { HuntCapabilities, HuntSourceCategory } from '../../../domain/hunter/HuntProvider';
import type { HuntConfigSuggestion } from '../../../domain/services/hunter/huntConfigPrompt';

export interface HuntConfigSuggestInput {
  tenantId: string;
  capabilities: HuntCapabilities;
  /** Categorias reais da fonte; vazio = fonte não lida (a IA deixa a categoria null). */
  categories: readonly HuntSourceCategory[];
  /** Intenção crua do usuário (sanitizada e delimitada como dado não confiável no prompt). */
  intent: string | null;
  /** Amostra larga (D6): `items` vão ao prompt, `pool` só ao resumo por categoria. */
  sample: { items: readonly HuntCandidate[]; pool: readonly HuntCandidate[] } | null;
}

/**
 * IA que preenche o rascunho de uma caçada (AI-03). Saída inválida = null. Erro já traduzido do gerador
 * (`AppError`: `AI_NOT_CONFIGURED`, `AI_DAILY_LIMIT_REACHED`…) sobe para o use case responder no código certo.
 */
export interface IHuntConfigSuggester {
  suggest(input: HuntConfigSuggestInput): Promise<HuntConfigSuggestion | null>;
}
