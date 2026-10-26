import type { AiProviderKind } from '@/types/api.types';

export interface AiProviderSpec {
  kind: AiProviderKind;
  /** Modelo sugerido ao escolher o provedor (barato e rápido para textos curtos). */
  defaultModel: string;
  /** Onde o cliente cria a chave de API. */
  consoleUrl: string;
}

export const AI_PROVIDERS: readonly AiProviderSpec[] = [
  { kind: 'ANTHROPIC', defaultModel: 'claude-haiku-5-5', consoleUrl: 'https://console.anthropic.com/settings/keys' },
  { kind: 'OPENAI', defaultModel: 'gpt-4o-mini', consoleUrl: 'https://platform.openai.com/api-keys' },
];

export function aiProviderSpec(kind: AiProviderKind): AiProviderSpec {
  return AI_PROVIDERS.find((p) => p.kind === kind) ?? AI_PROVIDERS[0];
}

/** Modelo continua sugerido enquanto o usuário não digitou outro. */
export function isSuggestedModel(model: string): boolean {
  const m = model.trim();
  return m === '' || AI_PROVIDERS.some((p) => p.defaultModel === m);
}
