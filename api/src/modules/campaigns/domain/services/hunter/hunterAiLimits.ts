// Guardas técnicas da IA que configura a caçada (spec offer-hunter-multi AI-01..06, D6). Não são limites de plano:
// a chamada também conta em `ai_requests_per_day` pelo gerador de IA.
export const HUNTER_AI_LIMITS = {
  /** Sugestões de configuração por conta (tenant) por dia, contadas desde `startOfDayInZone`. */
  aiSuggestionsPerDayMax: 5,
  /** Intenção digitada pelo usuário. */
  intentMaxLength: 120,
  /** Consultas à fonte na amostra larga ("IA escolhe o produto"). */
  sampleQueriesMax: 5,
  /** Itens juntados das consultas antes de ordenar pela nota. */
  samplePoolMax: 90,
  /** Itens compactos que vão ao prompt. */
  samplePromptMax: 40,
  /** Categorias mais promissoras (média de comissão) lidas na amostra. */
  sampleTopCategories: 2,
  /** Categorias reais listadas no prompt. */
  promptCategoriesMax: 80,
  /** Frase de motivo por campo. */
  reasonMaxLength: 120,
  maxOutputTokens: 700,
} as const;
