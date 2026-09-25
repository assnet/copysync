import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { normalizeChatListName } from '../../domain/services/normalizeChatListName';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'UpdateConversationStateUseCase' });

export interface UpdateConversationStateInput {
  tenantId: string;
  conversationId: string;
  archived?: boolean;
  pinned?: boolean;
  /** Duração do silêncio em ms; null remove o silêncio. */
  muteMs?: number | null;
  favorite?: boolean;
  /** true marca como não lida. */
  unread?: boolean;
  /** Listas às quais a conversa pertence. Substitui as atuais. */
  lists?: string[];
}

export interface ConversationStateDto {
  archived: boolean;
  pinned: boolean;
  mutedUntil: string | null;
  favorite: boolean;
  manuallyUnread: boolean;
  lists: string[];
  /**
   * true quando a mudança também foi aplicada no WhatsApp. false indica que ficou
   * apenas no painel — sessão fora do ar, ou estado sem equivalente no protocolo.
   */
  syncedToWhatsApp: boolean;
}

/**
 * Aplica mudanças de estado numa conversa.
 *
 * Arquivar, fixar, silenciar e marcar como não lida são espelhados no WhatsApp; o
 * painel persiste o resultado de imediato para a interface responder na hora, e uma
 * falha na sincronização não desfaz a mudança local — ela é registrada e o retorno
 * informa que ficou só aqui.
 *
 * Favoritos e listas são exclusivos do painel: o protocolo do WhatsApp não expõe
 * equivalentes que a biblioteca permita manipular. Toda lista recebida em `lists` ganha
 * entrada no catálogo (`IChatListRepository.ensure`): é o que a mantém viva quando a
 * última conversa sai dela.
 */
export class UpdateConversationStateUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly messageRepo: IChatMessageRepository,
    private readonly listRepo: IChatListRepository,
    private readonly engine?: IMessagingEngine,
  ) {}

  async execute(input: UpdateConversationStateInput): Promise<ConversationStateDto> {
    const conversation = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conversation) throw new NotFoundError('Conversation', input.conversationId);

    const mutedUntil =
      input.muteMs === undefined
        ? undefined
        : input.muteMs === null
          ? null
          : new Date(Date.now() + input.muteMs);

    // Antes de gravar: se o catálogo falhar, a conversa não fica apontando para uma
    // lista que não existe.
    for (const name of input.lists ?? []) {
      const normalized = normalizeChatListName(name);
      if (normalized) await this.listRepo.ensure(input.tenantId, normalized);
    }

    const updated = await this.conversationRepo.updateState(input.conversationId, input.tenantId, {
      archived: input.archived,
      pinned: input.pinned,
      mutedUntil,
      favorite: input.favorite,
      manuallyUnread: input.unread,
      tags: input.lists,
      // Marcar como não lida sem contador visível não comunica nada ao operador.
      unreadCount: input.unread === true && conversation.unreadCount === 0 ? 1 : undefined,
    });

    const syncedToWhatsApp = await this.syncToWhatsApp(input, conversation.sessionId, {
      isGroup: conversation.isGroup,
      groupJid: conversation.groupJid,
      contactId: conversation.contactId,
      tenantId: input.tenantId,
    });

    return {
      archived: updated.archived,
      pinned: updated.pinned,
      mutedUntil: updated.mutedUntil?.toISOString() ?? null,
      favorite: updated.favorite,
      manuallyUnread: updated.manuallyUnread,
      lists: updated.tags,
      syncedToWhatsApp,
    };
  }

  /** Espelha no WhatsApp o que o protocolo suporta. Devolve se algo foi aplicado. */
  private async syncToWhatsApp(
    input: UpdateConversationStateInput,
    sessionId: string | null,
    conv: { isGroup: boolean; groupJid: string | null; contactId: string | null; tenantId: string },
  ): Promise<boolean> {
    const syncable =
      input.archived !== undefined || input.pinned !== undefined
      || input.muteMs !== undefined || input.unread !== undefined;
    if (!syncable || !this.engine || !sessionId) return false;

    const chatId = conv.isGroup
      ? conv.groupJid
      : (conv.contactId
          ? (await this.contactRepo.findById(conv.contactId, conv.tenantId))?.phone ?? null
          : null);
    if (!chatId) return false;

    const [last] = await this.messageRepo.findMany({
      tenantId: conv.tenantId,
      conversationId: input.conversationId,
      limit: 1,
      orderDir: 'desc',
    });

    try {
      await this.engine.updateChatState({
        sessionId,
        chatId,
        isGroup: conv.isGroup,
        lastMessage: last?.externalMessageId
          ? {
              externalId: last.externalMessageId,
              fromMe: last.direction === 'OUTBOUND',
              timestamp: last.sentAt ?? last.createdAt,
            }
          : undefined,
        archived: input.archived,
        pinned: input.pinned,
        muteMs: input.muteMs,
        read: input.unread === undefined ? undefined : !input.unread,
      });
      return true;
    } catch (err) {
      // A mudança local permanece: desfazê-la seria pior do que ficar dessincronizado
      // com o aparelho, e o retorno avisa o painel.
      log.warn({ err, conversationId: input.conversationId }, 'Failed to sync chat state to WhatsApp');
      return false;
    }
  }
}
