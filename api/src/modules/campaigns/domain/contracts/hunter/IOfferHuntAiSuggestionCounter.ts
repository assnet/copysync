/** Resultado da reserva de uma sugestão de IA no dia (`used` já inclui a reservada). */
export type OfferHuntAiSuggestionClaim =
  | { kind: 'OK'; id: string; used: number }
  | { kind: 'DAILY_LIMIT'; used: number };

/**
 * Contador atômico de sugestões de IA da caçada por tenant/dia (tabela `offer_hunt_ai_suggestions`).
 * `claim` serializa por tenant: duas abas no limite nunca passam juntas do teto.
 */
export interface IOfferHuntAiSuggestionCounter {
  claim(tenantId: string, dayStart: Date, dailyMax: number, now: Date): Promise<OfferHuntAiSuggestionClaim>;
  /** Devolve a reserva (a IA não foi chamada de fato: não configurada, limite do provedor…). */
  release(tenantId: string, id: string): Promise<void>;
  countSince(tenantId: string, dayStart: Date): Promise<number>;
}
