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
type PresetDb = Pick<TransactionClient, 'planEntitlementPreset' | 'tenantEntitlement'>;

const SHARED: readonly string[] = SHARED_KEYS;

/** Valor de preset vindo do banco (Json): número, booleano, `null` ou texto numérico. Outro = ignorado. */
function presetValue(value: unknown): PlanPresetValue | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/**
 * Único ponto que grava o preset do plano (lido do banco, onde o admin edita) em `tenant_entitlements`,
 * pulando `excludeKeys`. Sem efeitos de troca de plano (`syncPlanEntitlements` os roda depois). Devolve
 * quantas linhas o preset tem (antes do filtro).
 */
export async function writePlanPreset(
  db: PresetDb,
  tenantId: string,
  planSlug: string,
  excludeKeys: readonly string[] = [],
): Promise<number> {
  const presets = await db.planEntitlementPreset.findMany({ where: { planSlug } });
  const exclude = new Set(excludeKeys);
  for (const p of presets) {
    if (exclude.has(p.key)) continue;
    const value = entitlementJsonValue(p.value);
    await db.tenantEntitlement.upsert({
      where: { tenantId_key: { tenantId, key: p.key } },
      create: { tenantId, key: p.key, value },
      update: { value },
    });
  }
  return presets.length;
}

/** Preset do plano sem as chaves compartilhadas: essas só o merge escreve (PROD-18). */
export function writePlanPresetWithoutSharedKeys(db: PresetDb, tenantId: string, planSlug: string): Promise<number> {
  return writePlanPreset(db, tenantId, planSlug, SHARED);
}

async function sharedPresetOf(db: PresetDb, planSlug: string): Promise<Record<string, PlanPresetValue>> {
  const rows = await db.planEntitlementPreset.findMany({ where: { planSlug, key: { in: [...SHARED] } } });
  const out: Record<string, PlanPresetValue> = {};
  for (const r of rows) {
    const v = presetValue(r.value);
    if (v !== undefined) out[r.key] = v;
  }
  return out;
}

/**
 * Único ponto que grava as chaves compartilhadas (`whatsapp_sessions`, `telegram_sessions`): união
 * (`mergeSharedEntitlements`: maior vence, `null` vence) dos presets dos produtos com acesso. Usado pelo
 * admin, pela propagação de preset, pelo webhook e pela reconciliação.
 * - Plano de Afiliados: sempre `Tenant.planSlug` (fonte única do plano de Afiliados; a linha só guarda status).
 *   Afiliados ativo sem plano (legado ilimitado) = não grava nada.
 * - Produto novo ativo sem plano = fora da união. Nenhum produto com acesso = não grava.
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
    const slug = product === 'AFFILIATES' ? tenant.planSlug : (row?.planSlug ?? null);
    if (slug === null && product !== 'AFFILIATES') continue;
    plans.push(slug);
  }
  if (plans.length === 0) return;
  const presets: (Record<string, PlanPresetValue> | null)[] = [];
  for (const slug of plans) presets.push(slug === null ? null : await sharedPresetOf(db, slug));
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
