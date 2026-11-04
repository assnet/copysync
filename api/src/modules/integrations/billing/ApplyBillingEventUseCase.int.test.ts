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
