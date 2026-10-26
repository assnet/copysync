import type { IAiTextProviderAdapter } from '../../domain/contracts/IAiTextProviderAdapter';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';
import { AnthropicTextAdapter } from './AnthropicTextAdapter';
import { OpenAiTextAdapter } from './OpenAiTextAdapter';
import type { FetchFn } from './httpAiErrors';

/** Um adapter por tipo de provedor. Novo provedor = novo adapter + novo valor do enum. */
export function createAiTextProviderAdapterFactory(fetchFn: FetchFn = fetch) {
  const adapters: Record<AiProviderKind, IAiTextProviderAdapter> = {
    ANTHROPIC: new AnthropicTextAdapter(fetchFn),
    OPENAI: new OpenAiTextAdapter(fetchFn),
  };
  return (kind: AiProviderKind): IAiTextProviderAdapter => adapters[kind];
}
