import type {
  AiProviderCall,
  AiProviderResult,
  IAiTextProviderAdapter,
} from '../../domain/contracts/IAiTextProviderAdapter';
import { postJson, tokenCount, type FetchFn } from './httpAiErrors';

const URL = 'https://api.anthropic.com/v1/messages';
/** Versão da API: sem `temperature`/`top_p`/`top_k` (rejeitados a partir desta versão). */
const API_VERSION = '2026-10-21';

interface MessagesResponse {
  content?: Array<{ type?: string; text?: unknown }>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

/**
 * Claude Haiku 5.5 pensa por padrão e o pensamento consome `max_tokens`; textos curtos não
 * precisam disso, e `disabled` é aceito nele no esforço padrão. Outros modelos ficam no
 * padrão da API (em vários, `disabled` é 400).
 */
function thinkingFor(model: string): { type: 'disabled' } | undefined {
  return model.startsWith('claude-haiku-5') ? { type: 'disabled' } : undefined;
}

/** Messages API por `fetch` (spec Parte B). Junta os blocos `text`; ignora os demais. */
export class AnthropicTextAdapter implements IAiTextProviderAdapter {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async generate(call: AiProviderCall): Promise<AiProviderResult> {
    const thinking = thinkingFor(call.model);
    const data = (await postJson(
      this.fetchFn,
      URL,
      { 'x-api-key': call.apiKey, 'anthropic-version': API_VERSION },
      {
        model: call.model,
        max_tokens: call.maxOutputTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.prompt }],
        ...(thinking && { thinking }),
      },
    )) as MessagesResponse;

    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    return {
      text,
      inputTokens: tokenCount(data.usage?.input_tokens),
      outputTokens: tokenCount(data.usage?.output_tokens),
    };
  }
}
