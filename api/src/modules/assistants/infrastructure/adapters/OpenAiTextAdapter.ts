import type {
  AiProviderCall,
  AiProviderResult,
  IAiTextProviderAdapter,
} from '../../domain/contracts/IAiTextProviderAdapter';
import { postJson, tokenCount, type FetchFn } from './httpAiErrors';

const URL = 'https://api.openai.com/v1/chat/completions';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** Chat Completions por `fetch`. `max_completion_tokens` serve nos modelos novos e antigos. */
export class OpenAiTextAdapter implements IAiTextProviderAdapter {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async generate(call: AiProviderCall): Promise<AiProviderResult> {
    const data = (await postJson(
      this.fetchFn,
      URL,
      { authorization: `Bearer ${call.apiKey}` },
      {
        model: call.model,
        max_completion_tokens: call.maxOutputTokens,
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
}
