import { offersContainer } from '../../../campaigns/infrastructure/offersContainer';
import type {
  ILinkRotationGroupDirectory,
  LinkRotationSessionGroupList,
} from '../../domain/contracts/ILinkRotationGroupDirectory';

/**
 * Reaproveita a listagem de grupos da sessão do gerador de ofertas (engine + conversas do chat,
 * mesma busca e mesmo merge) e o `ensure` de conversa, sem duplicar regra.
 */
export class OffersLinkRotationGroupDirectory implements ILinkRotationGroupDirectory {
  listSessionGroups(tenantId: string, sessionId: string, search?: string): Promise<LinkRotationSessionGroupList> {
    return offersContainer.listSessionGroups().execute({ tenantId, sessionId, search });
  }

  async ensureConversation(tenantId: string, sessionId: string, groupJid: string): Promise<string> {
    const { conversationId } = await offersContainer.ensureSessionGroup().execute({ tenantId, sessionId, groupJid });
    return conversationId;
  }
}
