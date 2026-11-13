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
  /**
   * Teto de saída. O JSON completo (campos + um motivo ≤ 120 por campo) passa de 700 tokens nas marcas com mais
   * filtros; teto curto cortava a resposta no meio. Corte que ainda ocorra é reparado no parse.
   */
  maxOutputTokens: 1_500,
  /** Pausa entre consultas da amostra (requisição interativa: menor que a das páginas da caçada). */
  samplePauseMs: { min: 400, max: 900 },
  /** Depois deste tempo lendo a amostra, não abre consulta nova (a resposta precisa caber no limite do proxy). */
  sampleBudgetMs: 20_000,
  /** Nova tentativa quando o provedor de IA falha de forma passageira (5xx/rede; nunca após timeout). */
  aiRetryMax: 1,
  aiRetryPauseMs: 800,
} as const;
