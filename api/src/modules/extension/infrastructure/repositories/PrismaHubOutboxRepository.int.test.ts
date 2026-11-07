import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaHubOutboxRepository } from './PrismaHubOutboxRepository';

/** claimHeads contra Postgres real: a query precisa ser aceita pelo Postgres (FOR UPDATE sem DISTINCT). */
const stamp = Date.now();
const keys: string[] = [];
const repo = new PrismaHubOutboxRepository(prisma);

async function event(clientKey: string, seq: number, data: { status?: 'PENDING' | 'SENT' | 'DEAD'; nextAttemptAt?: Date; lockedUntil?: Date } = {}) {
  if (!keys.includes(clientKey)) keys.push(clientKey);
  return prisma.hubOutboxEvent.create({
    data: { clientKey, seq, installationId: null, type: 'extension.lifecycle', payload: { event: 'STORE_CLICK' }, ...data },
  });
}

describe('PrismaHubOutboxRepository.claimHeads (Postgres)', () => {
  afterAll(async () => {
    await prisma.hubOutboxEvent.deleteMany({ where: { clientKey: { in: keys } } });
  });

  it('pega só a cabeça de cada cliente, respeita DEAD, retry e lock', async () => {
    const a = `a-${stamp}`, b = `b-${stamp}`, dead = `d-${stamp}`, wait = `w-${stamp}`;
    const a1 = await event(a, 1);
    await event(a, 2);
    await event(b, 1, { status: 'SENT' });
    const b2 = await event(b, 2);
    await event(dead, 1, { status: 'DEAD' });
    await event(dead, 2);
    await event(wait, 1, { nextAttemptAt: new Date(Date.now() + 60_000) });
    await event(wait, 2);

    const lockedUntil = new Date(Date.now() + 30_000);
    const ids = (await repo.claimHeads(lockedUntil)).filter((r) => keys.includes(r.clientKey)).map((r) => r.id).sort();
    expect(ids).toEqual([a1.id, b2.id].sort());

    // Já travados: a segunda chamada não devolve as mesmas cabeças nem passa à frente.
    const again = (await repo.claimHeads(lockedUntil)).filter((r) => keys.includes(r.clientKey));
    expect(again).toEqual([]);
  });
});
