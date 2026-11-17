import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { PrismaUsageTenantDirectory, USAGE_TENANT_LIST_SQL } from './PrismaUsageTenantDirectory';
import { ProcessUsageReadGate, createReadBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

/** Diretório de contas das métricas de uso: planos por família pela regra de acesso de `tenants`. */
const directory = new PrismaUsageTenantDirectory(prisma);
const s = `umd${Date.now().toString(36)}`;
const T = {
  internal: `${s}-internal`,
  legacy: `${s}-legacy`,
  saverOnly: `${s}-saveronly`,
  cancelled: `${s}-cancelled`,
  saverOff: `${s}-saveroff`,
};
const run = (sql: string) => prisma.$executeRawUnsafe(sql);
let n = 0;
const tenant = (id: string, planSlug: string | null, status = 'ACTIVE') =>
  run(`INSERT INTO tenants (id, name, slug, "planSlug", status, "updatedAt")
    VALUES ('${id}', 'Nome ${id}', '${id}', ${planSlug ? `'${planSlug}'` : 'NULL'}, '${status}', now())`);
const product = (tenantId: string, product: string, status: string, planSlug: string | null) =>
  run(`INSERT INTO tenant_products (id, "tenantId", product, status, "planSlug", source, "updatedAt")
    VALUES ('${s}-p${n++}', '${tenantId}', '${product}', '${status}', ${planSlug ? `'${planSlug}'` : 'NULL'}, 'ADMIN', now())`);

beforeAll(async () => {
  await tenant(T.internal, 'COPYSYNC_PRO');
  await run(`INSERT INTO users (id, email, name, "isSuperAdmin", "updatedAt") VALUES ('${s}-sa', '${s}-sa@x.test', 'x', true, now())`);
  await run(`INSERT INTO user_tenants (id, "userId", "tenantId", "updatedAt") VALUES ('${s}-ut', '${s}-sa', '${T.internal}', now())`);
  await tenant(T.legacy, 'COPYSYNC_MAX'); // sem linha em tenant_products: Afiliados legado ativo, Saver não
  await tenant(T.saverOnly, null);
  await product(T.saverOnly, 'SAVER', 'ACTIVE', 'SAVER_PRO');
  await tenant(T.cancelled, 'COPYSYNC_LITE', 'CANCELLED'); // planSlug sobrevive ao cancelamento
  await product(T.cancelled, 'AFFILIATES', 'INACTIVE', 'COPYSYNC_LITE');
  await tenant(T.saverOff, 'COPYSYNC_PRO');
  await product(T.saverOff, 'AFFILIATES', 'ACTIVE', 'COPYSYNC_PRO');
  await product(T.saverOff, 'SAVER', 'INACTIVE', 'SAVER_MAX');
});

afterAll(async () => {
  await run(`DELETE FROM tenant_products WHERE id LIKE '${s}-%'`);
  await run(`DELETE FROM user_tenants WHERE id LIKE '${s}-%'`);
  await run(`DELETE FROM users WHERE id LIKE '${s}-%'`);
  await run(`DELETE FROM tenants WHERE id LIKE '${s}-%'`);
  await prisma.$disconnect();
});

describe('PrismaUsageTenantDirectory', () => {
  it('resolve o plano de cada família pela regra de acesso, sem devolver nome', async () => {
    const list = (await directory.list(createReadBudget())).filter((e) => e.tenantId.startsWith(s));
    const by = new Map(list.map((e) => [e.tenantId, e]));
    expect(by.get(T.internal)).toMatchObject({ internal: true, affiliatesPlan: 'COPYSYNC_PRO', saverPlan: 'NONE', status: 'ACTIVE' });
    expect(by.get(T.legacy)).toMatchObject({ internal: false, affiliatesPlan: 'COPYSYNC_MAX', saverPlan: 'NONE' });
    expect(by.get(T.saverOnly)).toMatchObject({ affiliatesPlan: 'NONE', saverPlan: 'SAVER_PRO' });
    expect(by.get(T.cancelled)).toMatchObject({ affiliatesPlan: 'NONE', saverPlan: 'NONE', status: 'CANCELLED' });
    expect(by.get(T.saverOff)).toMatchObject({ affiliatesPlan: 'COPYSYNC_PRO', saverPlan: 'NONE' });
    expect(by.get(T.legacy)!.createdAt).toBeInstanceOf(Date);
    for (const e of list) expect(Object.keys(e).sort()).toEqual(['affiliatesPlan', 'createdAt', 'internal', 'saverPlan', 'status', 'tenantId']);
    expect(USAGE_TENANT_LIST_SQL.sql).not.toMatch(/"name"|\bname\b/);
  });

  it('names devolve o nome só dos ids pedidos; [] não consulta o banco', async () => {
    const spy = vi.spyOn(prisma, '$transaction');
    expect((await directory.names([], createReadBudget())).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    const names = await directory.names([T.legacy, T.saverOnly], createReadBudget());
    expect(names).toEqual(new Map([[T.legacy, `Nome ${T.legacy}`], [T.saverOnly, `Nome ${T.saverOnly}`]]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('orçamento gasto lança sem ir ao banco; o statement_timeout é o restante', async () => {
    const clock = { now: 0 };
    const budget = createReadBudget(2000, () => clock.now);
    clock.now = 2000;
    const tx = vi.spyOn(prisma, '$transaction');
    await expect(directory.list(budget)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    await expect(directory.names([T.legacy], budget)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    expect(tx).not.toHaveBeenCalled();

    const set = vi.spyOn(prisma, '$executeRawUnsafe');
    const fresh = { now: 0 };
    const b2 = createReadBudget(2000, () => fresh.now);
    fresh.now = 812.6;
    await directory.list(b2);
    expect(set).toHaveBeenCalledWith('SET LOCAL statement_timeout = 1187');
  });

  it('leitura que não resolve lança quando o temporizador vence', async () => {
    const hung = {
      $executeRawUnsafe: () => ({}),
      $queryRaw: () => ({}),
      $transaction: () => new Promise(() => undefined),
    } as unknown as UsageReadPrisma;
    const slow = new PrismaUsageTenantDirectory(hung);
    await expect(slow.list(createReadBudget(30))).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    await expect(slow.names(['x'], createReadBudget(30))).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
  });

  it('roda dentro da vaga aberta pelo pedido, sem abrir vaga própria', async () => {
    const gate = new ProcessUsageReadGate();
    const out = await gate.runExclusive(async (budget) => {
      const list = await directory.list(budget);
      const names = await directory.names([T.legacy], budget);
      await expect(gate.runExclusive(async () => 1)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
      return { list: list.length, names: names.size };
    });
    expect(out.names).toBe(1);
    expect(out.list).toBeGreaterThanOrEqual(5);
  });
});
