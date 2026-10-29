import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IUploadSessionStore } from '../../../media/domain/contracts/IUploadSessionStore';
import type { IOfferImageFetcher } from '../../../campaigns/domain/contracts/IOfferImageFetcher';
import type { ResolveAffiliateProductUseCase } from '../../../campaigns/application/use-cases/ResolveAffiliateProductUseCase';
import type { BuildTenantAffiliateLinkUseCase } from '../../../campaigns/application/use-cases/BuildTenantAffiliateLinkUseCase';
import type { IStorefrontRepository } from '../../domain/contracts/IStorefrontRepository';
import type { IStorefrontOfferRepository } from '../../domain/contracts/IStorefrontOfferRepository';
import type { IStorefrontImageProcessor } from '../../domain/contracts/IStorefrontImageProcessor';
import type { IStorefrontMediaStore } from '../../domain/contracts/IStorefrontMediaStore';
import type { Storefront } from '../../domain/entities/Storefront';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';

/** Upload em partes: só o ciclo de consumo (o painel sobe por `chunkedUpload`). */
export type StorefrontUploadStore = Pick<IUploadSessionStore, 'beginConsume' | 'releaseConsume' | 'discard' | 'binPath'>;

/** Dependências dos use cases da página; cada use case recebe o subconjunto que precisa. */
export interface StorefrontUseCaseDeps {
  storefronts: IStorefrontRepository;
  offers: IStorefrontOfferRepository;
  entitlements: IEntitlementReader;
  images: IStorefrontImageProcessor;
  media: IStorefrontMediaStore;
  uploads: StorefrontUploadStore;
  /** Lê o `.bin` do upload (fs na infra; a camada de aplicação não toca disco). */
  readFile: (path: string) => Promise<Buffer>;
  /** Link colado → marketplace, dono e produto (mesma regra do gerador). */
  resolveProduct: Pick<ResolveAffiliateProductUseCase, 'execute'>;
  /** Shopee: link do tenant pela API com a credencial dele. */
  buildAffiliateLink: Pick<BuildTenantAffiliateLinkUseCase, 'execute'>;
  imageFetcher: IOfferImageFetcher;
  /** Relógio injetável (`publishedAt`). */
  now?: () => Date;
}

/** Gate do plano: só `storefront_enabled === true` libera (ausente/false/inválido bloqueiam). */
export async function requireStorefrontEnabled(entitlements: IEntitlementReader, tenantId: string): Promise<void> {
  const enabled = await entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.STOREFRONT_ENABLED);
  if (enabled !== true) throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.STOREFRONT_ENABLED);
}

/** Página do tenant, ou `STOREFRONT_NOT_FOUND`. */
export async function requireStorefront(storefronts: IStorefrontRepository, tenantId: string): Promise<Storefront> {
  const page = await storefronts.findByTenant(tenantId);
  if (!page) throw new StorefrontNotFoundError();
  return page;
}
