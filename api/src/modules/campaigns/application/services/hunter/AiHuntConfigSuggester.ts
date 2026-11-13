import type { IAiTextGenerator } from '../../../../assistants/domain/contracts/IAiTextGenerator';
import { AppError } from '../../../../../shared/errors/AppError';
import { logger as sharedLogger } from '../../../../../shared/logger/logger';
import {
  buildHuntConfigPrompt, HUNT_CONFIG_AI_PURPOSE, HUNT_CONFIG_MAX_OUTPUT_TOKENS, parseHuntConfigOutput,
  type HuntConfigSuggestion,
} from '../../../domain/services/hunter/huntConfigPrompt';
import { HUNTER_AI_LIMITS as AL } from '../../../domain/services/hunter/hunterAiLimits';
import type { HuntConfigSuggestInput, IHuntConfigSuggester } from '../../hunter/contracts/IHuntConfigSuggester';

export interface HuntConfigSuggesterLogger {
  warn(obj: object, msg: string): void;
}

/**
 * IA que configura a caçada (AI-03/05): 1 chamada ao `IAiTextGenerator` (`purpose: offer_hunt_config`, conta em
 * `ai_requests_per_day`). Falha passageira do provedor (`AI_PROVIDER_UNAVAILABLE` que não seja timeout) ganha
 * `aiRetryMax` nova tentativa após uma pausa curta (cada tentativa conta em `ai_requests_per_day`). Saída fora do
 * formato ou erro inesperado = null. Erro do gerador já traduzido (`AppError`) sobe com o código dele
 * (409/422/429/503). Log leva só código, `reason`/`status` do erro e contagens: nunca prompt, intenção, títulos
 * nem resposta.
 */
export class AiHuntConfigSuggester implements IHuntConfigSuggester {
  constructor(
    private readonly ai: IAiTextGenerator,
    private readonly logger: HuntConfigSuggesterLogger = sharedLogger,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async suggest(input: HuntConfigSuggestInput): Promise<HuntConfigSuggestion | null> {
    const { system, prompt, categoryIds, categoryNames } = buildHuntConfigPrompt(input);
    const meta = {
      tenantId: input.tenantId, provider: input.capabilities.provider, categories: categoryIds.size,
      sample: input.sample?.items.length ?? 0, promptChars: system.length + prompt.length,
    };
    let text = '';
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.ai.generate({
          tenantId: input.tenantId,
          purpose: HUNT_CONFIG_AI_PURPOSE,
          system,
          prompt,
          maxOutputTokens: HUNT_CONFIG_MAX_OUTPUT_TOKENS,
        });
        text = result.text ?? '';
        break;
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'AI_UNEXPECTED_ERROR';
        // `reason`/`status` do erro do provedor são códigos curtos nossos (timeout, network, status_503, 400…)
        const { reason, status } = (err instanceof AppError ? err.meta : undefined) ?? {};
        const retry = code === 'AI_PROVIDER_UNAVAILABLE' && reason !== 'timeout' && attempt < AL.aiRetryMax;
        this.logger.warn({ ...meta, code, reason, status, attempt, retry }, 'offer hunt AI config failed');
        if (retry) {
          await this.sleep(AL.aiRetryPauseMs);
          continue;
        }
        if (err instanceof AppError) throw err;
        return null;
      }
    }
    const out = parseHuntConfigOutput(text, { capabilities: input.capabilities, categoryIds, categoryNames });
    if (!out) this.logger.warn({ ...meta, code: 'AI_RESPONSE_INVALID', outputChars: text.length }, 'offer hunt AI config failed');
    else if (out.dropped.length) this.logger.warn({ ...meta, dropped: out.dropped.length }, 'offer hunt AI config fields dropped');
    return out;
  }
}
