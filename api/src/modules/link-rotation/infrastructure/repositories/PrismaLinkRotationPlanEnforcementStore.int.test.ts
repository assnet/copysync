import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkRotationPlanEnforcementStore } from './PrismaLinkRotationPlanEnforcementStore';
import { applyLinkRotationPlanLimits } from '../linkRotationPlanLimits';
import { SyncTenantEntitlementsUseCase } from '../../../integrations/billing/SyncTenantEntitlementsUseCase';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

/** LROT-14: limites do plano (inclusive dentro de transação) e sessão removida. */
const stamp = Date.now();
const SMALL = `INT_LR_SMALL_${stamp}`;
const BIG = `INT_LR_BIG_${stamp}`;
let tenantId = '';
let otherTenant = '';
let sessionId = '';
let domainId = '';
let oldRot = '';
let newRot = '';
let otherRot = '';

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int-pl', slug: `int-pl-${stamp}` } })).id;
  otherTenant = (await prisma.tenant.create({ data: { name: 'int-pl2', slug: `int-pl2-${stamp}` } })).id;
  sessionId = (await prisma.session.create({ data: { tenantId, name: 's' } })).id;
  const otherSession = (await prisma.session.create({ data: { tenantId: otherTenant, name: 's' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-pl-${stamp}.test` } })).id;
  const mk = async (t: string, s: string, slug: string, createdAt: Date) =>
    (await prisma.linkRotation.create({ data: { tenantId: t, sessionId: s, domainId, slug, createdAt } })).id;
  oldRot = await mk(tenantId, sessionId, 'velho', new Date('2026-10-01T00:00:00Z'));
  newRot = await mk(tenantId, sessionId, 'novo', new Date('2026-10-05T00:00:00Z'));
  otherRot = await mk(otherTenant, otherSession, 'outro', new Date('2026-09-01T00:00:00Z'));
  for (let i = 0; i < 10; i++) {
    const conv = await prisma.chatConversation.create({ data: { tenantId, sessionId, isGroup: true, groupJid: `pl${stamp}-${i}` } });
    await prisma.linkRotationGroup.create({
      data: { tenantId, rotationId: oldRot, conversationId: conv.id, groupJid: `pl${i}`, position: i, inviteCode: i === 4 ? null : `c${i}` },
    });
  }
  await prisma.planEntitlementPreset.createMany({
    data: [
      { planSlug: SMALL, key: ENTITLEMENT_KEYS.LINK_ROTATIONS, value: 1 },
      { planSlug: SMALL, key: ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS, value: 3 },
      { planSlug: BIG, key: ENTITLEMENT_KEYS.LINK_ROTATIONS, value: 2 },
      { planSlug: BIG, key: ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS, value: 10 },
    ],
  });
});
afterAll(async () => {
  await prisma.linkRotation.deleteMany({ where: { domainId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.planEntitlementPreset.deleteMany({ where: { planSlug: { in: [SMALL, BIG] } } });
  await prisma.$disconnect();
});

const statuses = async () => {
  const rots = await prisma.linkRotation.findMany({ where: { id: { in: [oldRot, newRot, otherRot] } }, select: { id: true, status: true } });
  const groups = await prisma.linkRotationGroup.findMany({ where: { rotationId: oldRot }, orderBy: { position: 'asc' }, select: { status: true } });
  return { rot: Object.fromEntries(rots.map((r) => [r.id, r.status])), groups: groups.map((g) => g.status) };
};

describe('PrismaLinkRotationPlanEnforcementStore', () => {
  it('rebaixo via SyncTenantEntitlementsUseCase: 1 rotação + 3 grupos; outro tenant intacto', async () => {
    await new SyncTenantEntitlementsUseCase().execute(tenantId, SMALL);
    const s = await statuses();
    expect(s.rot[oldRot]).toBe('ACTIVE');
    expect(s.rot[newRot]).toBe('PAUSED_BY_PLAN');
    expect(s.rot[otherRot]).toBe('ACTIVE');
    expect(s.groups.slice(0, 3)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(s.groups.slice(3).every((g) => g === 'PAUSED_BY_PLAN')).toBe(true);
  });

  it('subida dentro de $transaction (fluxo do webhook) volta; grupo sem link → NEEDS_LINK; idempotente', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.tenantEntitlement.updateMany({ where: { tenantId, key: ENTITLEMENT_KEYS.LINK_ROTATIONS }, data: { value: 2 } });
      await tx.tenantEntitlement.updateMany({ where: { tenantId, key: ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS }, data: { value: 10 } });
      await applyLinkRotationPlanLimits(tx, tenantId);
    });
    const s = await statuses();
    expect(s.rot[newRot]).toBe('ACTIVE');
    expect(s.groups[4]).toBe('NEEDS_LINK');
    expect(s.groups.filter((g) => g === 'ACTIVE')).toHaveLength(9);
    expect(await applyLinkRotationPlanLimits(prisma, tenantId)).toEqual({ rotationsChanged: 0, groupsChanged: 0 });
  });

  it('pauseBySession: rotações da sessão → PAUSED; outro tenant intacto', async () => {
    const store = new PrismaLinkRotationPlanEnforcementStore(prisma);
    expect(await store.pauseBySession(tenantId, sessionId)).toBe(2);
    const s = await statuses();
    expect([s.rot[oldRot], s.rot[newRot], s.rot[otherRot]]).toEqual(['PAUSED', 'PAUSED', 'ACTIVE']);
    expect(await store.pauseBySession(otherTenant, sessionId)).toBe(0);
  });
});
