import type { IAiTextGenerator } from '../../../../assistants/domain/contracts/IAiTextGenerator';
import { AppError } from '../../../../../shared/errors/AppError';
import { logger as sharedLogger } from '../../../../../shared/logger/logger';
import {
  buildHuntConfigPrompt, HUNT_CONFIG_AI_PURPOSE, HUNT_CONFIG_MAX_OUTPUT_TOKENS, parseHuntConfigOutput,
  type HuntConfigSuggestion,
} from '../../../domain/services/hunter/huntConfigPrompt';
import type { HuntConfigSuggestInput, IHuntConfigSuggester } from '../../hunter/contracts/IHuntConfigSuggester';

export interface HuntConfigSuggesterLogger {
  warn(obj: object, msg: string): void;
}

/**
 * IA que configura a caçada (AI-03/05): 1 chamada ao `IAiTextGenerator` (`purpose: offer_hunt_config`, conta em
 * `ai_requests_per_day`). Saída fora do formato ou erro inesperado = null. Erro do gerador já traduzido (`AppError`)
 * sobe com o código dele (409/422/429/503). Prompt, intenção, títulos e resposta nunca vão para log.
 */
export class AiHuntConfigSuggester implements IHuntConfigSuggester {
  constructor(
    private readonly ai: IAiTextGenerator,
    private readonly logger: HuntConfigSuggesterLogger = sharedLogger,
  ) {}

  async suggest(input: HuntConfigSuggestInput): Promise<HuntConfigSuggestion | null> {
    const { system, prompt, categoryIds } = buildHuntConfigPrompt(input);
    const meta = {
      tenantId: input.tenantId, provider: input.capabilities.provider, categories: categoryIds.size,
      sample: input.sample?.items.length ?? 0,
    };
    let text: string;
    try {
      const result = await this.ai.generate({
        tenantId: input.tenantId,
        purpose: HUNT_CONFIG_AI_PURPOSE,
        system,
        prompt,
        maxOutputTokens: HUNT_CONFIG_MAX_OUTPUT_TOKENS,
      });
      text = result.text ?? '';
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_UNEXPECTED_ERROR';
      this.logger.warn({ ...meta, code }, 'offer hunt AI config failed');
      if (err instanceof AppError) throw err;
      return null;
    }
    const out = parseHuntConfigOutput(text, { capabilities: input.capabilities, categoryIds });
    if (!out) this.logger.warn({ ...meta, code: 'AI_RESPONSE_INVALID' }, 'offer hunt AI config failed');
    else if (out.dropped.length) this.logger.warn({ ...meta, dropped: out.dropped.length }, 'offer hunt AI config fields dropped');
    return out;
  }
}
