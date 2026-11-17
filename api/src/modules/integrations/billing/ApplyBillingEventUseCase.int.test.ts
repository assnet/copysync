import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../shared/database/prisma.client';
import { ApplyBillingEventUseCase, type ApplyBillingEventInput } from './ApplyBillingEventUseCase';
import { PrismaTenantRepository } from '../../tenants/infrastructure/repositories/PrismaTenantRepository';

/** `seq` da central é BIGINT: marca d’água e recibo acima de 2^31 e de 2^53 sem perder precisão. */
const stamp = Date.now();
const customer = `int-billing-seq-${stamp}`;
const useCase = new ApplyBillingEventUseCase();
let tenantId = '';

const ev = (eventId: string, seq: bigint, eventType = 'subscription.renewed'): ApplyBillingEventInput => ({
  eventId: `${eventId}-${stamp}`, billingCustomerId: customer, eventType, seq, payload: { planSlug: null },
});
const watermark = async () => (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).lastBillingEventSeq;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({
    data: { name: 'int-billing', slug: `int-billing-${stamp}`, billingCustomerId: customer, lastBillingEventSeq: 2_147_483_647n },
  })).id;
});
afterAll(async () => {
  await prisma.billingEventReceipt.deleteMany({ where: { billingCustomerId: customer } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('ApplyBillingEventUseCase (seq BIGINT)', () => {
  it('seq acima de 2^31 aplica e grava marca d’água e recibo', async () => {
    expect((await useCase.execute(ev('a', 2_147_483_648n))).outcome).toBe('APPLIED');
    expect(await watermark()).toBe(2_147_483_648n);
    const r = await prisma.billingEventReceipt.findUniqueOrThrow({ where: { eventId: `a-${stamp}` } });
    expect(r.seq).toBe(2_147_483_648n);
  });

  it('seq acima de 2^53 mantém precisão; o vizinho menor vira OUT_OF_ORDER', async () => {
    expect((await useCase.execute(ev('b', 9_007_199_254_740_993n, 'subscription.trial_ended'))).outcome).toBe('IGNORED');
    expect(await watermark()).toBe(9_007_199_254_740_993n);
    expect((await useCase.execute(ev('c', 9_007_199_254_740_992n))).outcome).toBe('OUT_OF_ORDER');
    expect(await watermark()).toBe(9_007_199_254_740_993n);
  });

  it('teto do BIGINT cabe; updateBillingSeq do repositório compara em bigint', async () => {
    expect((await useCase.execute(ev('d', 9_223_372_036_854_775_806n))).outcome).toBe('APPLIED');
    const repo = new PrismaTenantRepository(prisma);
    expect(await repo.updateBillingSeq(tenantId, 9_223_372_036_854_775_805n)).toBe(0);
    expect(await repo.updateBillingSeq(tenantId, 9_223_372_036_854_775_807n)).toBe(1);
    expect((await repo.findById(tenantId))!.lastBillingEventSeq).toBe(9_223_372_036_854_775_807n);
  });
});

/** Vínculo pelo e-mail do dono: SQL do lock condicional, relação UserTenant e idempotência no Postgres real. */
describe('ApplyBillingEventUseCase (vínculo pelo e-mail)', () => {
  const linkCustomer = `int-billing-link-${stamp}`;
  const email = `dono-${stamp}@exemplo.com`;
  const provisioner = { execute: async () => { throw new Error('não deveria provisionar'); } };
  // Central sem assinatura válida: o canceled do teste corta (união vazia)
  const hub = { fetchByCustomer: async () => ({ ok: true as const, snapshot: { externalUserId: linkCustomer, subscriptions: [], lastSeq: 2n } }) };
  const linkUseCase = new ApplyBillingEventUseCase(provisioner, hub);
  let manualId = '';
  let userId = '';
  const activated = (eventId: string, seq: bigint): ApplyBillingEventInput => ({
    eventId: `${eventId}-${stamp}`, billingCustomerId: linkCustomer, eventType: 'subscription.activated', seq,
    payload: { email: email.toUpperCase(), name: 'Dono', planSlug: null },
  });

  beforeAll(async () => {
    manualId = (await prisma.tenant.create({ data: { name: 'manual', slug: `int-link-${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email, name: 'Dono' } })).id;
    await prisma.userTenant.create({ data: { userId, tenantId: manualId, role: 'ADMIN' } });
  });
  afterAll(async () => {
    await prisma.billingEventReceipt.deleteMany({ where: { billingCustomerId: linkCustomer } });
    await prisma.auditLog.deleteMany({ where: { tenantId: manualId } });
    await prisma.userTenant.deleteMany({ where: { tenantId: manualId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: manualId } });
  });

  it('vincula o tenant único do dono, audita e reentrega vira DUPLICATE', async () => {
    const first = await linkUseCase.execute({ ...activated('l1', 1n), payload: { email: ` ${email.toUpperCase()} `, name: 'Dono', planSlug: 'COPYSYNC_PRO' } });
    expect(first).toEqual({ outcome: 'APPLIED', tenantId: manualId });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: manualId } });
    expect(t).toMatchObject({ billingCustomerId: linkCustomer, planSlug: 'COPYSYNC_PRO', status: 'ACTIVE', lastBillingEventSeq: 1n });
    expect(await prisma.auditLog.count({ where: { tenantId: manualId, action: 'TENANT_UPDATED' } })).toBe(1);
    expect((await linkUseCase.execute({ ...activated('l1', 1n), payload: { email, planSlug: 'COPYSYNC_PRO' } })).outcome).toBe('DUPLICATE');
    const next = await linkUseCase.execute({ ...activated('l2', 2n), eventType: 'subscription.canceled' });
    expect(next).toEqual({ outcome: 'APPLIED', tenantId: manualId });
    expect(await prisma.auditLog.count({ where: { tenantId: manualId, action: 'TENANT_UPDATED' } })).toBe(1);
  });
});

/** Por produto: trava com `tenant_products` (EXISTS no FOR UPDATE), linhas na mesma transação, eventos concorrentes. */
describe('ApplyBillingEventUseCase (por produto)', () => {
  const pCustomer = `int-billing-prod-${stamp}`;
  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const subs = [
    { id: 'aff', planSlug: 'copysync-pro-mensal', billingStatus: 'REFUNDED', expiresAt: iso(10), deletedAt: null },
    { id: 'sv', planSlug: 'copysync-saver-pro-mensal', billingStatus: 'ACTIVE', expiresAt: iso(10), deletedAt: null },
  ];
  const hub = { fetchByCustomer: async () => ({ ok: true as const, snapshot: { externalUserId: pCustomer, subscriptions: subs, lastSeq: 9n } }) };
  const uc = new ApplyBillingEventUseCase(undefined, hub);
  let id = '';
  const pev = (eventId: string, seq: bigint, eventType: string, planSlug: string): ApplyBillingEventInput => ({
    eventId: `${eventId}-${stamp}`, billingCustomerId: pCustomer, eventType, seq, payload: { planSlug, expiresAt: iso(30) },
  });
  const rows = () => prisma.tenantProduct.findMany({ where: { tenantId: id }, orderBy: { product: 'asc' } });

  beforeAll(async () => {
    id = (await prisma.tenant.create({ data: { name: 'int-prod', slug: `int-prod-${stamp}`, billingCustomerId: pCustomer, planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 1n } })).id;
  });
  afterAll(async () => {
    await prisma.billingEventReceipt.deleteMany({ where: { billingCustomerId: pCustomer } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.deleteMany({ where: { id } });
  });

  it('Saver concorrente: uma linha só, plano de Afiliados intocado', async () => {
    const out = await Promise.all([uc.execute(pev('p1', 2n, 'subscription.renewed', 'copysync-saver-pro-mensal')), uc.execute(pev('p2', 3n, 'subscription.renewed', 'copysync-saver-pro-mensal'))]);
    expect(out.map((o) => o.outcome).sort()).toEqual(expect.arrayContaining(['APPLIED']));
    expect(await rows()).toEqual([expect.objectContaining({ product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'BILLING' })]);
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id } })).toMatchObject({ planSlug: 'COPYSYNC_PRO', status: 'ACTIVE' });
  });

  it('corte de Afiliados com Saver ativo: KEPT_ACTIVE e Afiliados inativo no mesmo commit', async () => {
    expect((await uc.execute(pev('p3', 4n, 'subscription.refunded', 'copysync-pro-mensal'))).outcome).toBe('KEPT_ACTIVE');
    const r = await rows();
    expect(r.map((x) => [x.product, x.status])).toEqual([['AFFILIATES', 'INACTIVE'], ['SAVER', 'ACTIVE']]);
    expect(r[0]!.inactiveSince).not.toBeNull();
    expect(await prisma.billingEventReceipt.count({ where: { billingCustomerId: pCustomer } })).toBe(3);
  });
});
