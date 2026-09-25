import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type {
  IUploadSessionStore,
  UploadSessionRecord,
} from '../../../media/domain/contracts/IUploadSessionStore';
import { logger } from '../../../../shared/logger/logger';

/**
 * Boot: resolve uploads que ficaram em `CONSUMING` porque o processo caiu no meio do envio
 * de mídia (design §5, "Limpeza e reconciliação"). Precisa rodar antes da varredura de uploads,
 * que apagaria um `CONSUMING` vencido sem olhar se virou mensagem.
 *
 * No banco, só leitura (`findByExternalId` no tenant do upload) — seguro com qualquer banco,
 * inclusive o de produção apontado pelo `api/.env`. Nunca lança: erro por upload vai para o log.
 */
export class ReconcileInterruptedUploadsUseCase {
  constructor(
    private readonly uploads: IUploadSessionStore,
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  async execute(): Promise<void> {
    let interrupted: UploadSessionRecord[];
    try {
      interrupted = await this.uploads.listByState('CONSUMING');
    } catch (err) {
      logger.error({ err }, 'Falha ao listar uploads interrompidos');
      return;
    }
    for (const record of interrupted) {
      try {
        await this.reconcile(record);
      } catch (err) {
        logger.error(
          { err, uploadId: record.uploadId, tenantId: record.tenantId },
          'Falha ao reconciliar upload interrompido',
        );
      }
    }
  }

  private async reconcile(record: UploadSessionRecord): Promise<void> {
    const { uploadId, tenantId, externalMessageId } = record;

    // Caiu antes de receber o id (logo, antes da promoção): o arquivo segue inteiro e retomável
    if (!externalMessageId) {
      await this.uploads.releaseConsume(uploadId);
      logger.info({ uploadId, tenantId }, 'Upload interrompido devolvido para nova confirmação');
      return;
    }

    const message = await this.messageRepo.findByExternalId(externalMessageId, tenantId);
    if (message) {
      await this.uploads.finishConsume(uploadId, message.id);
      logger.info({ uploadId, tenantId, messageId: message.id }, 'Upload interrompido concluído com a mensagem já gravada');
      return;
    }

    // Sem mensagem: o painel sobe de novo a partir do arquivo que ainda guarda (design §14).
    // Se a promoção chegou a ocorrer, o arquivo ficou na pasta de mídia como
    // `${sessionId}_${externalMessageId}.${ext}` — o lateral não guarda sessão nem o tipo final,
    // então o caminho não é derivável daqui e o arquivo fica órfão para a limpeza de mídia.
    await this.uploads.discard(uploadId);
    logger.warn(
      { uploadId, tenantId, externalMessageId },
      'Upload interrompido sem mensagem descartado; mídia promovida, se houver, ficou órfã na pasta de mídia',
    );
  }
}
