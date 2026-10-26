import type { AiTextRequest, AiTextResult, IAiTextGenerator } from '../../../assistants/domain/contracts/IAiTextGenerator';

/**
 * Resolve o gerador de IA do módulo `assistants` só na primeira chamada: importar o gerador de
 * ofertas não carrega provedores de IA nem toca banco.
 */
export class LazyAiTextGenerator implements IAiTextGenerator {
  async generate(input: AiTextRequest): Promise<AiTextResult> {
    const { assistantsContainer } = await import('../../../assistants/infrastructure/assistantsContainer');
    return assistantsContainer.aiTextGenerator().generate(input);
  }
}
