import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../../shared/database/prisma.client';
import { PrismaOfferHuntAiSuggestionCounter } from './PrismaOfferHuntAiSuggestionCounter';

/** Teto de sugestões de IA por tenant/dia: atômico sob concorrência, dia anterior não conta, release devolve. */
const counter = new PrismaOfferHuntAiSuggestionCounter(prisma);
let tenantId = '';
let otherId = '';

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-ai-sug-${Date.now()}` } })).id;
  otherId = (await prisma.tenant.create({ data: { name: 'int2', slug: `int-ai-sug2-${Date.now()}` } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
  await prisma.$disconnect();
});

describe('PrismaOfferHuntAiSuggestionCounter', () => {
  const dayStart = new Date('2026-11-15T03:00:00.000Z');
  const now = new Date('2026-11-15T12:00:00.000Z');

  it('10 claims simultâneos com teto 5: exatamente 5 OK; ontem e outro tenant não contam; release devolve', async () => {
    await prisma.offerHuntAiSuggestion.create({ data: { tenantId, createdAt: new Date('2026-11-15T02:59:59.000Z') } });
    await counter.claim(otherId, dayStart, 5, now);
    const out = await Promise.all(Array.from({ length: 10 }, () => counter.claim(tenantId, dayStart, 5, now)));
    const ok = out.filter((c) => c.kind === 'OK');
    expect(ok).toHaveLength(5);
    expect(ok.map((c) => c.used).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(out.filter((c) => c.kind === 'DAILY_LIMIT').every((c) => c.used === 5)).toBe(true);
    expect(await counter.countSince(tenantId, dayStart)).toBe(5);
    await counter.release(otherId, (ok[0] as { id: string }).id); // outro tenant: não apaga
    expect(await counter.countSince(tenantId, dayStart)).toBe(5);
    await counter.release(tenantId, (ok[0] as { id: string }).id);
    expect(await counter.countSince(tenantId, dayStart)).toBe(4);
    expect((await counter.claim(tenantId, dayStart, 5, now)).kind).toBe('OK');
  });
});
