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
    const { tenantId, conversationId, text, imageUrl } = input;

    const conv = await chatMediaContainer.conversationRepo.findById(conversationId, tenantId);
    if (!conv || !conv.sessionId) throw new OfferDestinationUnavailableError(conversationId);
    const engine = getActiveEngine();
    if (!engine) throw new SessionNotConnectedError(conv.sessionId);

    if (imageUrl) {
      const { message } = await chatMediaContainer.sendStoredMediaMessage().execute({
        tenantId,
        conversationId,
        sourceMediaUrl: imageUrl,
        mimeType: offerImageMimeFromUrl(imageUrl),
        caption: text,
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
    ).execute({ tenantId, conversationId, content: text });
    if (!message.externalMessageId || message.status === ChatMessageStatus.FAILED) {
      throw new MessageSendFailedError('no external message id');
    }
    return { chatMessageId: message.id };
  }
}
