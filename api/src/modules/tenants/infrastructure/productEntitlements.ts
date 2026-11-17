import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import { entitlementJsonValue } from '../../integrations/billing/entitlementJsonValue';
import type { PlanPresetValue } from '../domain/planPresets';
import { SHARED_KEYS, mergeSharedEntitlements } from '../domain/sharedEntitlements';
import {
  PRODUCTS,
  accessSourceOf,
  resolveProductAccess,
  type ProductKey,
  type TenantProductStatus,
} from '../domain/services/resolveProductAccess';

type Db = Pick<TransactionClient, 'tenant' | 'tenantProduct' | 'planEntitlementPreset' | 'tenantEntitlement'>;

const SHARED: readonly string[] = SHARED_KEYS;

function toPresetValue(raw: unknown): PlanPresetValue {
  return typeof raw === 'boolean' || typeof raw === 'number' ? raw : null;
}

/**
 * Grava em `tenant_entitlements` o preset do plano (lido do banco, onde o admin edita), sem as chaves
 * compartilhadas: essas só o merge escreve (docs/acesso-por-produto.md). Sem efeitos de troca de plano.
 */
export async function writePlanPresetWithoutSharedKeys(db: Db, tenantId: string, planSlug: string): Promise<number> {
  const presets = await db.planEntitlementPreset.findMany({ where: { planSlug, key: { notIn: [...SHARED] } } });
  for (const p of presets) {
    const value = entitlementJsonValue(p.value);
    await db.tenantEntitlement.upsert({
      where: { tenantId_key: { tenantId, key: p.key } },
      create: { tenantId, key: p.key, value },
      update: { value },
    });
  }
  return presets.length;
}

/**
 * União das chaves compartilhadas (`mergeSharedEntitlements`) entre os produtos com acesso do tenant e
 * grava o resultado. Plano de cada produto: linha de `tenant_products`; Afiliados sem plano na linha usa
 * `Tenant.planSlug`. Produto ativo sem plano (legado ilimitado) = não grava nada. Sem produto = não grava.
 */
export async function writeMergedSharedEntitlements(db: Db, tenantId: string): Promise<void> {
  const [tenant, rows] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { planSlug: true } }),
    db.tenantProduct.findMany({ where: { tenantId } }),
  ]);
  if (!tenant) return;
  const byProduct = new Map(rows.map((r) => [r.product as ProductKey, r]));
  const plans: (string | null)[] = [];
  for (const product of PRODUCTS) {
    if (accessSourceOf(product) !== product) continue; // CHAT acompanha AFFILIATES: sem plano próprio
    const row = byProduct.get(product);
    if (!resolveProductAccess(product, row ? { status: row.status as TenantProductStatus } : null)) continue;
    plans.push(row?.planSlug ?? (product === 'AFFILIATES' ? tenant.planSlug : null));
  }
  if (plans.length === 0) return;
  const slugs = plans.filter((p): p is string => p !== null);
  const presetRows = slugs.length
    ? await db.planEntitlementPreset.findMany({ where: { planSlug: { in: slugs }, key: { in: [...SHARED] } } })
    : [];
  const presets = plans.map((slug) => {
    if (slug === null) return null;
    return Object.fromEntries(presetRows.filter((r) => r.planSlug === slug).map((r) => [r.key, toPresetValue(r.value)]));
  });
  const merged = mergeSharedEntitlements(presets);
  if (!merged) return;
  for (const [key, raw] of Object.entries(merged)) {
    const value = entitlementJsonValue(raw ?? null);
    await db.tenantEntitlement.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value },
      update: { value },
    });
  }
}
