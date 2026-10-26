import type {
  AiProviderCall,
  AiProviderResult,
  IAiTextProviderAdapter,
} from '../../domain/contracts/IAiTextProviderAdapter';
import type { IAiBaseUrlGuard } from '../../domain/contracts/IAiBaseUrlGuard';
import type { AiMaxTokensParam } from '../../domain/services/aiProviderCatalog';
import { AiProviderRejectedError, AiProviderUnavailableError } from '../../../../shared/errors/internal/AiErrors';
import { logger } from '../../../../shared/logger/logger';
import { postJson, tokenCount, type FetchFn } from './httpAiErrors';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export interface OpenAiCompatibleOptions {
  /** Sem barra final, ex. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** OpenAI usa `max_completion_tokens`; os compatíveis, `max_tokens`. */
  maxTokensParam: AiMaxTokensParam;
  /** Endpoint próprio: confere o DNS antes de cada chamada (rebinding). */
  guard?: IAiBaseUrlGuard;
  fetchFn?: FetchFn;
}

/** Chat Completions por `fetch` (OpenAI, Gemini, xAI, DeepSeek, Groq, Mistral, OpenRouter, próprio). */
export class OpenAiCompatibleTextAdapter implements IAiTextProviderAdapter {
  private readonly url: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.url = `${options.baseUrl}/chat/completions`;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generate(call: AiProviderCall): Promise<AiProviderResult> {
    if (this.options.guard) await this.assertPublic(this.options.guard);
    const data = (await postJson(
      this.fetchFn,
      this.url,
      { authorization: `Bearer ${call.apiKey}` },
      {
        model: call.model,
        [this.options.maxTokensParam]: call.maxOutputTokens,
        messages: [
          { role: 'system', content: call.system },
          { role: 'user', content: call.prompt },
        ],
      },
    )) as ChatCompletionResponse;

    const content = data.choices?.[0]?.message?.content;
    return {
      text: typeof content === 'string' ? content : '',
      inputTokens: tokenCount(data.usage?.prompt_tokens),
      outputTokens: tokenCount(data.usage?.completion_tokens),
    };
  }

  private async assertPublic(guard: IAiBaseUrlGuard): Promise<void> {
    const verdict = await guard.check(this.options.baseUrl);
    if (verdict === 'ok') return;
    logger.warn({ host: new URL(this.options.baseUrl).hostname, verdict }, 'ai custom base url blocked');
    if (verdict === 'unresolvable') throw new AiProviderUnavailableError('dns');
    throw new AiProviderRejectedError();
  }
}
