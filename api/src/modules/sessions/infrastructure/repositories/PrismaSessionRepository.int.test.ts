import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionRepository } from './PrismaSessionRepository';

/** Sessões ativas sem lease vivo (LEASE-10) contra Postgres local: relógio do banco. */
const repo = new PrismaSessionRepository();
let tenantId = '';

const newSession = async (data: Record<string, unknown> = {}) =>
  (await prisma.session.create({ data: { tenantId, name: 'int-session', status: 'CONNECTED', ...data } })).id;
const mine = async () => (await repo.findActiveSessionsWithoutLiveLease()).filter((s) => s.tenantId === tenantId).map((s) => s.id).sort();

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-session-${Date.now()}` } })).id;
});
beforeEach(async () => {
  await prisma.session.deleteMany({ where: { tenantId } });
});
afterAll(async () => {
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('findActiveSessionsWithoutLiveLease', () => {
  it('lease nulo e vencido entram; vivo de outro worker fica fora', async () => {
    const free = await newSession();
    const expired = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() - 1_000) });
    await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() + 60_000) });
    expect(await mine()).toEqual([free, expired].sort());
  });

  it('excluída fica fora mesmo sem lease', async () => {
    await newSession({ deletedAt: new Date() });
    await newSession({ deletedAt: new Date(), leaseUntil: new Date(Date.now() - 1_000) });
    expect(await mine()).toEqual([]);
  });

  it('só status ativos: inativos ficam fora; todos os ativos entram', async () => {
    const active = [];
    for (const status of ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD', 'CONNECTED']) {
      active.push(await newSession({ status }));
    }
    for (const status of ['PENDING', 'DISCONNECTED', 'LOGGED_OUT', 'FAILED']) await newSession({ status });
    expect(await mine()).toEqual(active.sort());
  });

  it('mapeia para o domínio com os campos da sessão', async () => {
    const id = await newSession({ name: 'mapeada', engine: 'baileys' });
    const [s] = (await repo.findActiveSessionsWithoutLiveLease()).filter((x) => x.id === id);
    expect(s).toMatchObject({ id, tenantId, name: 'mapeada', status: 'CONNECTED' });
  });
});

describe('markConnectRequested — backoff de adoção (ADOPT-04)', () => {
  const read = async (id: string) =>
    prisma.session.findUniqueOrThrow({ where: { id }, select: { connectRequestedAt: true, adoptFailures: true, nextAdoptAt: true } });

  it('pedido nulo → grava pedido e zera contador e próxima tentativa', async () => {
    const id = await newSession({ status: 'FAILED', adoptFailures: 5, nextAdoptAt: new Date(Date.now() + 60_000) });
    await repo.markConnectRequested(id, tenantId);
    const s = await read(id);
    expect(s.connectRequestedAt).toBeInstanceOf(Date);
    expect(s).toMatchObject({ adoptFailures: 0, nextAdoptAt: null });
  });

  it('pedido vivo → horário, contador e próxima tentativa intactos', async () => {
    const requestedAt = new Date(Date.now() - 120_000);
    const nextAdoptAt = new Date(Date.now() + 60_000);
    const id = await newSession({ connectRequestedAt: requestedAt, adoptFailures: 3, nextAdoptAt });
    await repo.markConnectRequested(id, tenantId);
    expect(await read(id)).toEqual({ connectRequestedAt: requestedAt, adoptFailures: 3, nextAdoptAt });
  });

  it('outro tenant não é afetado', async () => {
    const id = await newSession({ adoptFailures: 2 });
    await repo.markConnectRequested(id, 'outro-tenant');
    expect(await read(id)).toEqual({ connectRequestedAt: null, adoptFailures: 2, nextAdoptAt: null });
  });
});

describe('markDisconnectedIfNoLiveLease', () => {
  const read = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

  it('lease nulo ou vencido: marca DISCONNECTED com lastDisconnectedAt', async () => {
    const free = await newSession();
    const expired = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() - 1_000) });
    for (const id of [free, expired]) {
      expect(await repo.markDisconnectedIfNoLiveLease(id, tenantId)).toBe(true);
      const s = await read(id);
      expect(s.status).toBe('DISCONNECTED');
      expect(s.lastDisconnectedAt).not.toBeNull();
    }
  });

  it('lease vivo (connect no meio): não toca a sessão', async () => {
    const id = await newSession({ ownerWorkerId: 'w-local', leaseUntil: new Date(Date.now() + 60_000) });
    const before = await read(id);
    expect(await repo.markDisconnectedIfNoLiveLease(id, tenantId)).toBe(false);
    const after = await read(id);
    expect(after.status).toBe('CONNECTED');
    expect(after.lastDisconnectedAt).toBeNull();
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('outro tenant, excluída ou status inativo: não grava', async () => {
    const a = await newSession();
    expect(await repo.markDisconnectedIfNoLiveLease(a, 'outro-tenant')).toBe(false);
    expect((await read(a)).status).toBe('CONNECTED');
    const del = await newSession({ deletedAt: new Date() });
    expect(await repo.markDisconnectedIfNoLiveLease(del, tenantId)).toBe(false);
    const failed = await newSession({ status: 'FAILED' });
    expect(await repo.markDisconnectedIfNoLiveLease(failed, tenantId)).toBe(false);
    expect((await read(failed)).status).toBe('FAILED');
  });
});
