import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import type {
  IMessagingEngine,
  OutboundMedia,
  OutboundMediaKind,
  QuotedMessageRef,
} from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IMediaProcessor } from '../../../media/domain/contracts/IMediaProcessor';
import type { IMessageStatusPublisher } from '../contracts/IMessageStatusPublisher';
import type { OutboundMediaJob } from '../contracts/IOutboundMediaQueue';
import { ChatMessageStatus, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import { ConflictError, NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import {
  InsufficientStorageError,
  UnsupportedMediaTypeError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import {
  buildEngineMessageRef,
  resolveConversationTarget,
  type ConversationTarget,
} from './resolveConversationTarget';

/** Espaço livre na pasta temporária do processo — onde a engine grava a cópia criptografada. */
export type TmpSpaceProbe = () => Promise<{ freeBytes: number }>;
/** Tamanho em bytes de um arquivo no disco. */
export type FileSizeProbe = (path: string) => Promise<number>;

/** Tipo gravado → como chega ao contato. `AUDIO` é voz: só o gravador do painel envia áudio por aqui. */
const KIND_BY_TYPE: Partial<Record<ChatMessageType, OutboundMediaKind>> = {
  [ChatMessageType.IMAGE]:    'image',
  [ChatMessageType.VIDEO]:    'video',
  [ChatMessageType.AUDIO]:    'voice',
  [ChatMessageType.DOCUMENT]: 'document',
};

type SendMetadata = Pick<OutboundMedia, 'durationSeconds' | 'width' | 'height' | 'thumbnailJpegBase64' | 'waveform'>;

/**
 * Envia ao WhatsApp uma mídia já gravada como `PENDING` (executado pela fila — design §8).
 *
 * Corpo em `try/finally`: exceção em qualquer passo vira `FAILED` + publicação, e nada lança
 * para a fila. A transição é condicional (`[PENDING] → …`), então publica só quando ocorreu:
 * `null` = outro caminho (ex.: `DELIVERED`) já avançou o status.
 */
export class DispatchOutboundMediaUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly engine: IMessagingEngine | null,
    private readonly fileStore: IMediaFileStore,
    private readonly processor: IMediaProcessor,
    private readonly publisher: IMessageStatusPublisher,
    private readonly tmpSpace: TmpSpaceProbe,
    private readonly fileSize: FileSizeProbe,
    private readonly tmpReserveBytes: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(job: OutboundMediaJob): Promise<void> {
    // Desfecho padrão é FAILED: qualquer exceção chega ao `finally` com ele.
    let status: ChatMessageStatus | null = ChatMessageStatus.FAILED;
    let sentAt: Date | undefined;
    try {
      const message = await this.messageRepo.findById(job.messageId, job.tenantId);
      // Fora de PENDING (retry duplicado, recuperação, apagada): nada a fazer.
      if (message?.status !== ChatMessageStatus.PENDING) {
        status = null;
        return;
      }
      await this.send(job, message);
      status = ChatMessageStatus.SENT;
      sentAt = this.now();
    } catch (err) {
      logger.error(
        { err, messageId: job.messageId, tenantId: job.tenantId, sessionId: job.sessionId },
        'Falha ao despachar mídia',
      );
    } finally {
      if (status) await this.settle(job, status, sentAt);
    }
  }

  private async send(job: OutboundMediaJob, message: ChatMessage): Promise<void> {
    if (!this.engine) throw new SessionNotConnectedError(job.sessionId);
    const kind = KIND_BY_TYPE[message.type];
    if (!kind || !message.mimeType) {
      throw new UnsupportedMediaTypeError(undefined, { messageId: message.id, type: message.type });
    }
    // O id foi gravado antes do envio e o eco depende dele: nunca gerar outro aqui.
    if (!message.externalMessageId) throw new ConflictError('Media message without pre-generated id');

    const conv = await this.conversationRepo.findById(message.conversationId, job.tenantId);
    if (!conv) throw new NotFoundError('Conversation', message.conversationId);
    const contact = conv.isGroup ? null : await this.contactRepo.findById(conv.contactId ?? '', job.tenantId);
    const target = resolveConversationTarget(conv, contact);
    const quotedMessage = await this.quotedRef(message, target, job.tenantId);

    const acquired = message.mediaUrl ? await this.fileStore.acquireLocalFile(message.mediaUrl) : null;
    if (!acquired) throw new NotFoundError('MediaFile', message.id);
    try {
      const { filePath, sizeBytes } = acquired;
      await this.assertTmpSpace(message.id, sizeBytes);

      await this.engine.sendMediaMessage({
        sessionId: job.sessionId,
        tenantId:  job.tenantId,
        to:        target.recipientPhone,
        messageId: message.externalMessageId,
        media: {
          kind,
          filePath,
          mimeType: message.mimeType,
          fileName: message.fileName,
          caption:  message.content,
          sizeBytes,
          ...(await this.sendMetadata(kind, filePath, message)),
        },
        quotedMessage,
        // Só no job em memória: retry/recuperação chegam sem menção (ver OutboundMediaJob)
        ...(job.mentions?.length ? { mentions: job.mentions } : {}),
      });
    } finally {
      await acquired.release();
    }
  }

  /** Mesma guarda do texto: só cita mensagem desta conversa; apagada não vai ao WhatsApp. */
  private async quotedRef(
    message: ChatMessage,
    target: ConversationTarget,
    tenantId: string,
  ): Promise<QuotedMessageRef | null> {
    if (!message.quotedMessageId) return null;
    const quoted = await this.messageRepo.findById(message.quotedMessageId, tenantId);
    if (quoted && quoted.conversationId === message.conversationId) {
      return quoted.isDeleted ? null : buildEngineMessageRef(target, quoted);
    }
    logger.warn(
      { messageId: message.id, quotedMessageId: message.quotedMessageId, found: !!quoted },
      'Citação fora desta conversa — mídia vai sem ela',
    );
    return null;
  }

  /** A engine grava a cópia criptografada na pasta temporária: sem folga, nem tenta. */
  private async assertTmpSpace(messageId: string, sizeBytes: number): Promise<void> {
    const { freeBytes } = await this.tmpSpace();
    const requiredBytes = sizeBytes + this.tmpReserveBytes;
    if (freeBytes >= requiredBytes) return;
    logger.warn(
      { messageId, freeBytes, sizeBytes, reserveBytes: this.tmpReserveBytes },
      'Pasta temporária sem espaço para enviar a mídia',
    );
    throw new InsufficientStorageError(undefined, { freeBytes, requiredBytes });
  }

  /**
   * Metadados lidos do arquivo final a cada envio (retry-safe). O probe é obrigatório (lança →
   * FAILED); miniatura e forma de onda são opcionais (falha → log e segue sem elas).
   */
  private async sendMetadata(kind: OutboundMediaKind, filePath: string, message: ChatMessage): Promise<SendMetadata> {
    if (kind === 'video') {
      const probe = await this.processor.probe(filePath, 'mov');
      return {
        durationSeconds:     probe.durationSeconds ?? message.durationSeconds,
        width:               probe.width,
        height:              probe.height,
        thumbnailJpegBase64: await optional(() => this.processor.videoThumbnailBase64(filePath), 'miniatura', message.id),
      };
    }
    if (kind === 'voice') {
      const probe = await this.processor.probe(filePath, 'ogg');
      return {
        durationSeconds: probe.durationSeconds ?? message.durationSeconds,
        waveform:        await optional(() => this.processor.voiceWaveform(filePath), 'forma de onda', message.id),
      };
    }
    return {};
  }

  /** Grava o desfecho e publica só se a transição ocorreu. Nunca lança. */
  private async settle(job: OutboundMediaJob, status: ChatMessageStatus, sentAt?: Date): Promise<void> {
    try {
      const updated = await this.messageRepo.transitionStatus(
        job.messageId, job.tenantId, [ChatMessageStatus.PENDING], status, ...(sentAt ? [sentAt] : []),
      );
      if (!updated) return;
      this.publisher.publishStatusUpdated({
        tenantId:       updated.tenantId,
        conversationId: updated.conversationId,
        messageId:      updated.id,
        status,
      });
    } catch (err) {
      logger.error({ err, messageId: job.messageId, status }, 'Falha ao gravar o desfecho do envio de mídia');
    }
  }
}

async function optional<T>(run: () => Promise<T | null>, what: string, messageId: string): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    logger.warn({ err, messageId }, `Mídia enviada sem ${what}`);
    return null;
  }
}
