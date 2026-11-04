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
    // O rodízio precisa do convite: no Telegram só entra grupo/canal em que a sessão é criadora ou
    // admin com permissão de convidar (inclui canal de transmissão). WhatsApp não informa (= true).
    return { ...r, groups: r.groups.filter((g) => g.canInvite) };
  }

  async ensureConversation(tenantId: string, sessionId: string, groupJid: string): Promise<string> {
    const { conversationId } = await offersContainer.ensureSessionGroup().execute({ tenantId, sessionId, groupJid });
    return conversationId;
  }
}
