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
  async listSessionGroups(tenantId: string, sessionId: string, search?: string): Promise<LinkRotationSessionGroupList> {
    const r = await offersContainer.listSessionGroups().execute({ tenantId, sessionId, search });
    // Canal só de leitura (Telegram) não é grupo de rodízio: mantém a lista de antes
    return { ...r, groups: r.groups.filter((g) => g.canPost) };
  }

  async ensureConversation(tenantId: string, sessionId: string, groupJid: string): Promise<string> {
    const { conversationId } = await offersContainer.ensureSessionGroup().execute({ tenantId, sessionId, groupJid });
    return conversationId;
  }
}
