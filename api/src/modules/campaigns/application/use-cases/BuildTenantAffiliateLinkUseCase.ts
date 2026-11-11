import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IAffiliateCredentialGateway } from '../../domain/contracts/IAffiliateCredentialGateway';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import { isMarketplaceEnabled } from '../services/requireMarketplaceEnabled';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { marketplaceEntitlementKey } from '../../domain/services/marketplaceEntitlement';
import type { TenantAffiliateLinkComposer, TenantLinkProductData } from '../services/TenantAffiliateLinkComposer';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

export type TenantAffiliateLink =
  /** Não é link de produto de marketplace suportado (convite de grupo, outro site, vitrine…). */
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  /** Marketplace fora do plano (da URL colada ou da final): nada é expandido, lido nem pedido à loja. */
  | { kind: 'plan_unavailable'; provider: AffiliateProvider }
  /** Com credencial, mas sem aceite da versão vigente do aviso de risco: nada é pedido à loja. */
  | { kind: 'risk_not_accepted'; provider: AffiliateProvider }
  /** Loja recusou a credencial (agora ou antes): nada é pedido à loja até o usuário reconfigurar. */
  | { kind: 'credential_rejected'; provider: AffiliateProvider; since: Date }
  | { kind: 'failed'; provider: AffiliateProvider | null; code: string }
  | { kind: 'ok'; provider: AffiliateProvider; sourceUrl: string; affiliateUrl: string; product?: TenantLinkProductData };

export type { TenantLinkProductData };

export interface BuildTenantAffiliateLinkDeps {
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialGateway;
  entitlements: IEntitlementReader;
  /** Núcleo por marketplace (sem efeito colateral); a pausa por `markRejected` fica aqui. */
  composer: Pick<TenantAffiliateLinkComposer, 'compose'>;
}

/**
 * Link de produto de TERCEIRO (ex.: capturado de grupo concorrente) → link de afiliado DO TENANT.
 *
 * Nada da URL de origem sobrevive além do produto: a URL é reconstruída na forma canônica, sem
 * query (some `tag`, `matt_word`, `matt_tool`, `af_*`, `utm_*`…), e só então recebe a marcação do
 * tenant (`TenantAffiliateLinkComposer`). Aqui: expandir → plano → estado da credencial → composer →
 * tradução de erro (recusa da loja pausa a loja). Rede só dentro da allowlist (expansor e leitor de página).
 */
export class BuildTenantAffiliateLinkUseCase {
  constructor(private readonly deps: BuildTenantAffiliateLinkDeps) {}

  async execute(tenantId: string, href: string): Promise<TenantAffiliateLink> {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return { kind: 'unsupported' };
    }
    if (!isSupportedProductUrl(url)) return { kind: 'unsupported' };

    // Plano antes de qualquer rede: o encurtador do marketplace travado (ex.: `onelink`) já é rede dele
    const pasted = detectMarketplace(url);
    if (pasted && marketplaceEntitlementKey(pasted)) {
      const blocked = await this.planBlocked(tenantId, pasted);
      if (blocked) return blocked;
    }

    let final: URL;
    try {
      final = await this.deps.expander.expand(url);
    } catch (err) {
      return this.failure(null, err, 'LINK_EXPAND_FAILED');
    }
    const provider = detectMarketplace(final);
    if (!provider) return { kind: 'unsupported' };

    // Ordem fixa: plano (na URL colada, antes de expandir; de novo aqui se o redirect mudou o marketplace)
    // → credencial → aceite → chamada à loja
    if (provider !== pasted) {
      const blocked = await this.planBlocked(tenantId, provider);
      if (blocked) return blocked;
    }

    let cred: OfferAffiliateCredential;
    try {
      const state = await this.deps.credentials.resolveState(tenantId, provider);
      // Loja pausada: credencial recusada antes, sem rede até o usuário reconfigurar
      if (state.state === 'rejected') return { kind: 'credential_rejected', provider, since: state.since };
      if (state.state === 'missing') return { kind: 'credential_missing', provider };
      cred = state.cred;
    } catch (err) {
      return this.failure(provider, err, 'CREDENTIAL_UNREADABLE');
    }

    try {
      const out = await this.deps.composer.compose({ tenantId, provider, final, cred });
      if (out.kind !== 'ok') return out;
      const { productRef: _ref, ...link } = out;
      return link;
    } catch (err) {
      // Loja recusou agora (401/403): pausa a loja; rate limit e indisponibilidade NÃO pausam
      if (err instanceof AppError && err.code === 'AFFILIATE_CREDENTIAL_REJECTED') {
        await this.deps.credentials.markRejected(tenantId, provider, err.code);
        logger.warn({ code: err.code, provider }, 'tenant affiliate credential rejected');
        return { kind: 'credential_rejected', provider, since: new Date() };
      }
      return this.failure(provider, err, 'AFFILIATE_LINK_FAILED');
    }
  }

  /** `plan_unavailable`/`failed` quando o plano trava o marketplace; null = liberado. */
  private async planBlocked(tenantId: string, provider: AffiliateProvider): Promise<TenantAffiliateLink | null> {
    try {
      return (await isMarketplaceEnabled(this.deps.entitlements, tenantId, provider)) ? null : { kind: 'plan_unavailable', provider };
    } catch (err) {
      return this.failure(provider, err, 'ENTITLEMENT_UNREADABLE');
    }
  }

  private failure(provider: AffiliateProvider | null, err: unknown, fallback: string): TenantAffiliateLink {
    if (!(err instanceof AppError)) throw err;
    // Sem URL nem corpo no log (link de terceiro e resposta da API)
    logger.warn({ code: err.code, provider }, 'tenant affiliate link not built');
    return { kind: 'failed', provider, code: err.code || fallback };
  }
}

