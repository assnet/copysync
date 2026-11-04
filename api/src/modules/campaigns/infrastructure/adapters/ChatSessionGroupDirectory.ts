import type { DirectoryGroup, ISessionGroupDirectory } from '../../domain/contracts/ISessionGroupDirectory';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { EngineNotReadyError } from '../../../../shared/errors/internal/MessagingErrors';
import { channelForEngine } from '../../../chat/domain/services/conversationChannel';
import { PrismaSessionRepository } from '../../../sessions/infrastructure/repositories/PrismaSessionRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';

/**
 * Grupos vêm do motor da sessão (WhatsApp ou Telegram); a conversa é criada pelo repositório do
 * chat, no mesmo formato da ingestão (`groupJid` sem sufixo, canal pela engine da sessão). Criada só quando o grupo é
 * escolhido como destino: listar não cria nada, para não encher o chat de conversas vazias.
 */
export class ChatSessionGroupDirectory implements ISessionGroupDirectory {
  constructor(
    private readonly sessionEngines: () => Pick<ISessionRepository, 'findEngineById'> = () => new PrismaSessionRepository(),
  ) {}

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
      channel: channelForEngine(await this.sessionEngines().findEngineById(sessionId)),
    });
    return created.id;
  }
}
