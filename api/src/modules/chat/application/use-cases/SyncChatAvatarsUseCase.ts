import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'SyncChatAvatarsUseCase' });

/** Teto de fotos buscadas por chamada — cada uma é uma ida à rede do WhatsApp. */
const DEFAULT_LIMIT = 20;

export interface SyncChatAvatarsInput {
  tenantId: string;
  limit?: number;
}

export interface SyncChatAvatarsOutput {
  /** Quantas fotos foram efetivamente obtidas e persistidas. */
  updated: number;
  /** Quantas conversas ainda estão sem avatar após esta passagem. */
  remaining: number;
}

/**
 * Preenche os avatares que faltam nas conversas.
 *
 * Emite os eventos internos que o ChatContactAvatarListener e o ChatGroupAvatarListener
 * já consomem: eles persistem a URL e avisam o painel por WebSocket. Antes deste use
 * case nenhum ponto do sistema emitia esses eventos, e por isso `avatarUrl` nunca era
 * preenchido.
 *
 * Trabalha em lotes porque cada foto é uma consulta ao WhatsApp: chamadas sucessivas
 * avançam a fila até `remaining` chegar a zero.
 */
export class SyncChatAvatarsUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: SyncChatAvatarsInput): Promise<SyncChatAvatarsOutput> {
    const conversations = await this.conversationRepo.findMany({
      tenantId: input.tenantId,
      limit: 500,
    });

    const contactIds = conversations
      .filter((conv) => !conv.isGroup && conv.contactId)
      .map((conv) => conv.contactId as string);
    const contactsById = new Map(
      (await this.contactRepo.findByIds(contactIds, input.tenantId)).map((c) => [c.id, c]),
    );

    // Alvos: grupos sem groupAvatarUrl e conversas individuais cujo contato não tem avatar.
    const pending: Array<{ jid: string; isGroup: boolean; sessionId: string }> = [];

    for (const conv of conversations) {
      if (!conv.sessionId) continue;

      if (conv.isGroup) {
        if (conv.groupJid && !conv.groupAvatarUrl) {
          pending.push({ jid: conv.groupJid, isGroup: true, sessionId: conv.sessionId });
        }
        continue;
      }

      const contact = conv.contactId ? contactsById.get(conv.contactId) : undefined;
      if (contact && !contact.avatarUrl) {
        pending.push({ jid: contact.phone, isGroup: false, sessionId: conv.sessionId });
      }
    }

    const limit = input.limit ?? DEFAULT_LIMIT;
    const batch = pending.slice(0, limit);
    let updated = 0;

    for (const target of batch) {
      try {
        const avatarUrl = await this.engine.fetchProfilePicture(
          target.sessionId,
          target.jid,
          target.isGroup,
        );
        if (!avatarUrl) continue;

        if (target.isGroup) {
          internalEventBus.emit('GROUP_AVATAR_UPDATED', {
            type: 'GROUP_AVATAR_UPDATED',
            tenantId: input.tenantId,
            groupJid: target.jid,
            avatarUrl,
          });
        } else {
          internalEventBus.emit('CONTACT_AVATAR_UPDATED', {
            type: 'CONTACT_AVATAR_UPDATED',
            tenantId: input.tenantId,
            phone: target.jid,
            avatarUrl,
          });
        }
        updated += 1;
      } catch (err) {
        log.debug({ err, jid: target.jid }, 'Failed to sync avatar');
      }
    }

    return { updated, remaining: Math.max(0, pending.length - batch.length) };
  }
}
