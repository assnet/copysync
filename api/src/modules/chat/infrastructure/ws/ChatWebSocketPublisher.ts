import type { WebSocket } from 'ws';
import { logger } from '../../../../shared/logger/logger';
import type { ReactionSummary } from '../../domain/services/aggregateReactions';

/**
 * Typed WebSocket event contract.
 * The frontend must handle the same discriminated union.
 */
export type ChatWsEvent =
  | {
      event: 'chat.message.created';
      data: {
        tenantId: string;
        conversationId: string;
        message: {
          id: string;
          conversationId: string;
          direction: string;
          type: string;
          content: string | null;
          mediaUrl: string | null;
          mimeType: string | null;
          fileName?: string | null;
          durationSeconds?: number | null;
          status: string | null;
          isDeleted?: boolean;
          quotedMessageId?: string | null;
          sentAt: string | null;
          createdAt: string;
          fromParticipant?: string | null;
          fromParticipantName?: string | null;
          /** Id no WhatsApp: o painel só oferece reagir quando ele existe. */
          externalMessageId: string | null;
        };
        unreadCount: number;
        isNewConversation: boolean;
      };
    }
  | {
      event: 'chat.conversation.updated';
      data: {
        tenantId: string;
        conversationId: string;
        status: string;
        assignedUserId: string | null;
        queueName: string | null;
        tags: string[];
        notes: string | null;
        unreadCount: number;
        lastMessagePreview: string | null;
        lastMessageAt: string | null;
      };
    }
  | {
      event: 'chat.unread.updated';
      data: {
        tenantId: string;
        conversationId: string;
        unreadCount: number;
        /**
         * Acompanha o contador quando a leitura também limpa a marcação manual. Opcional
         * para não quebrar quem já publica só o contador.
         */
        manuallyUnread?: boolean;
      };
    }
  | {
      event: 'chat.message.status.updated';
      data: {
        tenantId: string;
        conversationId: string;
        messageId: string;
        status: string;
      };
    }
  | {
      /** Agregado completo das reações de uma mensagem — substitui o estado, nunca é delta. */
      event: 'chat.message.reaction.updated';
      data: {
        tenantId: string;
        conversationId: string;
        messageId: string;
        /** Maior updatedAt das reações da mensagem; o painel descarta agregado com revisão menor. */
        reactionsRevision: string | null;
        reactions: ReactionSummary[];
      };
    }
  | {
      event: 'chat.presence.updated';
      data: {
        tenantId: string;
        phone: string;
        presence: string;
      };
    }
  | {
      event: 'chat.session.updated';
      data: {
        tenantId: string;
        sessionId: string;
        status: string;
      };
    }
  | {
      event: 'chat.contact.updated';
      data: {
        tenantId: string;
        phone: string;
        avatarUrl: string;
      };
    }
  | {
      event: 'chat.group.avatar.updated';
      data: {
        tenantId: string;
        groupJid: string;
        avatarUrl: string;
      };
    }
  | {
      /**
       * Estado de conversa alterado fora desta aba: em outro aparelho do usuário
       * (espelhamento) ou por outro operador do mesmo tenant (PATCH /state).
       *
       * Todos os campos são opcionais e cada emissor preenche o que sabe — o
       * espelhamento nunca envia favorite/lists, que não existem no WhatsApp.
       */
      event: 'chat.state.updated';
      data: {
        tenantId: string;
        conversationId: string;
        unreadCount?: number;
        manuallyUnread?: boolean;
        archived?: boolean;
        pinned?: boolean;
        /** ISO 8601, ou null quando a conversa deixa de ser silenciada. */
        mutedUntil?: string | null;
        favorite?: boolean;
        lists?: string[];
      };
    }
  | { event: 'ping' };

/**
 * Singleton that manages WebSocket client connections per tenant.
 *
 * Responsibilities:
 * - Subscribe a WS socket to a tenant channel
 * - Unsubscribe when the socket closes
 * - Publish typed events to all subscribers of a tenant
 */
class ChatWebSocketPublisher {
  private readonly clients = new Map<string, Set<WebSocket>>();

  subscribe(tenantId: string, ws: WebSocket): void {
    if (!this.clients.has(tenantId)) {
      this.clients.set(tenantId, new Set());
    }
    this.clients.get(tenantId)!.add(ws);
    logger.debug({ tenantId }, 'WS client subscribed');
  }

  unsubscribe(tenantId: string, ws: WebSocket): void {
    const set = this.clients.get(tenantId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.clients.delete(tenantId);
    logger.debug({ tenantId }, 'WS client unsubscribed');
  }

  publish(tenantId: string, payload: ChatWsEvent): void {
    const set = this.clients.get(tenantId);
    if (!set || set.size === 0) return;

    const data = JSON.stringify(payload);
    for (const ws of set) {
      try {
        // readyState 1 === OPEN
        if (ws.readyState === 1) {
          ws.send(data);
        }
      } catch (err) {
        logger.warn({ err, tenantId }, 'WS send failed — removing dead client');
        set.delete(ws);
      }
    }
  }

  /** Broadcast ping to all connected tenants (keepalive). */
  pingAll(): void {
    for (const [, set] of this.clients) {
      for (const ws of set) {
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify({ event: 'ping' }));
        } catch {
          // ignore
        }
      }
    }
  }
}

/** Application-wide singleton — import this everywhere. */
export const chatWsPublisher = new ChatWebSocketPublisher();
