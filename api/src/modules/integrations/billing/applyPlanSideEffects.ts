import type { PrismaClient } from '@prisma/client';
import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import type { ApplyPlanLimitsResult } from '../../link-rotation/application/use-cases/ApplyPlanLimitsToLinkRotationsUseCase';
import { applyLinkRotationPlanLimits } from '../../link-rotation/infrastructure/linkRotationPlanLimits';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { ApplyPlanToStorefrontUseCase } from '../../storefront/application/use-cases/ApplyPlanToStorefrontUseCase';
import { PrismaStorefrontRepository } from '../../storefront/infrastructure/repositories/PrismaStorefrontRepository';
import type { StorefrontStatus } from '../../storefront/domain/enums/StorefrontEnums';

export interface PlanSideEffectsResult {
  linkRotations: ApplyPlanLimitsResult;
  /** Status gravado na página, ou null quando o tenant não tem página. */
  storefront: StorefrontStatus | null;
}

/**
 * Efeitos de troca de plano, rodados no mesmo client/tx que acabou de gravar os entitlements:
 * rodízio de links (LROT-14) e Página de Ofertas (STORE-02). Sequencial: tx interativa não paraleliza.
 */
export async function applyPlanSideEffects(
  client: PrismaClient | TransactionClient,
  tenantId: string,
): Promise<PlanSideEffectsResult> {
  const linkRotations = await applyLinkRotationPlanLimits(client, tenantId);
  const storefront = await new ApplyPlanToStorefrontUseCase(
    new PrismaStorefrontRepository(client),
    new PrismaEntitlementReader(client),
  ).execute(tenantId);
  return { linkRotations, storefront };
}
