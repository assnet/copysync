import type { AiCatalogItem, AiProviderKind } from '@/types/api.types';
import { aiStrings } from './strings';

/**
 * A lista de provedores vem da API (`/ai/catalog`); aqui só o que é do painel:
 * nome exibido e onde o cliente cria a chave.
 */
export const AI_KEY_CONSOLE_URLS: Partial<Record<AiProviderKind, string>> = {
  ANTHROPIC: 'https://console.anthropic.com/settings/keys',
  OPENAI: 'https://platform.openai.com/api-keys',
  GEMINI: 'https://aistudio.google.com/apikey',
  XAI: 'https://console.x.ai',
  DEEPSEEK: 'https://platform.deepseek.com/api_keys',
  GROQ: 'https://console.groq.com/keys',
  MISTRAL: 'https://console.mistral.ai/api-keys',
  OPENROUTER: 'https://openrouter.ai/keys',
};

/** Nome exibido; tipo novo ainda sem texto no painel usa o nome do catálogo. */
export function aiProviderName(kind: AiProviderKind, catalog?: readonly AiCatalogItem[]): string {
  const known = (aiStrings.providers as Partial<Record<AiProviderKind, string>>)[kind];
  return known ?? catalog?.find((c) => c.kind === kind)?.label ?? kind;
}

export function catalogEntry(catalog: readonly AiCatalogItem[], kind: AiProviderKind): AiCatalogItem | undefined {
  return catalog.find((c) => c.kind === kind);
}

/** Modelo sugerido do tipo ('' quando o modelo é obrigatório). */
export function suggestedModel(catalog: readonly AiCatalogItem[], kind: AiProviderKind): string {
  return catalogEntry(catalog, kind)?.defaultModel ?? '';
}

/** Modelo continua sugerido enquanto o usuário não digitou outro. */
export function isSuggestedModel(model: string, catalog: readonly AiCatalogItem[]): boolean {
  const m = model.trim();
  return m === '' || catalog.some((c) => c.defaultModel === m);
}
