import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { AppliedConversationState } from '../../domain/contracts/IChatConversationRepository';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type ChatStateUpdatedEvent = Extract<InternalMessagingEvent, { type: 'CHAT_STATE_UPDATED' }>;

/**
 * Payload do WebSocket a partir dos campos que mudaram de fato.
 *
 * Só converte tipos — as datas viram ISO. Nunca preenche favorite nem lists: essas
 * marcações são do painel e não existem no WhatsApp, então este emissor não fala delas.
 */
export function toWsShape(changed: AppliedConversationState): {
  unreadCount?: number;
  manuallyUnread?: boolean;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: string | null;
} {
  return {
    ...(changed.unreadCount !== undefined ? { unreadCount: changed.unreadCount } : {}),
    ...(changed.manuallyUnread !== undefined ? { manuallyUnread: changed.manuallyUnread } : {}),
    ...(changed.archived !== undefined ? { archived: changed.archived } : {}),
    ...(changed.pinned !== undefined ? { pinned: changed.pinned } : {}),
    ...(changed.mutedUntil !== undefined
      ? { mutedUntil: changed.mutedUntil?.toISOString() ?? null }
      : {}),
  };
}

/**
 * Espelha no painel o estado de conversa alterado em outro aparelho do usuário:
 * leitura, marcação manual de não lida, arquivamento, fixação e silenciamento.
 *
 * O estado chega pelo adapter (chats.upsert na sincronização inicial, chats.update
 * quando muda em qualquer aparelho) e aqui é persistido e anunciado ao painel.
 *
 * Duas coisas que este listener não faz, de propósito:
 *
 * - **não publica quando nada mudou** — o painel também espelha suas próprias ações
 *   para o WhatsApp, então o eco de volta chegaria aqui a cada arquivamento; sem esse
 *   corte, uma ação viraria dois frames e uma gravação inútil
 * - **não chama a engine** — reagir a um evento recebido com uma chamada de saída
 *   fecharia o laço painel ↔ WhatsApp (AGENTS.md §9 e a restrição de segurança da
 *   feature: nenhum gatilho novo para chamada de saída)
 *
 * Conversa ainda não conhecida é ignorada em silêncio: o WhatsApp envia o estado de
 * todos os chats do aparelho, e a maioria não tem conversa correspondente aqui.
 */
export function registerChatConversationStateListener(
  conversationRepo: IChatConversationRepository,
): void {
  internalEventBus.on<ChatStateUpdatedEvent>('CHAT_STATE_UPDATED', async (payload) => {
    try {
      const result = await conversationRepo.applyRemoteState({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        isGroup: payload.isGroup,
        chatId: payload.chatId,
        state: payload.state,
      });

      if (!result || Object.keys(result.changed).length === 0) return;

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.state.updated',
        data: {
          tenantId: payload.tenantId,
          conversationId: result.conversationId,
          ...toWsShape(result.changed),
        },
      });
    } catch (err) {
      // Um chat problemático no lote da sincronização inicial não pode derrubar os demais.
      logger.warn({ err, chatId: payload.chatId }, 'Failed to apply remote conversation state');
    }
  });

  logger.info('ChatConversationStateListener registered');
}
