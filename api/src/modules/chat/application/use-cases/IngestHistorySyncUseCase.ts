import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import { logger } from '../../../../shared/logger/logger';

export interface HistoryMessageItem {
  /** ID externo da mensagem (Baileys key.id) — necessário para deduplicação */
  externalMessageId: string;
  /**
   * Número de telefone do contato envolvido (sem @s.whatsapp.net).
   * Para mensagens enviadas (fromMe=true) e recebidas, é sempre o remoteJid normalizado.
   */
  from: string;
  fromName?: string;
  body: string | null;
  /** Tipo detectado da mensagem */
  msgType?: ChatMessageType;
  /** URL local da mídia (já baixada do CDN), quando disponível */
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  isDeleted?: boolean;
  quotedMessageId?: string | null;
  /** true = mensagem enviada por nós → OUTBOUND; false = recebida → INBOUND */
  fromMe: boolean;
  /** Timestamp original da mensagem */
  timestamp: Date;
  /** true = mensagem de grupo */
  isGroup?: boolean;
  /** JID do grupo (sem @g.us), quando isGroup=true */
  groupJid?: string;
  /** Nome do grupo, quando isGroup=true */
  groupName?: string;
  /** Telefone do participante que enviou (sem @s.whatsapp.net), em grupos */
  participant?: string;
  /** Nome do participante que enviou, em grupos */
  participantName?: string;
}

export interface IngestHistorySyncInput {
  tenantId: string;
  sessionId: string;
  messages: HistoryMessageItem[];
  /**
   * Total de não lidas por chat, como o aparelho reporta no mesmo lote de history sync.
   * Chave: groupJid em grupos, telefone em conversas individuais.
   *
   * Usado **apenas na criação** da conversa. Conversa que já existe é reconciliada pelo
   * caminho de espelhamento (applyRemoteState), que é monotônico para baixo justamente
   * porque lotes atrasados ressuscitariam badge — restrição que não se aplica aqui, já
   * que criar acontece uma vez só.
   */
  unreadByChat?: Record<string, number>;
}

const CHUNK_SIZE = 50;
const log = logger.child({ module: 'IngestHistorySyncUseCase' });

/**
 * Processa em background um lote de mensagens históricas do WhatsApp.
 *
 * - Idempotente: verifica externalMessageId antes de criar
 * - Não publica eventos WebSocket (sync silencioso)
 * - Não incrementa contador de não-lidas; apenas semeia o total do aparelho ao criar
 *   uma conversa, quando o lote informa (unreadByChat)
 * - Processa em chunks de CHUNK_SIZE via setImmediate para não bloquear o event loop
 * - Atualiza lastMessageAt/preview da conversa apenas quando a mensagem é mais recente
 */
export class IngestHistorySyncUseCase {
  constructor(
    private readonly contactRepo: IChatContactRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  execute(input: IngestHistorySyncInput): void {
    const valid = input.messages.filter((m) => m.externalMessageId && (m.body !== null || m.msgType));
    if (valid.length === 0) return;

    log.info(
      { tenantId: input.tenantId, sessionId: input.sessionId, total: valid.length },
      'History sync started',
    );

    // Agenda processamento de todos os chunks em background
    this.scheduleChunks(input.tenantId, input.sessionId, valid, 0, input.unreadByChat);
  }

  private scheduleChunks(
    tenantId: string,
    sessionId: string,
    messages: HistoryMessageItem[],
    offset: number,
    unreadByChat?: Record<string, number>,
  ): void {
    if (offset >= messages.length) {
      log.info({ tenantId, sessionId }, 'History sync completed');
      return;
    }

    setImmediate(() => {
      const chunk = messages.slice(offset, offset + CHUNK_SIZE);
      this.processChunk(tenantId, sessionId, chunk, unreadByChat)
        .catch((err) => log.warn({ err, tenantId, sessionId, offset }, 'Chunk error in history sync'))
        .finally(() =>
          this.scheduleChunks(tenantId, sessionId, messages, offset + CHUNK_SIZE, unreadByChat),
        );
    });
  }

  private async processChunk(
    tenantId: string,
    sessionId: string,
    items: HistoryMessageItem[],
    unreadByChat?: Record<string, number>,
  ): Promise<void> {
    // Acumula a última mensagem por conversa para atualizar preview ao final
    const latestPerConversation = new Map<string, { preview: string; at: Date }>();

    for (const item of items) {
      try {
        // Deduplicação
        const existing = await this.messageRepo.findByExternalId(item.externalMessageId, tenantId);
        if (existing) continue;

        let conversationId: string;

        if (item.isGroup && item.groupJid) {
          // Conversa de grupo — não usa contato, usa groupJid
          let conversation = await this.conversationRepo.findActiveByGroupAndSession(
            item.groupJid,
            sessionId,
            tenantId,
          );
          if (!conversation) {
            conversation = await this.conversationRepo.create({
              tenantId,
              sessionId,
              isGroup: true,
              groupJid: item.groupJid,
              groupName: item.groupName,
              ...(unreadByChat?.[item.groupJid] !== undefined
                ? { unreadCount: unreadByChat[item.groupJid] }
                : {}),
            });
          }
          conversationId = conversation.id;
        } else {
          // Conversa individual — usa contato
          const contact = await this.contactRepo.findOrCreate({
            tenantId,
            phone: item.from,
            name: (!item.fromMe && item.fromName) ? item.fromName : item.from,
          });

          let conversation = await this.conversationRepo.findActiveByContactAndSession(
            contact.id,
            sessionId,
            tenantId,
          );
          if (!conversation) {
            conversation = await this.conversationRepo.create({
              tenantId,
              sessionId,
              contactId: contact.id,
              ...(unreadByChat?.[item.from] !== undefined
                ? { unreadCount: unreadByChat[item.from] }
                : {}),
            });
          }
          conversationId = conversation.id;
        }

        const direction = item.fromMe
          ? ChatMessageDirection.OUTBOUND
          : ChatMessageDirection.INBOUND;
        const type = item.msgType ?? ChatMessageType.TEXT;

        await this.messageRepo.create({
          tenantId,
          conversationId,
          direction,
          type,
          content: item.body,
          mediaUrl: item.mediaUrl ?? null,
          mimeType: item.mimeType ?? null,
          fileName: item.fileName ?? null,
          durationSeconds: item.durationSeconds ?? null,
          isDeleted: item.isDeleted ?? false,
          quotedMessageId: item.quotedMessageId ?? null,
          externalMessageId: item.externalMessageId,
          sentAt: item.timestamp,
          fromParticipant: item.participant ?? null,
          fromParticipantName: item.participantName ?? null,
        });

        // Mantém apenas a mensagem mais recente por conversa
        const preview = buildHistoryPreview(type, item.body);
        const current = latestPerConversation.get(conversationId);
        if (!current || item.timestamp > current.at) {
          latestPerConversation.set(conversationId, { preview, at: item.timestamp });
        }
      } catch (err) {
        log.warn({ err, externalMessageId: item.externalMessageId }, 'Failed to ingest history message');
      }
    }

    // Atualiza preview/lastMessageAt das conversas envolvidas
    for (const [conversationId, update] of latestPerConversation) {
      try {
        await this.conversationRepo.updateLastMessage(conversationId, tenantId, {
          lastMessagePreview: update.preview,
          lastMessageAt: update.at,
        });
      } catch (err) {
        log.warn({ err, conversationId }, 'Failed to update conversation after history sync');
      }
    }
  }
}

function buildHistoryPreview(type: ChatMessageType, body: string | null): string {
  if (body) return body.slice(0, 120);
  const labels: Partial<Record<ChatMessageType, string>> = {
    [ChatMessageType.IMAGE]:    '📷 Imagem',
    [ChatMessageType.AUDIO]:    '🎵 Áudio',
    [ChatMessageType.VIDEO]:    '🎥 Vídeo',
    [ChatMessageType.DOCUMENT]: '📄 Documento',
    [ChatMessageType.STICKER]:  '😊 Sticker',
    [ChatMessageType.LOCATION]: '📍 Localização',
    [ChatMessageType.VCARD]:    '👤 Contato',
    [ChatMessageType.CALL_LOG]: '📞 Chamada',
  };
  return labels[type] ?? '📎 Mídia';
}
