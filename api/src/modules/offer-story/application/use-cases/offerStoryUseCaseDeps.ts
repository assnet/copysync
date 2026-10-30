import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IOfferImageFetcher } from '../../../campaigns/domain/contracts/IOfferImageFetcher';
import type { ResolveAffiliateProductUseCase } from '../../../campaigns/application/use-cases/ResolveAffiliateProductUseCase';
import type { IAiTextGenerator } from '../../../assistants/domain/contracts/IAiTextGenerator';
import type { IOfferStoryRenderer } from '../../domain/contracts/IOfferStoryRenderer';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';

/** Dependências dos use cases do story; cada use case usa o subconjunto que precisa. */
export interface OfferStoryUseCaseDeps {
  entitlements: IEntitlementReader;
  /** Link colado → marketplace, dono e produto (mesma regra do gerador e da vitrine). */
  resolveProduct: Pick<ResolveAffiliateProductUseCase, 'execute'>;
  /** Foto do produto em bytes (allowlist de CDN, teto de tamanho); nunca hotlink na arte. */
  imageFetcher: IOfferImageFetcher;
  /** Encurta o título; sempre com fallback para o original. */
  ai: IAiTextGenerator;
  renderer: IOfferStoryRenderer;
  /** Teto da IA antes de cair no título original (ms). Padrão 8 s; injetável para teste. */
  aiTimeoutMs?: number;
}

/** Gate do plano: só `offer_story_enabled === true` libera (ausente/false/inválido bloqueiam). */
export async function requireOfferStoryEnabled(entitlements: IEntitlementReader, tenantId: string): Promise<void> {
  const enabled = await entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_STORY_ENABLED);
  if (enabled !== true) throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_STORY_ENABLED);
}
