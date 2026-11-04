import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { ISessionGroupDirectory } from '../../domain/contracts/ISessionGroupDirectory';
import { mergeSessionGroups, type SessionGroupItem } from '../../domain/services/mergeSessionGroups';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { GroupNotPostableError } from '../../../../shared/errors/internal/GroupErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

export interface SessionGroupsDeps {
  configs: IOfferGeneratorConfigRepository;
  directory: ISessionGroupDirectory;
}

export interface ListSessionGroupsResult {
  groups: SessionGroupItem[];
  /** true = WhatsApp não respondeu; a lista traz só os grupos que o chat já conhece. */
  partial: boolean;
}

/** Grupos para escolher como destino: todos os da sessão no WhatsApp, não só os com mensagem. */
export class ListSessionGroupsUseCase {
  constructor(private readonly deps: SessionGroupsDeps) {}

  async execute(input: { tenantId: string; sessionId: string; search?: string }): Promise<ListSessionGroupsResult> {
    const { tenantId, sessionId } = input;
    if (!(await this.deps.configs.findSession(tenantId, sessionId))) throw new NotFoundError('Session', sessionId);

    const known = await this.deps.configs.listSessionGroupConversations(tenantId, sessionId);
    let live = null;
    try {
      live = await this.deps.directory.listParticipating(sessionId);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      logger.warn({ sessionId, code: err.code }, 'participating groups unavailable, listing known groups only');
    }
    return { groups: mergeSessionGroups(live, known, input.search), partial: live === null };
  }
}

/**
 * Garante a conversa do grupo escolhido. Só aceita grupo de que a sessão participa: o id
 * do WhatsApp vem do painel e não pode criar conversa para qualquer grupo. `purpose` 'send'
 * (padrão: destino de envio) recusa grupo em que a sessão não posta; 'monitor' aceita.
 */
export type SessionGroupPurpose = 'monitor' | 'send';

export class EnsureSessionGroupUseCase {
  constructor(private readonly deps: SessionGroupsDeps) {}

  async execute(input: { tenantId: string; sessionId: string; groupJid: string; purpose?: SessionGroupPurpose }): Promise<{ conversationId: string; title: string | null }> {
    const { tenantId, sessionId, groupJid, purpose = 'send' } = input;
    if (!(await this.deps.configs.findSession(tenantId, sessionId))) throw new NotFoundError('Session', sessionId);

    const group = (await this.deps.directory.listParticipating(sessionId)).find((g) => g.groupJid === groupJid);
    if (!group) throw new NotFoundError('Group', groupJid);
    if (purpose === 'send' && group.canPost === false) throw new GroupNotPostableError(groupJid);

    const conversationId = await this.deps.directory.ensureConversation(tenantId, sessionId, group);
    return { conversationId, title: group.name };
  }
}
