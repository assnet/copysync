import type {
  IOfferMessageSender,
  SendOfferMessageInput,
} from '../../domain/contracts/IOfferMessageSender';
import { SendMessageUseCase } from '../../../chat/application/use-cases/SendMessageUseCase';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';
import { ChatMessageStatus } from '../../../chat/domain/enums/ChatMessageEnums';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { MessageSendFailedError } from '../../../../shared/errors/internal/MessagingErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { OfferDestinationUnavailableError } from '../../../../shared/errors/internal/OfferErrors';
import { offerImageMimeFromUrl } from './offerImageTypes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'ChatOfferMessageSender' });

/**
 * Envia a oferta pelo chat. Com foto: mídia armazenada (PENDING + fila, como o painel).
 * Sem foto: o mesmo `SendMessageUseCase` da rota do painel. Use cases montados por envio
 * para pegar a engine ativa na hora; repositórios e fila são os singletons do chat.
 *
 * Pré-checa conversa/sessão/engine: o `SendMessageUseCase` grava sem enviar quando falta
 * engine ou `sessionId` — aqui isso vira erro, nunca SENT falso.
 */
export class ChatOfferMessageSender implements IOfferMessageSender {
  async send(input: SendOfferMessageInput): Promise<{ chatMessageId: string }> {
    const { tenantId, conversationId, text, imageUrl, mentionAll } = input;

    const conv = await chatMediaContainer.conversationRepo.findById(conversationId, tenantId);
    if (!conv || !conv.sessionId) throw new OfferDestinationUnavailableError(conversationId);
    const engine = getActiveEngine();
    if (!engine) throw new SessionNotConnectedError(conv.sessionId);

    // Menção a todos só existe em grupo
    const wantsMentions = mentionAll && conv.isGroup && !!conv.groupJid;
    const mentions = wantsMentions
      ? await this.groupMentions(engine, conv.sessionId, conv.groupJid!, conversationId)
      : null;

    if (imageUrl) {
      // Menção só no job da fila: reenvio manual/recuperação sai sem marcar (ver OutboundMediaJob)
      const { message } = await chatMediaContainer.sendStoredMediaMessage().execute({
        tenantId,
        conversationId,
        sourceMediaUrl: imageUrl,
        mimeType: offerImageMimeFromUrl(imageUrl),
        caption: text,
        mentions,
      });
      // FAILED aqui = fila recusou. Falha assíncrona do despacho depois de enfileirar deixa o
      // envio SENT (mensagem FAILED no chat); reconciliar por chatMessageId é trabalho futuro.
      if (message.status === ChatMessageStatus.FAILED) throw new MessageSendFailedError('media queue refused');
      return { chatMessageId: message.id };
    }

    const message = await new SendMessageUseCase(
      chatMediaContainer.messageRepo,
      chatMediaContainer.conversationRepo,
      chatMediaContainer.contactRepo,
      engine,
    ).execute({ tenantId, conversationId, content: text, mentions });
    if (!message.externalMessageId || message.status === ChatMessageStatus.FAILED) {
      throw new MessageSendFailedError('no external message id');
    }
    return { chatMessageId: message.id };
  }

  /** Telefones dos participantes; falha na consulta = envia sem menção (não perde a oferta). */
  private async groupMentions(
    engine: IMessagingEngine,
    sessionId: string,
    groupJid: string,
    conversationId: string,
  ): Promise<string[] | null> {
    try {
      const participants = await engine.getGroupParticipants(sessionId, groupJid);
      const phones = [...new Set(participants.map((p) => p.phone).filter((p): p is string => !!p))];
      return phones.length ? phones : null;
    } catch (err) {
      log.warn({ conversationId, err: (err as Error)?.name }, 'group participants unavailable, sending without mentions');
      return null;
    }
  }
}
