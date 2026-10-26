/**
 * Porta única de geração de texto por IA. Quem chama não sabe se usa a IA da plataforma ou a chave
 * do tenant: a resolução (modo, limites, log de uso) fica atrás desta interface.
 */
export interface AiTextRequest {
  tenantId: string;
  /** Rótulo estável para o log de uso, ex. `offer.text`. */
  purpose: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

export interface AiTextResult {
  text: string;
}

export interface IAiTextGenerator {
  /**
   * Lança `AI_NOT_CONFIGURED` (409), `AI_DAILY_LIMIT_REACHED` (429), `AI_PROVIDER_REJECTED` (422),
   * `AI_PROVIDER_RATE_LIMITED` (429) ou `AI_PROVIDER_UNAVAILABLE` (503).
   */
  generate(input: AiTextRequest): Promise<AiTextResult>;
}
