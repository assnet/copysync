import type { IAiTextGenerator } from '../../../../assistants/domain/contracts/IAiTextGenerator';
import { AppError } from '../../../../../shared/errors/AppError';
import { logger as sharedLogger } from '../../../../../shared/logger/logger';
import {
  buildHuntRankingPrompt,
  HUNT_RANKING_AI_PURPOSE,
  HUNT_RANKING_MAX_OUTPUT_TOKENS,
  parseHuntRankingOutput,
} from '../../../domain/services/hunter/huntRankingPrompt';
import type { HuntRankingInput, HuntRankingPick, IHuntCandidateRanker } from '../../hunter/contracts/IHuntCandidateRanker';

export interface HuntRankerLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Ranking do caçador pela IA (HUNT-06): 1 chamada por execução, até 15 candidatos com ids curtos.
 * Qualquer erro do gerador ou saída fora do formato = null (o chamador cai no ranking determinístico).
 * Prompt, títulos e resposta nunca vão para log.
 */
export class AiHuntCandidateRanker implements IHuntCandidateRanker {
  constructor(
    private readonly ai: IAiTextGenerator,
    private readonly logger: HuntRankerLogger = sharedLogger,
  ) {}

  async rank(input: HuntRankingInput): Promise<HuntRankingPick[] | null> {
    const { system, prompt, idMap, pick } = buildHuntRankingPrompt(input.candidates, input.topN);
    if (pick < 1) return null;
    let text: string;
    try {
      const result = await this.ai.generate({
        tenantId: input.tenantId,
        purpose: HUNT_RANKING_AI_PURPOSE,
        system,
        prompt,
        maxOutputTokens: HUNT_RANKING_MAX_OUTPUT_TOKENS,
      });
      text = result.text ?? '';
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_UNEXPECTED_ERROR';
      this.logger.warn({ tenantId: input.tenantId, code, sent: idMap.size }, 'offer hunt AI ranking fallback');
      return null;
    }
    const picks = parseHuntRankingOutput(text, idMap, pick);
    if (!picks) {
      this.logger.warn({ tenantId: input.tenantId, code: 'AI_RESPONSE_INVALID', sent: idMap.size }, 'offer hunt AI ranking fallback');
    }
    return picks;
  }
}
