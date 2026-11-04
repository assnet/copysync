import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaChatMessageRepository } from './PrismaChatMessageRepository';

/** `failPending` contra Postgres local (WROLE-14): lease no relógio do banco. */
const repo = new PrismaChatMessageRepository(prisma);
const ME = 'worker-me';
const OTHER = 'worker-other';
const LIVE = () => new Date(Date.now() + 60_000);
const EXPIRED = () => new Date(Date.now() - 60_000);
let tenantId = '';

/** Mensagem PENDING numa conversa ligada a uma sessão com o lease dado (`null` = sem sessão). */
async function pending(lease: { owner: string | null; until: Date | null } | null): Promise<string> {
  const sessionId = lease
    ? (await prisma.session.create({
        data: { tenantId, name: 'int-pending', ownerWorkerId: lease.owner, leaseUntil: lease.until },
      })).id
    : null;
  const conv = await prisma.chatConversation.create({ data: { tenantId, sessionId } });
  const msg = await prisma.chatMessage.create({
    data: { tenantId, conversationId: conv.id, direction: 'OUTBOUND', type: 'IMAGE', status: 'PENDING' },
  });
  return msg.id;
}
const statusOf = async (id: string) =>
  (await prisma.chatMessage.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function cleanup() {
  await prisma.chatMessage.deleteMany({ where: { tenantId } });
  await prisma.chatConversation.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { tenantId } });
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-pending-${Date.now()}` } })).id;
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('failPending', () => {
  it('sem spareLiveLeaseOtherThan falha todo PENDING, inclusive de lease vivo alheio', async () => {
    const alheio = await pending({ owner: OTHER, until: LIVE() });
    const semSessao = await pending(null);

    const failed = await repo.failPending({ olderThan: new Date(Date.now() + 1_000) });

    expect(failed.map((m) => m.id).sort()).toEqual([alheio, semSessao].sort());
    expect(await statusOf(alheio)).toBe('FAILED');
  });

  it('com spareLiveLeaseOtherThan poupa só lease vivo de outro processo', async () => {
    const alheioVivo = await pending({ owner: OTHER, until: LIVE() });
    const proprioVivo = await pending({ owner: ME, until: LIVE() });
    const alheioVencido = await pending({ owner: OTHER, until: EXPIRED() });
    const leaseNulo = await pending({ owner: null, until: null });
    const semSessao = await pending(null);

    const failed = await repo.failPending({
      olderThan: new Date(Date.now() + 1_000),
      spareLiveLeaseOtherThan: ME,
    });

    expect(failed.map((m) => m.id).sort()).toEqual([proprioVivo, alheioVencido, leaseNulo, semSessao].sort());
    expect(await statusOf(alheioVivo)).toBe('PENDING');
    expect(failed[0]).toEqual({ id: expect.any(String), tenantId, conversationId: expect.any(String) });
  });

  it('combina com excludeIds e olderThan', async () => {
    const naFila = await pending({ owner: ME, until: LIVE() });
    const alheioVivo = await pending({ owner: OTHER, until: LIVE() });
    const orfa = await pending(null);

    expect(
      await repo.failPending({ olderThan: new Date(Date.now() - 60_000), spareLiveLeaseOtherThan: ME }),
    ).toEqual([]);
    const failed = await repo.failPending({
      olderThan: new Date(Date.now() + 1_000),
      excludeIds: () => [naFila],
      spareLiveLeaseOtherThan: ME,
    });

    expect(failed.map((m) => m.id)).toEqual([orfa]);
    expect(await statusOf(naFila)).toBe('PENDING');
    expect(await statusOf(alheioVivo)).toBe('PENDING');
  });
});
