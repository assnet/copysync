import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UnitOfWork } from '../../../../shared/database/UnitOfWork';
import { entitlementJsonValue } from '../../../integrations/billing/entitlementJsonValue';
import { PrismaPlanEntitlementPresetRepository } from './PrismaPlanEntitlementPresetRepository';

const repo = new PrismaPlanEntitlementPresetRepository();
const KEY = `int_preset_${Date.now()}`;
const tag = `int-preset-${Date.now()}`;
const ids: Record<'pro1' | 'pro2' | 'lite' | 'none', string> = { pro1: '', pro2: '', lite: '', none: '' };

async function ent(tenantId: string) {
  const row = await prisma.tenantEntitlement.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  return row ? row.value : undefined;
}

beforeAll(async () => {
  const mk = (n: string, planSlug: string | null) => prisma.tenant.create({ data: { name: n, slug: `${tag}-${n}`, planSlug } });
  ids.pro1 = (await mk('pro1', 'COPYSYNC_PRO')).id;
  ids.pro2 = (await mk('pro2', 'COPYSYNC_PRO')).id;
  ids.lite = (await mk('lite', 'COPYSYNC_LITE')).id;
  ids.none = (await mk('none', null)).id;
  // pro1 já tem a chave: setForPlan deve atualizar; pro2 não tem: deve criar
  await prisma.tenantEntitlement.create({ data: { tenantId: ids.pro1, key: KEY, value: false } });
  await prisma.planEntitlementPreset.createMany({
    data: [
      { planSlug: 'COPYSYNC_PRO', key: KEY, value: false },
      { planSlug: 'COPYSYNC_LITE', key: KEY, value: 7 },
      { planSlug: 'COPYSYNC_MAX', key: KEY, value: entitlementJsonValue(null) },
    ],
  });
});

afterAll(async () => {
  await prisma.planEntitlementPreset.deleteMany({ where: { key: KEY } });
  await prisma.tenant.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

describe('PrismaPlanEntitlementPresetRepository', () => {
  it('listByKeys devolve boolean/number/null de domínio e ignora outras chaves', async () => {
    expect(await repo.listByKeys([])).toEqual([]);
    expect(await repo.listByKeys([KEY])).toEqual([
      { planSlug: 'COPYSYNC_LITE', key: KEY, value: 7 },
      { planSlug: 'COPYSYNC_MAX', key: KEY, value: null },
      { planSlug: 'COPYSYNC_PRO', key: KEY, value: false },
    ]);
  });

  it('setForPlan grava o preset e propaga para todos os tenants do plano (só eles)', async () => {
    expect(await repo.setForPlan({ planSlug: 'COPYSYNC_PRO', key: KEY, value: true })).toEqual({ tenantsUpdated: expect.any(Number) });
    expect((await repo.listByKeys([KEY])).find((r) => r.planSlug === 'COPYSYNC_PRO')?.value).toBe(true);
    expect(await ent(ids.pro1)).toBe(true);
    expect(await ent(ids.pro2)).toBe(true);
    expect(await ent(ids.lite)).toBeUndefined();
    expect(await ent(ids.none)).toBeUndefined();
    // reexecução é idempotente (sem duplicar linha)
    await repo.setForPlan({ planSlug: 'COPYSYNC_PRO', key: KEY, value: true });
    expect(await prisma.tenantEntitlement.count({ where: { key: KEY, tenantId: { in: [ids.pro1, ids.pro2] } } })).toBe(2);
  });

  it('setForPlan cria o preset ausente e roda dentro da transação do chamador (rollback desfaz tudo)', async () => {
    await prisma.planEntitlementPreset.deleteMany({ where: { key: KEY, planSlug: 'COPYSYNC_LITE' } });
    await expect(
      new UnitOfWork().runInTransaction(async (tx) => {
        await new PrismaPlanEntitlementPresetRepository(tx).setForPlan({ planSlug: 'COPYSYNC_LITE', key: KEY, value: true });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await repo.listByKeys([KEY])).some((r) => r.planSlug === 'COPYSYNC_LITE')).toBe(false);
    expect(await ent(ids.lite)).toBeUndefined();

    await repo.setForPlan({ planSlug: 'COPYSYNC_LITE', key: KEY, value: false });
    expect((await repo.listByKeys([KEY])).find((r) => r.planSlug === 'COPYSYNC_LITE')?.value).toBe(false);
    expect(await ent(ids.lite)).toBe(false);
  });
});
