import type { FailPendingInput, IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IMessageStatusPublisher } from '../contracts/IMessageStatusPublisher';
import { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';
import { logger } from '../../../../shared/logger/logger';

export interface PendingMediaRecoveryConfig {
  /**
   * `MEDIA_PENDING_RECOVERY_ENABLED`. Desligada, nada no banco muda: `api/.env` aponta para
   * produção, e um `pnpm dev` não pode falhar mídia que a produção ainda está enviando.
   */
  enabled: boolean;
  /** `MEDIA_PENDING_STALE_MINUTES`: idade a partir da qual a varredura falha um `PENDING`. */
  staleMinutes: number;
}

/**
 * Recuperação de mídia `PENDING` que ficou sem envio (design §8): a fila é memória, e o que
 * estava nela some num reinício. A mensagem vira `FAILED` — reenviável — e o painel é avisado.
 *
 * Nunca lança: roda no boot e no agendamento, e falha aqui só vai para o log.
 */
export class FailOrphanPendingMediaUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly publisher: IMessageStatusPublisher,
    private readonly config: PendingMediaRecoveryConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Boot, antes do `listen`: nada deste processo está na fila, então todo `PENDING` é órfão. */
  async runBoot(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Recuperação de mídia pendente desligada — nenhuma mensagem alterada no boot');
      return;
    }
    await this.failAndPublish('boot', { olderThan: this.now() });
  }

  /** Varredura periódica: só os antigos, poupando o que a fila ainda está enviando. */
  async runPeriodic(inFlightIds: string[]): Promise<void> {
    if (!this.config.enabled) return;
    const olderThan = new Date(this.now().getTime() - this.config.staleMinutes * 60_000);
    await this.failAndPublish('periodic', { olderThan, excludeIds: inFlightIds });
  }

  private async failAndPublish(trigger: 'boot' | 'periodic', input: FailPendingInput): Promise<void> {
    try {
      const failed = await this.messageRepo.failPending(input);
      if (failed.length > 0) {
        logger.warn({ trigger, count: failed.length }, 'Mídia pendente sem envio marcada como falha');
      }
      // O banco já mudou: cada aviso é tentado mesmo que um anterior falhe
      for (const message of failed) {
        try {
          this.publisher.publishStatusUpdated({
            tenantId:       message.tenantId,
            conversationId: message.conversationId,
            messageId:      message.id,
            status:         ChatMessageStatus.FAILED,
          });
        } catch (err) {
          logger.error({ err, messageId: message.id }, 'Falha ao avisar o painel da mídia marcada como falha');
        }
      }
    } catch (err) {
      logger.error({ err, trigger }, 'Falha ao recuperar mídia pendente');
    }
  }
}
