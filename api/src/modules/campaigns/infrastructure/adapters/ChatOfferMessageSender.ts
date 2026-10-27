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
import { resolveConversationTarget } from '../../../chat/application/use-cases/resolveConversationTarget';
import { OFFER_TYPING_SECONDS_MAX } from '../../domain/offerTyping';
import type { ChatConversation } from '../../../chat/domain/entities/ChatConversation';

const log = logger.child({ module: 'ChatOfferMessageSender' });

/** O WhatsApp apaga o "digitando…" em ~10 s; reenviar antes disso mantém o indicador. */
export const PRESENCE_REFRESH_MS = 8_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Envia a oferta pelo chat. Com foto: mídia armazenada (PENDING + fila, como o painel).
 * Sem foto: o mesmo `SendMessageUseCase` da rota do painel. Use cases montados por envio
 * para pegar a engine ativa na hora; repositórios e fila são os singletons do chat.
 *
 * Pré-checa conversa/sessão/engine: o `SendMessageUseCase` grava sem enviar quando falta
 * engine ou `sessionId` — aqui isso vira erro, nunca SENT falso.
 */
export class ChatOfferMessageSender implements IOfferMessageSender {
  constructor(private readonly sleep: (ms: number) => Promise<void> = defaultSleep) {}

  async send(input: SendOfferMessageInput): Promise<{ chatMessageId: string }> {
    const { tenantId, conversationId, text, imageUrl, mentionAll, simulateTyping, typingSeconds } = input;

    const conv = await chatMediaContainer.conversationRepo.findById(conversationId, tenantId);
    if (!conv || !conv.sessionId) throw new OfferDestinationUnavailableError(conversationId);
    const engine = getActiveEngine();
    if (!engine) throw new SessionNotConnectedError(conv.sessionId);

    // Menção a todos só existe em grupo
    const wantsMentions = mentionAll && conv.isGroup && !!conv.groupJid;
    const mentions = wantsMentions
      ? await this.groupMentions(engine, conv.sessionId, conv.groupJid!, conversationId)
      : null;

    if (simulateTyping) await this.showTyping(engine, conv, tenantId, typingSeconds);

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

  /**
   * "Digitando…" por `seconds` antes da oferta. Melhor esforço: falha na presença (contato
   * sumido, sessão oscilando) não segura a oferta — envia sem esperar o resto.
   */
  private async showTyping(
    engine: IMessagingEngine,
    conv: ChatConversation,
    tenantId: string,
    seconds: number,
  ): Promise<void> {
    const totalMs = Math.min(seconds, OFFER_TYPING_SECONDS_MAX) * 1000;
    if (!conv.sessionId || totalMs <= 0) return;
    let to: string;
    try {
      const contact = conv.isGroup ? null : await chatMediaContainer.contactRepo.findById(conv.contactId ?? '', tenantId);
      to = resolveConversationTarget(conv, contact).recipientPhone;
      for (let elapsed = 0; elapsed < totalMs; elapsed += PRESENCE_REFRESH_MS) {
        await engine.sendPresence(conv.sessionId, to, 'composing');
        await this.sleep(Math.min(PRESENCE_REFRESH_MS, totalMs - elapsed));
      }
    } catch (err) {
      log.warn({ conversationId: conv.id, err: (err as Error)?.name }, 'typing indicator failed, sending now');
      return;
    }
    await engine.sendPresence(conv.sessionId, to, 'paused').catch(() => undefined);
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
