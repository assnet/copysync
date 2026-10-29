import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSendingPauseStore } from './PrismaSendingPauseStore';

/** Pausa global atômica (docs/fila-de-envio.md §2.5): dois "pausar" ficam com o mesmo instante. */
const store = new PrismaSendingPauseStore(prisma);
let tenantId = '';

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-pause-${Date.now()}` } })).id;
});
afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('pauseIfActive', () => {
  it('primeiro grava; segundo devolve o instante gravado; retomar zera; tenant inexistente → NOT_FOUND', async () => {
    const t1 = new Date('2026-10-28T12:00:00.000Z');
    const t2 = new Date('2026-10-28T12:00:05.000Z');
    expect(await store.pauseIfActive(tenantId, t1)).toEqual(t1);
    expect(await store.pauseIfActive(tenantId, t2)).toEqual(t1);
    expect(await store.get(tenantId)).toEqual(t1);
    await store.set(tenantId, null);
    expect(await store.get(tenantId)).toBeNull();
    await expect(store.pauseIfActive('nao-existe', t1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
