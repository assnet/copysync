import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import { createTenantProductRepository } from '../../tenants/infrastructure/productAccessContainer';
import { SHARED_KEYS } from '../../tenants/domain/sharedEntitlements';
import type { ProductKey } from '../../tenants/domain/services/resolveProductAccess';
import { syncPlanEntitlements } from './syncPlanEntitlements';

/**
 * Escritas de cobrança por produto (docs/acesso-por-produto.md), usadas pelo webhook e pela
 * reconciliação dentro da transação de quem chama. O caminho de Afiliados (Tenant.planSlug) não passa aqui.
 */

export interface BillingProductRowWrite {
  product: ProductKey;
  active: boolean;
  planSlug: string | null;
  /** `undefined` = mantém o gravado. */
  expiresAt?: Date | null;
}

/**
 * Grava a linha do produto (origem BILLING). Linha `source=ADMIN` nunca é desativada pela cobrança e
 * mantém a origem quando atualizada (PROD-22). `onlyIfExists` = não cria linha nova. Devolve se gravou.
 */
export async function writeBillingProductRow(
  tx: TransactionClient,
  tenantId: string,
  w: BillingProductRowWrite,
  opts: { onlyIfExists?: boolean } = {},
): Promise<boolean> {
  const repo = createTenantProductRepository(tx);
  const cur = await repo.find(tenantId, w.product);
  if (!cur && opts.onlyIfExists) return false;
  if (cur?.source === 'ADMIN' && !w.active) return false;
  await repo.upsert({
    tenantId,
    product: w.product,
    status: w.active ? 'ACTIVE' : 'INACTIVE',
    planSlug: w.active ? w.planSlug : (cur?.planSlug ?? null),
    expiresAt: w.expiresAt === undefined ? (cur?.expiresAt ?? null) : w.expiresAt,
    source: cur?.source ?? 'BILLING',
  });
  return true;
}

/** Preset do plano de produto novo, sem as chaves compartilhadas (só o merge as escreve, PROD-18). */
export function syncProductPlanEntitlements(tx: TransactionClient, tenantId: string, planSlug: string) {
  return syncPlanEntitlements(tx, tenantId, planSlug, { excludeKeys: SHARED_KEYS });
}
