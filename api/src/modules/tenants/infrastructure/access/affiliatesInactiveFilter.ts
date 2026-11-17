import { Prisma } from '@prisma/client';

/**
 * Filtros de fila para tenant com `AFFILIATES` inativo (design §3.5), no mesmo SQL que já exclui o tenant
 * suspenso: o item fica na fila, sem falha e sem reprocessar em laço. Espelha `resolveProductAccess` para
 * produto legado: inativo só com linha e `status <> 'ACTIVE'` (sem linha = ativo). `enforced` falso
 * (modos `off`/`log`) = SQL de sempre, sem consultar `tenant_products`.
 */
export function excludeAffiliatesInactiveSql(tenantIdColumn: Prisma.Sql, enforced: boolean): Prisma.Sql {
  if (!enforced) return Prisma.empty;
  return Prisma.sql`AND ${tenantIdColumn} NOT IN (SELECT tp."tenantId" FROM "tenant_products" tp WHERE tp."product" = 'AFFILIATES' AND tp."status" <> 'ACTIVE')`;
}

/** Mesmo filtro como `where` de `Tenant` no Prisma (vazio fora de `enforce`). */
export function affiliatesActiveTenantWhere(enforced: boolean): Prisma.TenantWhereInput {
  return enforced ? { tenantProducts: { none: { product: 'AFFILIATES', status: { not: 'ACTIVE' } } } } : {};
}
