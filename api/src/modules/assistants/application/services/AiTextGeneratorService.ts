import type { AiTextRequest, AiTextResult, IAiTextGenerator } from '../../domain/contracts/IAiTextGenerator';
import type { IAiUsageLogRepository } from '../../domain/contracts/IAiUsageLogRepository';
import type { AiProviderResult } from '../../domain/contracts/IAiTextProviderAdapter';
import type { AiUsageEntry } from '../../domain/contracts/AiRecords';
import { AiDailyLimitReachedError, AiProviderUnavailableError } from '../../../../shared/errors/internal/AiErrors';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';
import { logger } from '../../../../shared/logger/logger';
import type { ResolvedAiProvider } from '../use-cases/ResolveAiTextProviderUseCase';
import type { AiAdapterResolver } from '../use-cases/TestAiProviderUseCases';

interface ProviderResolver {
  execute(tenantId: string): Promise<ResolvedAiProvider>;
}

/**
 * Porta única de texto por IA: resolve o provedor, chama o adapter e grava `AiUsageLog`.
 * Com teto (PLATFORM) a linha é reservada antes da chamada, de forma atômica (toda linha do dia
 * conta, sucesso ou não), e fechada depois; sem teto (TENANT) é gravada depois. Gravação do
 * desfecho é best-effort: nunca troca o resultado nem o erro original. Falha de resolução
 * (409) não grava uso. Nunca loga prompt, resposta nem chave.
 */
export class AiTextGeneratorService implements IAiTextGenerator {
  constructor(
    private readonly resolver: ProviderResolver,
    private readonly adapters: AiAdapterResolver,
    private readonly usage: IAiUsageLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(input: AiTextRequest): Promise<AiTextResult> {
    const resolved = await this.resolver.execute(input.tenantId);
    const reservationId = await this.reserve(input, resolved);
    let result: AiProviderResult | null = null;
    let text: string;
    try {
      result = await this.adapters({ kind: resolved.kind, baseUrl: resolved.baseUrl }).generate({
        apiKey: resolved.apiKey,
        model: resolved.model,
        system: input.system,
        prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
      });
      text = result.text.trim();
      if (!text) throw new AiProviderUnavailableError('empty_response');
    } catch (err) {
      await this.finish(input, resolved, reservationId, result, false);
      throw err;
    }
    await this.finish(input, resolved, reservationId, result, true);
    return { text };
  }

  /** Reserva sob o teto; null quando não há teto. Banco fora do ar vira 503 (quem chama cai no modelo). */
  private async reserve(input: AiTextRequest, resolved: ResolvedAiProvider): Promise<string | null> {
    if (resolved.dailyLimit === null) return null;
    let id: string | null;
    try {
      id = await this.usage.reserveWithinDailyLimit(this.entry(input, resolved, null, false), {
        since: startOfDayInZone(this.now()),
        limit: resolved.dailyLimit,
      });
    } catch (err) {
      logger.warn({ tenantId: input.tenantId, err: (err as Error)?.name }, 'ai usage reservation failed');
      throw new AiProviderUnavailableError('usage_unavailable');
    }
    if (id === null) throw new AiDailyLimitReachedError(resolved.dailyLimit);
    return id;
  }

  private async finish(
    input: AiTextRequest,
    resolved: ResolvedAiProvider,
    reservationId: string | null,
    result: AiProviderResult | null,
    success: boolean,
  ): Promise<void> {
    try {
      if (reservationId === null) {
        await this.usage.record(this.entry(input, resolved, result, success));
      } else {
        await this.usage.complete(reservationId, input.tenantId, {
          success,
          inputTokens: result?.inputTokens ?? null,
          outputTokens: result?.outputTokens ?? null,
        });
      }
    } catch (err) {
      logger.warn({ tenantId: input.tenantId, err: (err as Error)?.name }, 'ai usage log write failed');
    }
  }

  private entry(
    input: AiTextRequest,
    resolved: ResolvedAiProvider,
    result: AiProviderResult | null,
    success: boolean,
  ): AiUsageEntry {
    return {
      tenantId: input.tenantId,
      source: resolved.source,
      kind: resolved.kind,
      model: resolved.model,
      providerId: resolved.providerId,
      purpose: input.purpose,
      inputTokens: result?.inputTokens ?? null,
      outputTokens: result?.outputTokens ?? null,
      success,
    };
  }
}
