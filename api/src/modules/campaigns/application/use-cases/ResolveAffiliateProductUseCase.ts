import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { ISheinAffiliateClient } from '../../domain/contracts/ISheinAffiliateClient';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../domain/contracts/IMarketplaceRiskGate';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IAffiliateCredentialGateway } from '../../domain/contracts/IAffiliateCredentialGateway';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { TenantAffiliateLinkComposer } from '../services/TenantAffiliateLinkComposer';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { currentRiskNoticeVersion, requiresRiskAcceptance } from '../../../integrations/domain/services/marketplaceRiskNotice';
import { requireMarketplaceEnabled } from '../services/requireMarketplaceEnabled';
import { marketplaceEntitlementKey } from '../../domain/services/marketplaceEntitlement';
import { isSupportedShareLink } from '../../domain/services/isSupportedShareLink';
import { shouldKeepPastedLink } from '../../domain/services/shouldKeepPastedLink';
import { ownershipIdentifiersOf, verifyAffiliateLink } from '../../domain/services/verifyAffiliateLink';
import { effectiveLinkedIdentifiers } from '../../../integrations/domain/services/effectiveLinkedIdentifiers';
import { identifierLimitOf } from '../../../tenants/domain/services/affiliateIdentifierLimit';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import {
  AffiliateCredentialRejectedError,
  AffiliateCredentialRequiredError,
  OfferLinkRebuildFailedError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { MarketplaceRiskNotAcceptedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';
import { AffiliateIdentifierNotLinkedError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { EMPTY_PRODUCT_DATA, type ProductData, type ResolveProductDataUseCase } from './ResolveProductDataUseCase';

export interface ResolveAffiliateProductDeps {
  expander: IShortLinkExpander;
  /**
   * Só `resolveState`: credencial ausente ou recusada bloqueia sem chamar a loja.
   * Sem `markRejected` de propósito: quem pausa a loja é só o builder do monitoramento.
   */
  credentials: Pick<IAffiliateCredentialGateway, 'resolveState'>;
  /** Núcleo do link do tenant (o mesmo do monitoramento). */
  composer: Pick<TenantAffiliateLinkComposer, 'compose'>;
  products: ResolveProductDataUseCase;
  /** Shein: dados do produto quando o link curto do tenant é mantido. */
  shein: ISheinAffiliateClient;
  /** Gate de plano por marketplace (`requireMarketplaceEnabled`). Obrigatório: opcional seria contornável. */
  entitlements: IEntitlementReader;
  /** Aceite do aviso de risco; só consultado com credencial e para provider com aviso. */
  riskGate: IMarketplaceRiskGate;
}

export interface ResolvedAffiliateProduct {
  provider: AffiliateProvider;
  /** URL colada, normalizada (nunca a canônica usada para recriar). */
  sourceUrl: string;
  /** Link que vai na oferta: sempre do tenant (o curto colado já dele, ou o recriado). */
  affiliateUrl: string;
  /** Sempre `true` (o link é do tenant); campo mantido para legado e auditoria. */
  attributionVerified: boolean;
  /** `true` quando o link foi recriado com a credencial do tenant (aviso no painel). */
  linkRebuilt: boolean;
  /** Dados do produto; a foto vem só como URL externa (`imageSourceUrl`), sem baixar. */
  product: ProductData;
}

/**
 * Link colado → marketplace, link de afiliado DO TENANT e dados do produto (melhor esforço). Não
 * baixa nem grava imagem: quem chama decide o store. Mantém o colado só se for link curto oficial
 * já do tenant (`shouldKeepPastedLink`); senão recria pelo `TenantAffiliateLinkComposer`. Lança
 * antes de qualquer gravação: URL fora da allowlist, produto não reconhecido, loja sem credencial
 * utilizável, aceite de risco, etiqueta da conta não vinculada, falha ao recriar.
 */
export class ResolveAffiliateProductUseCase {
  constructor(private readonly deps: ResolveAffiliateProductDeps) {}

  async execute(tenantId: string, rawUrl: string): Promise<ResolvedAffiliateProduct> {
    // 1. URL: allowlist antes de qualquer requisição; expande e revalida
    const source = parseUrl(rawUrl);
    if (!isSupportedProductUrl(source)) throw new OfferUrlUnsupportedError();
    // Marketplace fora do plano: antes de qualquer rede (o encurtador do marketplace travado já é rede dele)
    const pasted = detectMarketplace(source);
    if (pasted && marketplaceEntitlementKey(pasted)) await requireMarketplaceEnabled(this.deps.entitlements, tenantId, pasted);
    const final = await this.deps.expander.expand(source);
    const provider = detectMarketplace(final);
    if (!provider) throw new OfferUrlUnsupportedError();
    // De novo após o redirect: pode cair em outro marketplace; antes de ler credencial ou chamar a loja
    if (provider !== pasted) await requireMarketplaceEnabled(this.deps.entitlements, tenantId, provider);
    const ref = parseProductRef(provider, final);
    const mlSocial = provider === 'MERCADO_LIVRE' && final.pathname.startsWith('/social/');
    // Antes da credencial: cupom/lista sem produto segue "não suportado" mesmo sem loja conectada
    if (!ref && !mlSocial) throw new OfferUrlUnsupportedError('Product not recognized');

    // 2. Credencial utilizável é obrigatória (D1); recusa registrada não chama a loja
    const state = await this.deps.credentials.resolveState(tenantId, provider);
    if (state.state === 'missing') throw new AffiliateCredentialRequiredError(provider);
    if (state.state === 'rejected') throw new AffiliateCredentialRejectedError(provider);
    const cred = state.cred;

    // 3. Aceite do aviso de risco
    if (requiresRiskAcceptance(provider) && !(await this.deps.riskGate.isAccepted(tenantId, provider))) {
      throw new MarketplaceRiskNotAcceptedError(provider, currentRiskNoticeVersion(provider) ?? '');
    }

    // 4. Etiqueta da própria conta ML ainda não vinculada: bloqueia (não recria com a principal)
    const owned = await this.ownedIdentifiers(tenantId, provider, cred);
    const urls = final === source ? [final] : [source, final];
    const check = verifyAffiliateLink(provider, urls, owned.identifiers);
    if (check === 'not_owned') this.rejectUnlinkedAccountIdentifier(provider, urls, cred, owned);

    // 5. Link curto oficial já do tenant: fica, dados pelo caminho de sempre
    const sourceUrl = source.toString();
    if (shouldKeepPastedLink(provider, source, final, owned.identifiers)) {
      const product = ref?.provider === 'SHEIN'
        ? await this.sheinProductData(ref, cred)
        : await this.deps.products.resolve(provider, ref, final, cred);
      return { provider, sourceUrl, affiliateUrl: sourceUrl, attributionVerified: true, linkRebuilt: false, product };
    }

    // 6. Recria com a credencial do tenant (ML: etiqueta vinculada do link, senão a principal)
    const mlTag = check === 'verified' ? this.linkedMlTag(provider, urls, cred, owned.identifiers) : undefined;
    const composed = await this.deps.composer.compose({ tenantId, provider, final, cred, ...(mlTag ? { mlTag } : {}) });
    switch (composed.kind) {
      case 'unsupported':
        throw new OfferUrlUnsupportedError('Product not recognized');
      case 'credential_missing':
        throw new AffiliateCredentialRequiredError(provider);
      case 'risk_not_accepted':
        throw new MarketplaceRiskNotAcceptedError(provider, currentRiskNoticeVersion(provider) ?? '');
      case 'failed':
        throw new OfferLinkRebuildFailedError(provider, composed.code);
      case 'ok':
        break;
    }
    // Shopee e ML não revalidam no composer (monitoramento intocado): a allowlist vale aqui para os 4
    if (!isSupportedShareLink(composed.affiliateUrl)) throw new OfferLinkRebuildFailedError(provider, 'NOT_ALLOWED');

    // 7. Produto: o que o composer já trouxe (vitrine social com card, Shein); senão o caminho de sempre
    const product: ProductData = composed.product
      ? {
          productRef: composed.productRef,
          title: composed.product.title,
          priceCents: composed.product.priceCents,
          originalPriceCents: composed.product.originalPriceCents,
          imageSourceUrl: composed.product.imageUrl,
        }
      : { ...(await this.deps.products.resolve(provider, ref, final, cred)), productRef: composed.productRef };
    return { provider, sourceUrl, affiliateUrl: composed.affiliateUrl, attributionVerified: true, linkRebuilt: true, product };
  }

  /**
   * Shein com link do tenant mantido: a página cai em desafio anti-bot, então os dados vêm só da API
   * de afiliados (1 chamada). Sem `AT`: produto vazio (preenchimento manual). O link devolvido pela
   * API é ignorado aqui.
   */
  private async sheinProductData(
    ref: Extract<ProductRef, { provider: 'SHEIN' }>,
    cred: OfferAffiliateCredential,
  ): Promise<ProductData> {
    const empty: ProductData = { ...EMPTY_PRODUCT_DATA, productRef: ref.goodsId };
    const token = cred.session?.cookies?.AT;
    if (!token) return empty;
    const share = await this.deps.shein.getProductShare({ token, memberId: cred.publicIdentifier }, ref.goodsId);
    if (!share) return empty;
    return {
      productRef: ref.goodsId,
      title: share.title,
      priceCents: share.priceCents,
      originalPriceCents: share.originalPriceCents,
      imageSourceUrl: share.imageUrl,
    };
  }

  /**
   * Identificadores que provam o dono. ML: principal + vinculadas sob o limite do plano
   * (`mercado_livre_affiliate_tags`; rebaixado ignora o excedente sem apagar). Demais: só a principal.
   */
  private async ownedIdentifiers(
    tenantId: string,
    provider: AffiliateProvider,
    cred: OfferAffiliateCredential,
  ): Promise<{ identifiers: string[]; limit: number }> {
    if (provider !== 'MERCADO_LIVRE') return { identifiers: [cred.publicIdentifier], limit: 1 };
    const limit = identifierLimitOf(
      await this.deps.entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS),
    );
    return { identifiers: effectiveLinkedIdentifiers(cred.publicIdentifier, cred.linkedIdentifiers ?? [], limit), limit };
  }

  /**
   * ML com link `verified` por etiqueta vinculada que não é a principal: recria com ela (o ML aceita
   * qualquer etiqueta da conta, `docs/extensao-ml-endpoints.md` §4). Principal ou outro provider: nada.
   */
  private linkedMlTag(
    provider: AffiliateProvider,
    urls: readonly URL[],
    cred: OfferAffiliateCredential,
    identifiers: readonly string[],
  ): string | undefined {
    if (provider !== 'MERCADO_LIVRE') return undefined;
    const tag = ownershipIdentifiersOf(provider, urls)[0]?.trim().toLowerCase();
    if (!tag || tag === cred.publicIdentifier.trim().toLowerCase()) return undefined;
    return identifiers.find((v) => v.trim().toLowerCase() === tag);
  }

  /**
   * `not_owned` com etiqueta da própria conta (ainda não vinculada): com vaga no plano pede para vincular;
   * sem vaga, limite do plano. Etiqueta de terceiro segue e o link é recriado com a do tenant.
   */
  private rejectUnlinkedAccountIdentifier(
    provider: AffiliateProvider,
    urls: readonly URL[],
    cred: OfferAffiliateCredential,
    owned: { identifiers: string[]; limit: number },
  ): void {
    if (provider !== 'MERCADO_LIVRE' || !cred.accountIdentifiers?.length) return;
    const found = new Set(ownershipIdentifiersOf(provider, urls).map((v) => v.trim().toLowerCase()));
    if (found.size !== 1) return;
    const [tag] = [...found];
    if (!cred.accountIdentifiers.some((v) => v.trim().toLowerCase() === tag)) return;
    const used = owned.identifiers.length;
    if (used < owned.limit) throw new AffiliateIdentifierNotLinkedError(provider, owned.limit, used);
    throw new PlanLimitReachedError(ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, owned.limit);
  }
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw.trim());
  } catch {
    throw new OfferUrlUnsupportedError();
  }
}
