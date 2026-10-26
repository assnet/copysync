/** Chamada já resolvida: chave em claro só vive na memória desta chamada. */
export interface AiProviderCall {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

export interface AiProviderResult {
  /** Pode vir vazio (ex. limite de tokens consumido antes do texto). Quem chama decide. */
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Um provedor de IA por trás de HTTP. Traduz erros para `AI_PROVIDER_REJECTED`,
 * `AI_PROVIDER_RATE_LIMITED` ou `AI_PROVIDER_UNAVAILABLE`; nunca loga chave, prompt ou corpo.
 */
export interface IAiTextProviderAdapter {
  generate(call: AiProviderCall): Promise<AiProviderResult>;
}
