import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../shared/database/prisma.client';
import { entitlementJsonValue } from '../../integrations/billing/entitlementJsonValue';
import { SetTenantProductUseCase } from '../application/use-cases/SetTenantProductUseCase';
import { PrismaPlanEntitlementPresetRepository } from './repositories/PrismaPlanEntitlementPresetRepository';
import { prismaTenantProductTransaction } from './tenantProductTransaction';

/*
 * Concessão de produto pelo admin + propagação de preset de plano de produto novo (docs/acesso-por-produto.md):
 * preset Saver chega ao tenant só-Saver por `tenant_products.planSlug`; chave compartilhada só pelo merge.
 */
const tag = `int-tp-${Date.now()}`;
const KEY = `int_tp_key_${Date.now()}`;
const ids = { saverOnly: '', legacyUnlimited: '', both: '' };
let admin = '';
const uc = new SetTenantProductUseCase({
  transaction: prismaTenantProductTransaction,
  reader: { invalidate: () => {} },
  gateMode: () => 'enforce',
  warn: () => {},
});
const ent = async (tenantId: string, key: string) =>
  (await prisma.tenantEntitlement.findUnique({ where: { tenantId_key: { tenantId, key } } }))?.value;

beforeAll(async () => {
  admin = (await prisma.user.create({ data: { email: `${tag}@exemplo.test`, name: 'Admin' } })).id;
  const mk = async (n: string, planSlug: string | null) => (await prisma.tenant.create({ data: { name: n, slug: `${tag}-${n}`, planSlug } })).id;
  ids.saverOnly = await mk('saver', null);
  ids.legacyUnlimited = await mk('legacy', null);
  ids.both = await mk('both', 'COPYSYNC_PRO');
  await prisma.planEntitlementPreset.deleteMany({ where: { planSlug: { in: ['SAVER_PRO', 'COPYSYNC_PRO'] }, key: { in: ['whatsapp_sessions', 'telegram_sessions', KEY] } } });
  await prisma.planEntitlementPreset.createMany({
    data: [
      { planSlug: 'SAVER_PRO', key: 'whatsapp_sessions', value: 1 },
      { planSlug: 'SAVER_PRO', key: 'telegram_sessions', value: 0 },
      { planSlug: 'SAVER_PRO', key: KEY, value: 5 },
      { planSlug: 'COPYSYNC_PRO', key: 'whatsapp_sessions', value: 3 },
      { planSlug: 'COPYSYNC_PRO', key: 'telegram_sessions', value: entitlementJsonValue(null) },
    ],
  });
  // tenant legado ilimitado (sem plano, sem chaves) que hoje não tem limite de sessões
  await prisma.tenantProduct.create({ data: { tenantId: ids.saverOnly, product: 'AFFILIATES', status: 'INACTIVE', source: 'ADMIN' } });
});

afterAll(async () => {
  await prisma.planEntitlementPreset.deleteMany({ where: { planSlug: { in: ['SAVER_PRO', 'COPYSYNC_PRO'] }, key: { in: ['whatsapp_sessions', 'telegram_sessions', KEY] } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: Object.values(ids) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.user.deleteMany({ where: { id: admin } });
  await prisma.$disconnect();
});

describe('SetTenantProductUseCase + propagação de preset (Postgres)', () => {
  it('só-Saver: linha ADMIN, preset sem compartilhadas + merge, auditoria', async () => {
    await uc.execute({ tenantId: ids.saverOnly, product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', actorUserId: admin });
    const row = await prisma.tenantProduct.findUnique({ where: { tenantId_product: { tenantId: ids.saverOnly, product: 'SAVER' } } });
    expect(row).toMatchObject({ status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'ADMIN' });
    expect(await ent(ids.saverOnly, KEY)).toBe(5);
    expect(await ent(ids.saverOnly, 'whatsapp_sessions')).toBe(1);
    expect(await ent(ids.saverOnly, 'telegram_sessions')).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: ids.saverOnly, action: 'TENANT_PRODUCT_CHANGED' } })).toBe(1);
  });

  it('legado ilimitado que soma Saver não ganha limite de sessões', async () => {
    await uc.execute({ tenantId: ids.legacyUnlimited, product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', actorUserId: admin });
    expect(await ent(ids.legacyUnlimited, 'whatsapp_sessions')).toBeUndefined();
    expect(await ent(ids.legacyUnlimited, 'telegram_sessions')).toBeUndefined();
    expect(await ent(ids.legacyUnlimited, KEY)).toBe(5);
  });

  it('Afiliados PRO + Saver: maior vence, null vence tudo', async () => {
    await uc.execute({ tenantId: ids.both, product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', actorUserId: admin });
    expect(await ent(ids.both, 'whatsapp_sessions')).toBe(3);
    expect(await ent(ids.both, 'telegram_sessions')).toBeNull();
  });

  it('preset Saver alterado no admin chega ao tenant só-Saver; compartilhada só pelo merge', async () => {
    const repo = new PrismaPlanEntitlementPresetRepository();
    const out = await repo.setForPlan({ planSlug: 'SAVER_PRO', key: KEY, value: 9 });
    expect(out.tenantsUpdated).toBe(3);
    expect(await ent(ids.saverOnly, KEY)).toBe(9);
    await repo.setForPlan({ planSlug: 'SAVER_PRO', key: 'whatsapp_sessions', value: 4 });
    expect(await ent(ids.saverOnly, 'whatsapp_sessions')).toBe(4);
    expect(await ent(ids.both, 'whatsapp_sessions')).toBe(4);
    expect(await ent(ids.legacyUnlimited, 'whatsapp_sessions')).toBeUndefined();
  });

  it('desligar Saver refaz o merge pelo produto que sobrou', async () => {
    await uc.execute({ tenantId: ids.both, product: 'SAVER', status: 'INACTIVE', actorUserId: admin });
    expect(await ent(ids.both, 'whatsapp_sessions')).toBe(3);
    const repo = new PrismaPlanEntitlementPresetRepository();
    expect((await repo.setForPlan({ planSlug: 'SAVER_PRO', key: KEY, value: 1 })).tenantsUpdated).toBe(2);
  });
});
