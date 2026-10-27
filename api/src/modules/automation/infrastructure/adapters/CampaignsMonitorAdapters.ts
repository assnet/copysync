import type {
  IMonitorGroupDirectory, IOfferQueue, ITenantLinkBuilder, QueueOfferInput, QueueOfferResult, TenantLinkResult,
} from '../../domain/contracts/IMonitorPorts';
import { offersContainer } from '../../../campaigns/infrastructure/offersContainer';
import { chatMediaContainer } from '../../../chat/infrastructure/chatMediaContainer';

/** Link do tenant pelo gerador de link de `campaigns` (clients, credenciais, anti-SSRF). */
export class CampaignsTenantLinkBuilder implements ITenantLinkBuilder {
  build(tenantId: string, href: string): Promise<TenantLinkResult> {
    return offersContainer.buildTenantAffiliateLink().execute(tenantId, href);
  }
}

/** Fila de envio por sessão de `campaigns`; a oferta nasce com origem MONITORING. */
export class CampaignsOfferQueue implements IOfferQueue {
  enqueue(input: QueueOfferInput): Promise<QueueOfferResult> {
    return offersContainer.enqueueOffer().execute({ ...input, origin: 'MONITORING' });
  }
}

/**
 * Grupo escolhido: só aceita grupo de que a sessão participa (regra do `EnsureSessionGroupUseCase`
 * do gerador) e cria a conversa no chat se faltar. Download automático de mídia pelo repositório
 * do chat (mesmo campo que o painel liga em "Baixar mídia automaticamente").
 */
export class ChatMonitorGroupDirectory implements IMonitorGroupDirectory {
  async ensureGroup(tenantId: string, sessionId: string, groupJid: string): Promise<{ conversationId: string }> {
    const { conversationId } = await offersContainer.ensureSessionGroup().execute({ tenantId, sessionId, groupJid });
    return { conversationId };
  }

  async enableMediaDownload(tenantId: string, conversationId: string): Promise<void> {
    await chatMediaContainer.conversationRepo.update(conversationId, tenantId, { autoDownloadMedia: true });
  }
}
