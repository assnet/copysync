import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import {
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { logger } from '../../../../shared/logger/logger';
import type { ChatMessageDto } from './ListMessagesUseCase';

/** Tipos que o painel envia como anexo; figurinha e demais não passam pela fila de mídia. */
const RETRYABLE_TYPES: ReadonlySet<ChatMessageType> = new Set([
  ChatMessageType.IMAGE,
  ChatMessageType.VIDEO,
  ChatMessageType.AUDIO,
  ChatMessageType.DOCUMENT,
]);

export interface RetryOutboundMediaInput {
  tenantId: string;
  messageId: string;
}

/**
 * "Tentar de novo" de uma mídia que falhou (design §8, MEDIA-19): reenfileira o arquivo já
 * guardado no servidor, sem novo upload. A rota responde 202; o resultado chega pelo evento
 * de status publicado no despacho.
 *
 * Reusa o `externalMessageId` gravado e nunca gera outro. Risco (design §17): se a falha foi
 * um timeout e o WhatsApp tinha aceitado o envio, o retry pode duplicar a mensagem no contato.
 * Reusar o id é a única mitigação ao alcance, e o dedupe do WhatsApp por id é INCERTO.
 */
export class RetryOutboundMediaUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly fileStore: IMediaFileStore,
    private readonly engine: IMessagingEngine | null,
    private readonly queue: IOutboundMediaQueue,
  ) {}

  async execute(input: RetryOutboundMediaInput): Promise<ChatMessageDto> {
    const { tenantId, messageId } = input;

    // 1. Mensagem do tenant, reenviável e com o arquivo ainda no disco
    const message = await this.messageRepo.findById(messageId, tenantId);
    if (!message) throw new NotFoundError('Message', messageId);
    if (message.direction !== ChatMessageDirection.OUTBOUND || message.status !== ChatMessageStatus.FAILED) {
      throw new ConflictError('Only failed outbound messages can be retried');
    }
    if (!RETRYABLE_TYPES.has(message.type) || !message.mediaUrl || !message.externalMessageId) {
      throw new ConflictError('Message has no media to retry');
    }
    const acquired = await this.fileStore.acquireLocalFile(message.mediaUrl);
    if (!acquired) throw new ConflictError('Media file is no longer available');
    await acquired.release();

    // 2. Sessão conectada. O id gerado aqui é descartado: serve só como checagem, e lança
    //    `SessionNotConnectedError` antes de qualquer mudança de status.
    const conv = await this.conversationRepo.findById(message.conversationId, tenantId);
    if (!conv) throw new NotFoundError('Conversation', message.conversationId);
    if (!this.engine || !conv.sessionId) throw new SessionNotConnectedError(conv.sessionId ?? conv.id);
    const sessionId = conv.sessionId;
    this.engine.createOutboundMessageId(sessionId);

    // 3. FAILED → PENDING condicional: com dois cliques/abas, só um vence; o outro recebe `null`.
    const pending = await this.messageRepo.transitionStatus(
      message.id, tenantId, [ChatMessageStatus.FAILED], ChatMessageStatus.PENDING,
    );
    if (!pending) throw new ConflictError('Message is already being retried');

    // 4. O job leva só ids: o despacho relê a mensagem e envia com o `externalMessageId` gravado.
    const accepted = this.queue.enqueue({
      messageId: message.id, tenantId, sessionId, conversationId: message.conversationId,
    });
    if (!accepted) {
      await this.messageRepo.transitionStatus(
        message.id, tenantId, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
      );
      throw new TooManyRequestsError('Media send queue is full — try again shortly');
    }

    // Rastro para investigar duplicata no contato (mesmo id, envio repetido).
    logger.info(
      { tenantId, messageId: message.id, externalMessageId: message.externalMessageId, sessionId },
      'Reenvio de mídia enfileirado com o id original',
    );

    return {
      id:                pending.id,
      conversationId:    pending.conversationId,
      tenantId:          pending.tenantId,
      direction:         pending.direction,
      type:              pending.type,
      content:           pending.content,
      mediaUrl:          pending.mediaUrl,
      mimeType:          pending.mimeType,
      fileName:          pending.fileName,
      durationSeconds:   pending.durationSeconds,
      externalMessageId: pending.externalMessageId,
      status:            pending.status,
      isDeleted:         pending.isDeleted,
      quotedMessageId:   pending.quotedMessageId,
      sentAt:            pending.sentAt?.toISOString() ?? null,
      createdAt:         pending.createdAt.toISOString(),
      fromParticipant:     pending.fromParticipant,
      fromParticipantName: pending.fromParticipantName,
      // Enviada por nós: sem avatar de participante. Não entregue: sem reações (T28 bloqueia).
      fromParticipantAvatarUrl: null,
      reactionsRevision: null,
      reactions:         [],
    };
  }
}
