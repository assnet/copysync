import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { affiliatesActiveTenantWhere, excludeAffiliatesInactiveSql } from './affiliatesInactiveFilter';

describe('affiliatesInactiveFilter', () => {
  it('fora de enforce não altera a consulta', () => {
    expect(excludeAffiliatesInactiveSql(Prisma.sql`d."tenantId"`, false)).toBe(Prisma.empty);
    expect(affiliatesActiveTenantWhere(false)).toEqual({});
  });

  it('enforce exclui só tenant com linha AFFILIATES não ativa (sem linha = ativo)', () => {
    expect(excludeAffiliatesInactiveSql(Prisma.sql`d."tenantId"`, true).sql)
      .toBe(`AND d."tenantId" NOT IN (SELECT tp."tenantId" FROM "tenant_products" tp WHERE tp."product" = 'AFFILIATES' AND tp."status" <> 'ACTIVE')`);
    expect(affiliatesActiveTenantWhere(true)).toEqual({ tenantProducts: { none: { product: 'AFFILIATES', status: { not: 'ACTIVE' } } } });
  });
});
