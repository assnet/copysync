import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../shared/database/prisma.client';
import { SetPlanEntitlementUseCase } from '../application/use-cases/SetPlanEntitlementUseCase';
import { prismaPlanEntitlementTransaction } from './planEntitlementTransaction';

/* Caminho de escrita real: preset + tenants do plano + AuditLog no mesmo commit (Postgres descartável). */
const KEY = 'marketplace_shein_enabled';
const tag = `int-planent-${Date.now()}`;
const uc = new SetPlanEntitlementUseCase(prismaPlanEntitlementTransaction);
let pro = '';
let lite = '';
let adminId = '';
let presetsBefore: { planSlug: string; value: unknown }[] = [];

const tenantValue = async (tenantId: string) =>
  (await prisma.tenantEntitlement.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } }))?.value;
const presetValue = async (planSlug: string) =>
  (await prisma.planEntitlementPreset.findUnique({ where: { planSlug_key: { planSlug, key: KEY } } }))?.value;
const audits = () => prisma.auditLog.findMany({ where: { action: 'PLAN_ENTITLEMENT_CHANGED', userId: adminId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  presetsBefore = await prisma.planEntitlementPreset.findMany({ where: { key: KEY }, select: { planSlug: true, value: true } });
  pro = (await prisma.tenant.create({ data: { name: 'pro', slug: `${tag}-pro`, planSlug: 'COPYSYNC_PRO' } })).id;
  lite = (await prisma.tenant.create({ data: { name: 'lite', slug: `${tag}-lite`, planSlug: 'COPYSYNC_LITE' } })).id;
  await prisma.tenantEntitlement.create({ data: { tenantId: lite, key: KEY, value: false } });
  adminId = (await prisma.user.create({ data: { email: `${tag}@int.test`, name: 'admin', passwordHash: 'x', isSuperAdmin: true } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: [pro, lite] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [pro, lite] } } });
  await prisma.user.delete({ where: { id: adminId } });
  await prisma.planEntitlementPreset.deleteMany({ where: { key: KEY } });
  if (presetsBefore.length) {
    await prisma.planEntitlementPreset.createMany({ data: presetsBefore.map((p) => ({ planSlug: p.planSlug, key: KEY, value: p.value as boolean })) });
  }
  await prisma.$disconnect();
});

describe('SetPlanEntitlementUseCase + prismaPlanEntitlementTransaction', () => {
  it('liga no PRO: preset, tenants do PRO e AuditLog gravados; LITE intacto', async () => {
    const out = await uc.execute({ planSlug: 'COPYSYNC_PRO', key: KEY, value: true, actorUserId: adminId });
    const proTenants = await prisma.tenant.count({ where: { planSlug: 'COPYSYNC_PRO' } });
    expect(out).toEqual({ planSlug: 'COPYSYNC_PRO', key: KEY, value: true, tenantsUpdated: proTenants });
    expect(await presetValue('COPYSYNC_PRO')).toBe(true);
    expect(await tenantValue(pro)).toBe(true);
    expect(await tenantValue(lite)).toBe(false);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: null, userId: adminId, meta: { planSlug: 'COPYSYNC_PRO', key: KEY, value: true, tenantsUpdated: proTenants } });
  });

  it('falha ao auditar (autor inexistente → FK) desfaz preset e tenants', async () => {
    await expect(uc.execute({ planSlug: 'COPYSYNC_PRO', key: KEY, value: false, actorUserId: 'no-such-user' })).rejects.toThrow();
    expect(await presetValue('COPYSYNC_PRO')).toBe(true);
    expect(await tenantValue(pro)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'PLAN_ENTITLEMENT_CHANGED', userId: 'no-such-user' } })).toBe(0);
  });

  it('desliga: tenants do plano voltam a false e gera segunda auditoria', async () => {
    await uc.execute({ planSlug: 'COPYSYNC_PRO', key: KEY, value: false, actorUserId: adminId });
    expect(await tenantValue(pro)).toBe(false);
    expect(await presetValue('COPYSYNC_PRO')).toBe(false);
    expect((await audits()).map((a) => (a.meta as { value: boolean }).value)).toEqual([true, false]);
  });
});
