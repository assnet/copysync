import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../database/prisma.client';
import { PrismaJobLease } from './PrismaJobLease';

/** Renovação do lease contra o Postgres descartável. */
const NAME = 'lease-renew-int';
const clean = () => prisma.jobLease.deleteMany({ where: { name: NAME } });
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('PrismaJobLease.renew', () => {
  it('só o dono renova; depois de outro adquirir (vencido), o antigo dono perde', async () => {
    const lease = new PrismaJobLease(prisma);
    const t0 = new Date('2026-11-17T10:00:00Z');
    expect(await lease.tryAcquire(NAME, 'a', new Date(t0.getTime() + 60_000), t0)).toBe(true);
    expect(await lease.renew(NAME, 'b', new Date(t0.getTime() + 600_000))).toBe(false);
    expect(await lease.renew(NAME, 'a', new Date(t0.getTime() + 600_000))).toBe(true);
    // Renovado: em t0 + 2 min ainda não venceu
    expect(await lease.tryAcquire(NAME, 'b', new Date(t0.getTime() + 900_000), new Date(t0.getTime() + 120_000))).toBe(false);
    // Vencido em t0 + 11 min: b adquire e a não renova mais
    expect(await lease.tryAcquire(NAME, 'b', new Date(t0.getTime() + 1_200_000), new Date(t0.getTime() + 660_000))).toBe(true);
    expect(await lease.renew(NAME, 'a', new Date(t0.getTime() + 1_800_000))).toBe(false);
    await lease.release(NAME, 'b');
    expect(await lease.renew(NAME, 'b', new Date(t0.getTime() + 1_800_000))).toBe(false);
  });
});
