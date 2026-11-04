import { offersContainer } from '../../../campaigns/infrastructure/offersContainer';
import type { SessionGroupItem } from '../../../campaigns/domain/services/mergeSessionGroups';
import type {
  ILinkRotationGroupDirectory,
  LinkRotationSessionGroup,
  LinkRotationSessionGroupList,
} from '../../domain/contracts/ILinkRotationGroupDirectory';

/** Só os campos do rodízio (o item do gerador traz também `canPost`). */
export function toLinkRotationSessionGroup(g: SessionGroupItem): LinkRotationSessionGroup {
  return {
    groupJid: g.groupJid,
    title: g.title,
    avatarUrl: g.avatarUrl,
    conversationId: g.conversationId,
    canInvite: g.canInvite,
    inviteBlockedReason: g.canInvite ? null : (g.inviteBlockedReason ?? 'NOT_ADMIN'),
  };
}

/**
 * Reaproveita a listagem de grupos da sessão do gerador de ofertas (engine + conversas do chat,
 * mesma busca e mesmo merge) e o `ensure` de conversa, sem duplicar regra.
 */
export class OffersLinkRotationGroupDirectory implements ILinkRotationGroupDirectory {
  async listSessionGroups(tenantId: string, sessionId: string, search?: string): Promise<LinkRotationSessionGroupList> {
    const r = await offersContainer.listSessionGroups().execute({ tenantId, sessionId, search });
    // Todos voltam, com `canInvite`: o painel decide ocultar ou mostrar desabilitado com o motivo.
    // Sem convite o servidor não gera link (GROUP_INVITE_NOT_ALLOWED → NEEDS_LINK); só link manual.
    return { partial: r.partial, groups: r.groups.map(toLinkRotationSessionGroup) };
  }

  async ensureConversation(tenantId: string, sessionId: string, groupJid: string): Promise<string> {
    // O rodízio não posta no grupo, só gera convite: 'monitor' não recusa grupo só-admins/canal.
    const { conversationId } = await offersContainer.ensureSessionGroup().execute({ tenantId, sessionId, groupJid, purpose: 'monitor' });
    return conversationId;
  }
}
