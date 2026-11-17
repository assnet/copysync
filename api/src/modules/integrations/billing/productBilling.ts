import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import { createTenantProductRepository } from '../../tenants/infrastructure/productAccessContainer';
import type { PlanPresetValue } from '../../tenants/domain/planPresets';
import { mergeSharedEntitlements, SHARED_KEYS } from '../../tenants/domain/sharedEntitlements';
import { ACCESS_FOLLOWS, PRODUCTS, resolveProductAccess, type ProductKey } from '../../tenants/domain/services/resolveProductAccess';
import { entitlementJsonValue } from './entitlementJsonValue';
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

/** Valor de preset vindo do banco (Json): número, `null` ou texto numérico. */
function presetValue(value: unknown): PlanPresetValue | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

async function presetRecord(tx: TransactionClient, planSlug: string): Promise<Record<string, PlanPresetValue>> {
  const rows = await tx.planEntitlementPreset.findMany({ where: { planSlug, key: { in: [...SHARED_KEYS] } } });
  const out: Record<string, PlanPresetValue> = {};
  for (const r of rows) {
    const v = presetValue(r.value);
    if (v !== undefined) out[r.key] = v;
  }
  return out;
}

/**
 * Chaves compartilhadas (`whatsapp_sessions`, `telegram_sessions`) = união dos presets dos produtos ativos
 * (maior vence, `null` vence). Afiliados ativo sem `Tenant.planSlug` (legado sem limites) = não grava nada.
 */
export async function mergeProductSharedEntitlements(tx: TransactionClient, tenantId: string): Promise<void> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { planSlug: true } });
  const rows = new Map((await createTenantProductRepository(tx).findAll(tenantId)).map((r) => [r.product, r]));
  const presets: Array<Record<string, PlanPresetValue> | null> = [];
  for (const product of PRODUCTS) {
    if (ACCESS_FOLLOWS[product]) continue;
    const row = rows.get(product) ?? null;
    if (!resolveProductAccess(product, row)) continue;
    const slug = product === 'AFFILIATES' ? (tenant?.planSlug ?? null) : (row?.planSlug ?? null);
    if (slug === null) {
      if (product === 'AFFILIATES') presets.push(null);
      continue;
    }
    presets.push(await presetRecord(tx, slug));
  }
  if (presets.length === 0) return;
  const merged = mergeSharedEntitlements(presets);
  if (!merged) return;
  for (const [key, value] of Object.entries(merged)) {
    await tx.tenantEntitlement.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: entitlementJsonValue(value) },
      update: { value: entitlementJsonValue(value) },
    });
  }
}
