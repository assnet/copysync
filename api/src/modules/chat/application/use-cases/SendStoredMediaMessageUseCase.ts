import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IMediaFileStore, PromotedMediaFile } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOutboundMediaQueue } from '../contracts/IOutboundMediaQueue';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';
import { buildMessagePreview } from '../../domain/services/buildMessagePreview';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { MediaNotFoundError, UnsupportedMediaTypeError } from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import { resolveConversationTarget } from './resolveConversationTarget';
import type { ChatMessageDto } from './ListMessagesUseCase';

export interface SendStoredMediaMessageInput {
  tenantId: string;
  conversationId: string;
  /** URL de mídia já guardada no `IMediaFileStore` (ex.: imagem de oferta). Nunca é movida. */
  sourceMediaUrl: string;
  mimeType: string;
  caption?: string | null;
}

export interface SendStoredMediaMessageOutput {
  message: ChatMessageDto;
}

export interface SendStoredMediaMessageDeps {
  messageRepo: IChatMessageRepository;
  conversationRepo: IChatConversationRepository;
  contactRepo: IChatContactRepository;
  engine: IMessagingEngine | null;
  files: IMediaFileStore;
  queue: IOutboundMediaQueue;
  /** Caminho temporário único para a cópia (a promoção pode mover o arquivo). */
  tmpPathFor: (ext: string) => string;
  copyFile: (srcPath: string, destPath: string) => Promise<void>;
  /** Remove um arquivo temporário; não falha se ele já não existir. */
  removeTmp: (filePath: string) => Promise<void>;
}

/** Só imagem: é o que o gerador de ofertas envia; outros tipos exigem classificação/probe. */
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

/**
 * Envia uma imagem **já armazenada** como mensagem (sem upload do painel). Mesmo contrato do
 * envio de mídia: grava `PENDING` com id externo pré-gerado e enfileira; quem envia é o despacho.
 *
 * Cada mensagem é dona do próprio arquivo: a origem é copiada para um temporário e só a cópia
 * é promovida — a origem nunca é movida nem apagada (outras mensagens podem reutilizá-la).
 */
export class SendStoredMediaMessageUseCase {
  constructor(private readonly deps: SendStoredMediaMessageDeps) {}

  async execute(input: SendStoredMediaMessageInput): Promise<SendStoredMediaMessageOutput> {
    const { tenantId, conversationId, sourceMediaUrl } = input;
    const { messageRepo, conversationRepo, contactRepo, engine, files, queue } = this.deps;

    // 1. Tipo antes de qualquer I/O
    const mimeType = input.mimeType.toLowerCase();
    const ext = IMAGE_EXT[mimeType];
    if (!ext) throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images can be sent');

    // 2. Conversa do tenant com destino válido
    const conv = await conversationRepo.findById(conversationId, tenantId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    const contact = conv.isGroup ? null : await contactRepo.findById(conv.contactId ?? '', tenantId);
    resolveConversationTarget(conv, contact);

    // 3. Sem sessão, recusa antes de gravar (nada de "grava sem enviar")
    const sessionId = conv.sessionId;
    if (!engine || !sessionId) throw new SessionNotConnectedError(sessionId ?? conversationId);
    const externalMessageId = engine.createOutboundMessageId(sessionId);

    // 4. Cópia própria da origem → promoção
    const file = await this.copyAndPromote(sourceMediaUrl, { sessionId, externalMessageId, mimeType }, ext);

    // 5. Grava PENDING; falha de banco apaga o arquivo promovido
    const caption = input.caption || null;
    let message: ChatMessage;
    try {
      message = await messageRepo.create({
        tenantId,
        conversationId,
        direction:         ChatMessageDirection.OUTBOUND,
        type:              ChatMessageType.IMAGE,
        content:           caption,
        mediaUrl:          file.publicUrl,
        mimeType,
        fileName:          null,
        durationSeconds:   null,
        quotedMessageId:   null,
        externalMessageId,
        status:            ChatMessageStatus.PENDING,
      });
    } catch (err) {
      await this.quietly('Falha ao apagar mídia promovida', conversationId, () => files.remove(file.localPath));
      throw err;
    }

    // 6. Prévia da conversa: falha não impede o envio
    await this.quietly('Falha ao atualizar prévia da conversa', conversationId, () =>
      conversationRepo.updateLastMessage(conversationId, tenantId, {
        lastMessagePreview: buildMessagePreview(ChatMessageType.IMAGE, caption),
        lastMessageAt:      message.createdAt,
      }),
    );

    // 7. Enfileira; recusa (fila cheia ou em drain) vira FAILED reenviável
    const accepted = queue.enqueue({ messageId: message.id, tenantId, sessionId, conversationId });
    if (!accepted) {
      logger.warn({ messageId: message.id, sessionId }, 'Fila de mídia recusou o envio');
      const failed = await messageRepo.transitionStatus(
        message.id, tenantId, [ChatMessageStatus.PENDING], ChatMessageStatus.FAILED,
      );
      message = failed ?? message;
    }

    return { message: toDto(message) };
  }

  /** Materializa a origem, copia para um temporário e promove a cópia. Sempre libera a origem. */
  private async copyAndPromote(
    sourceMediaUrl: string,
    target: { sessionId: string; externalMessageId: string; mimeType: string },
    ext: string,
  ): Promise<PromotedMediaFile> {
    const { files, tmpPathFor, copyFile, removeTmp } = this.deps;
    const acquired = await files.acquireLocalFile(sourceMediaUrl);
    // Código próprio: não confundir com conversa ausente (NOT_FOUND)
    if (!acquired) throw new MediaNotFoundError();

    const tmpPath = tmpPathFor(ext);
    try {
      await copyFile(acquired.filePath, tmpPath);
      return await files.promote({ srcPath: tmpPath, ...target });
    } finally {
      // Promoção local move a cópia; a remota faz upload e apaga. Sobra só em falha
      await this.quietly('Falha ao apagar cópia temporária da mídia', target.externalMessageId, () =>
        removeTmp(tmpPath),
      );
      await this.quietly('Falha ao liberar mídia de origem', target.externalMessageId, () => acquired.release());
    }
  }

  /** Limpeza/efeito secundário: registra a falha sem trocar o erro (ou o sucesso) principal. */
  private async quietly(message: string, ref: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (err) {
      logger.error({ err, ref }, message);
    }
  }
}

function toDto(message: ChatMessage): ChatMessageDto {
  return {
    id:                message.id,
    conversationId:    message.conversationId,
    tenantId:          message.tenantId,
    direction:         message.direction,
    type:              message.type,
    content:           message.content,
    mediaUrl:          message.mediaUrl,
    mimeType:          message.mimeType,
    fileName:          message.fileName,
    durationSeconds:   message.durationSeconds,
    externalMessageId: message.externalMessageId,
    status:            message.status,
    isDeleted:         message.isDeleted,
    quotedMessageId:   message.quotedMessageId,
    quotedMessage:     null,
    sentAt:            message.sentAt?.toISOString() ?? null,
    createdAt:         message.createdAt.toISOString(),
    fromParticipant:     message.fromParticipant,
    fromParticipantName: message.fromParticipantName,
    fromParticipantAvatarUrl: null,
    reactionsRevision: null,
    reactions:         [],
  };
}
