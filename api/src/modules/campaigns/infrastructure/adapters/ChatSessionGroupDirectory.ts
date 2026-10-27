import type { DirectoryGroup, ISessionGroupDirectory } from '../../domain/contracts/ISessionGroupDirectory';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { EngineNotReadyError } from '../../../../shared/errors/internal/MessagingErrors';

/**
 * Grupos vêm do motor (WhatsApp); a conversa é criada pelo repositório do chat, no mesmo
 * formato da ingestão (`groupJid` sem sufixo, canal whatsapp). Criada só quando o grupo é
 * escolhido como destino: listar não cria nada, para não encher o chat de conversas vazias.
 */
export class ChatSessionGroupDirectory implements ISessionGroupDirectory {
  async listParticipating(sessionId: string): Promise<DirectoryGroup[]> {
    const engine = getActiveEngine();
    if (!engine) throw new EngineNotReadyError();
    return engine.listParticipatingGroups(sessionId);
  }

  async ensureConversation(tenantId: string, sessionId: string, group: DirectoryGroup): Promise<string> {
    const repo = chatMediaContainer.conversationRepo;
    const existing = await repo.findActiveByGroupAndSession(group.groupJid, sessionId, tenantId);
    if (existing) return existing.id;
    const created = await repo.create({
      tenantId,
      sessionId,
      isGroup: true,
      groupJid: group.groupJid,
      groupName: group.name,
      channel: 'whatsapp',
    });
    return created.id;
  }
}
