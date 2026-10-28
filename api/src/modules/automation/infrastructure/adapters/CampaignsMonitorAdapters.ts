import { parseProductRef } from '../../../campaigns/domain/services/parseProductRef';
import { providerRequiresSecret, providerUsesSession } from '../../../integrations/domain/services/affiliateProviderFields';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type {
  CredentialState, ICredentialStateSource, IMonitorGroupDirectory, IMonitorImageStore, IMonitorProductReader, IMonitorTextComposer, IOfferQueue, ITenantLinkBuilder,
  MonitorComposeInput, MonitorProductData, QueueOfferInput, QueueOfferResult, TenantLinkResult,
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

/** Dados do produto pelo mesmo caminho do gerador (`ResolveProductDataUseCase`), com a credencial do tenant. */
export class CampaignsMonitorProductReader implements IMonitorProductReader {
  async read(tenantId: string, provider: AffiliateProvider, sourceUrl: string): Promise<MonitorProductData | null> {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      return null;
    }
    const ref = parseProductRef(provider, url);
    const cred = await offersContainer.credentials().execute(tenantId, provider);
    const data = await offersContainer.resolveProductData().resolve(provider, ref, url, cred);
    if (!data.title && data.priceCents == null && !data.imageSourceUrl) return null;
    return { title: data.title, priceCents: data.priceCents, originalPriceCents: data.originalPriceCents, imageUrl: data.imageSourceUrl };
  }
}

/** Estado das credenciais do tenant pelo repositório de `integrations` exposto no container de campaigns. */
export class CampaignsCredentialStateSource implements ICredentialStateSource {
  async listStates(tenantId: string): Promise<CredentialState[]> {
    const rows = await offersContainer.credentialRepo().listByTenant(tenantId);
    return rows.map((c) => ({
      provider: c.provider,
      usable: c.status === 'ACTIVE' && !!c.publicIdentifier
        && (!providerRequiresSecret(c.provider) || c.hasSecret)
        && (!providerUsesSession(c.provider) || c.hasSession),
      rejectedAt: c.rejectedAt,
      rejectedCode: c.rejectedCode,
    }));
  }
}

export class CampaignsMonitorTextComposer implements IMonitorTextComposer {
  compose(input: MonitorComposeInput) {
    return offersContainer.offerTexts().compose(input);
  }
}

export class CampaignsMonitorImageStore implements IMonitorImageStore {
  store(externalUrl: string): Promise<string | null> {
    return offersContainer.resolveProductData().storeImage(externalUrl);
  }
}
