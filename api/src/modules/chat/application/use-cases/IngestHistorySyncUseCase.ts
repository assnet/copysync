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
  body: string;
  /** true = mensagem enviada por nós → OUTBOUND; false = recebida → INBOUND */
  fromMe: boolean;
  /** Timestamp original da mensagem */
  timestamp: Date;
}

export interface IngestHistorySyncInput {
  tenantId: string;
  sessionId: string;
  messages: HistoryMessageItem[];
}

const CHUNK_SIZE = 50;
const log = logger.child({ module: 'IngestHistorySyncUseCase' });

/**
 * Processa em background um lote de mensagens históricas do WhatsApp.
 *
 * - Idempotente: verifica externalMessageId antes de criar
 * - Não publica eventos WebSocket (sync silencioso)
 * - Não incrementa contador de não-lidas
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
    const valid = input.messages.filter((m) => m.body && m.externalMessageId);
    if (valid.length === 0) return;

    log.info(
      { tenantId: input.tenantId, sessionId: input.sessionId, total: valid.length },
      'History sync started',
    );

    // Agenda processamento de todos os chunks em background
    this.scheduleChunks(input.tenantId, input.sessionId, valid, 0);
  }

  private scheduleChunks(
    tenantId: string,
    sessionId: string,
    messages: HistoryMessageItem[],
    offset: number,
  ): void {
    if (offset >= messages.length) {
      log.info({ tenantId, sessionId }, 'History sync completed');
      return;
    }

    setImmediate(() => {
      const chunk = messages.slice(offset, offset + CHUNK_SIZE);
      this.processChunk(tenantId, sessionId, chunk)
        .catch((err) => log.warn({ err, tenantId, sessionId, offset }, 'Chunk error in history sync'))
        .finally(() => this.scheduleChunks(tenantId, sessionId, messages, offset + CHUNK_SIZE));
    });
  }

  private async processChunk(
    tenantId: string,
    sessionId: string,
    items: HistoryMessageItem[],
  ): Promise<void> {
    // Acumula a última mensagem por conversa para atualizar preview ao final
    const latestPerConversation = new Map<string, { preview: string; at: Date }>();

    for (const item of items) {
      try {
        // Deduplicação
        const existing = await this.messageRepo.findByExternalId(item.externalMessageId, tenantId);
        if (existing) continue;

        // Contato
        const contact = await this.contactRepo.findOrCreate({
          tenantId,
          phone: item.from,
          name: item.fromName ?? item.from,
        });

        // Conversa ativa ou nova
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
          });
        }

        const direction = item.fromMe
          ? ChatMessageDirection.OUTBOUND
          : ChatMessageDirection.INBOUND;

        await this.messageRepo.create({
          tenantId,
          conversationId: conversation.id,
          direction,
          type: ChatMessageType.TEXT,
          content: item.body,
          externalMessageId: item.externalMessageId,
          sentAt: item.timestamp,
        });

        // Mantém apenas a mensagem mais recente por conversa
        const current = latestPerConversation.get(conversation.id);
        if (!current || item.timestamp > current.at) {
          latestPerConversation.set(conversation.id, {
            preview: item.body.slice(0, 120),
            at: item.timestamp,
          });
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
