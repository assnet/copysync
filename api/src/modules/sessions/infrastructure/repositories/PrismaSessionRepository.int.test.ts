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

describe('findActiveSessionsForBootstrap — religar após deploy', () => {
  const boot = async () => (await repo.findActiveSessionsForBootstrap()).filter((s) => s.tenantId === tenantId).map((s) => s.id).sort();

  it('DISCONNECTED com pedido vivo (deixado pelo shutdown) entra; sem pedido fica fora', async () => {
    const afterShutdown = await newSession({ status: 'DISCONNECTED', connectRequestedAt: new Date() });
    await newSession({ status: 'DISCONNECTED', connectRequestedAt: null });
    const connected = await newSession();
    expect(await boot()).toEqual([afterShutdown, connected].sort());
  });

  it('FAILED/LOGGED_OUT com pedido vivo e excluída ficam fora', async () => {
    await newSession({ status: 'FAILED', connectRequestedAt: new Date() });
    await newSession({ status: 'LOGGED_OUT', connectRequestedAt: new Date() });
    await newSession({ status: 'DISCONNECTED', connectRequestedAt: new Date(), deletedAt: new Date() });
    expect(await boot()).toEqual([]);
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

describe('markDisconnectedUnlessLeasedElsewhere — dono da sessão (OWN-04)', () => {
  const ME = 'w-me';
  const read = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
  const expectDisconnected = async (id: string) => {
    const s = await read(id);
    expect(s.status).toBe('DISCONNECTED');
    expect(s.lastDisconnectedAt).not.toBeNull();
    expect(s.connectRequestedAt).toBeNull();
  };

  it('lease nulo, vencido de outro ou vivo meu: grava DISCONNECTED e limpa o pedido', async () => {
    const free = await newSession({ connectRequestedAt: new Date() });
    const expired = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() - 1_000) });
    const own = await newSession({ ownerWorkerId: ME, leaseUntil: new Date(Date.now() + 60_000) });
    for (const id of [free, expired, own]) {
      expect(await repo.markDisconnectedUnlessLeasedElsewhere(id, tenantId, ME)).toBe(true);
      await expectDisconnected(id);
    }
  });

  it('lease vivo de outro processo: não toca a sessão', async () => {
    const id = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() + 60_000) });
    const before = await read(id);
    expect(await repo.markDisconnectedUnlessLeasedElsewhere(id, tenantId, ME)).toBe(false);
    expect(await read(id)).toEqual(before);
  });

  it('outro tenant ou excluída: não grava', async () => {
    const a = await newSession();
    expect(await repo.markDisconnectedUnlessLeasedElsewhere(a, 'outro-tenant', ME)).toBe(false);
    expect((await read(a)).status).toBe('CONNECTED');
    const del = await newSession({ deletedAt: new Date() });
    expect(await repo.markDisconnectedUnlessLeasedElsewhere(del, tenantId, ME)).toBe(false);
    expect((await read(del)).status).toBe('CONNECTED');
  });

  it('relógio UTC com TimeZone da conexão ≠ UTC (São Paulo)', async () => {
    const db = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone = 'America/Sao_Paulo'`);
    await prisma.$disconnect();
    try {
      const tz = (await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`)[0]!.tz;
      expect(tz).toBe('America/Sao_Paulo');
      // Vencido há 1 h em UTC: no relógio local (UTC-3) pareceria vivo.
      const expired = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() - 3_600_000) });
      expect(await repo.markDisconnectedUnlessLeasedElsewhere(expired, tenantId, ME)).toBe(true);
      await expectDisconnected(expired);
      // Vivo por 10 min em UTC: continua vivo.
      const alive = await newSession({ ownerWorkerId: 'w-other', leaseUntil: new Date(Date.now() + 600_000) });
      expect(await repo.markDisconnectedUnlessLeasedElsewhere(alive, tenantId, ME)).toBe(false);
      expect((await read(alive)).status).toBe('CONNECTED');
      // lastDisconnectedAt gravado em UTC (sem deslocamento de 3 h).
      const at = (await read(expired)).lastDisconnectedAt!.getTime();
      expect(Math.abs(at - Date.now())).toBeLessThan(60_000);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone = 'UTC'`);
      await prisma.$disconnect();
    }
  });
});

describe('findWithInactiveTenant — varredura de tenant inativo (OWN-04)', () => {
  const others: string[] = [];
  const otherTenant = async (status: 'SUSPENDED' | 'CANCELLED') => {
    const id = (await prisma.tenant.create({ data: { name: 'int-x', slug: `int-session-${status}-${Date.now()}`, status } })).id;
    others.push(id);
    return id;
  };
  afterAll(async () => {
    await prisma.session.deleteMany({ where: { tenantId: { in: others } } });
    await prisma.tenant.deleteMany({ where: { id: { in: others } } });
  });

  it('lista vazia: não consulta e devolve []', async () => {
    expect(await repo.findWithInactiveTenant([])).toEqual([]);
  });

  it('só sessões de tenant ≠ ACTIVE, entre os ids pedidos e não excluídas', async () => {
    const active = await newSession();
    const suspendedT = await otherTenant('SUSPENDED');
    const cancelledT = await otherTenant('CANCELLED');
    const mk = async (t: string, data: Record<string, unknown> = {}) =>
      (await prisma.session.create({ data: { tenantId: t, name: 'int-inactive', status: 'CONNECTED', ...data } })).id;
    const suspended = await mk(suspendedT);
    const cancelled = await mk(cancelledT);
    const deleted = await mk(suspendedT, { deletedAt: new Date() });
    const notAsked = await mk(suspendedT);
    const out = await repo.findWithInactiveTenant([active, suspended, cancelled, deleted, 'inexistente']);
    expect(out.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [{ id: suspended, tenantId: suspendedT }, { id: cancelled, tenantId: cancelledT }].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(out.map((s) => s.id)).not.toContain(notAsked);
  });
});
