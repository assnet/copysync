import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionAdoptionRepository } from '../../../sessions/infrastructure/repositories/PrismaSessionAdoptionRepository';
import { PrismaWorkerHeartbeatRepository } from '../../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import type { OpsMetricReading } from '../../domain/OpsMetric';
import { AWAITING_STATEMENT_TIMEOUT_MS, SessionsOccupancySource } from './SessionsOccupancySource';

/**
 * WSCALE-08 contra Postgres descartável, com `TimeZone` da conexão ≠ UTC (o relógio é
 * `now() AT TIME ZONE 'UTC'`). Contagem é global: cada teste parte de `sessions` e
 * `worker_heartbeats` vazias.
 */
const MIN = 60_000;
const heartbeats = new PrismaWorkerHeartbeatRepository();
let tenantId = '';
let suspendedId = '';
let dbName = '';
let adoption = false;
const MAX = 25;

const source = new SessionsOccupancySource({
  prisma,
  adoptionEnabled: () => adoption,
  adoption: new PrismaSessionAdoptionRepository(),
  heartbeats,
  maxSessionsPerWorker: () => MAX,
});

const past = (ms = MIN) => new Date(Date.now() - ms);
const future = (ms = 10 * MIN) => new Date(Date.now() + ms);
const session = (data: Record<string, unknown>) =>
  prisma.session.create({ data: { tenantId, name: 'int-occ', status: 'DISCONNECTED', ...data } });
const live = (owner: string, status: string) => session({ status, ownerWorkerId: owner, leaseUntil: future() });
const values = (out: OpsMetricReading[]) => Object.fromEntries(out.map((r) => [r.metric, r.value]));
const beat = (workerId: string, maxSessions: number) =>
  heartbeats.beat({ workerId, role: 'worker', sessions: 0, pendingLogins: 0, maxSessions, rssMb: 100 });

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  const stamp = Date.now();
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-occ-${stamp}` } })).id;
  suspendedId = (await prisma.tenant.create({ data: { name: 'int-s', slug: `int-occ-s-${stamp}`, status: 'SUSPENDED' } })).id;
});
beforeEach(async () => {
  adoption = false;
  await prisma.session.deleteMany({});
  await prisma.workerHeartbeat.deleteMany({});
});
afterAll(async () => {
  await prisma.session.deleteMany({});
  await prisma.workerHeartbeat.deleteMany({});
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, suspendedId] } } });
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('SessionsOccupancySource', () => {
  it('banco vazio, sem adoção: zeros e capacidade = teto × 1 (mínimo 1 processo)', async () => {
    const out = await source.read();
    expect(out.every((r) => r.source === 'sessions' && r.resource === 'cluster' && r.kind === 'gauge')).toBe(true);
    expect(values(out)).toEqual({ sessions_connected: 0, sessions_pending_login: 0, sessions_awaiting: 0, sessions_capacity: MAX });
  });

  it('conta só lease vivo: CONNECTED → conectada; CONNECTING/AWAITING_* → login; vencido e apagada fora', async () => {
    await live('w1', 'CONNECTED');
    await live('w1', 'CONNECTED');
    await live('w2', 'CONNECTING');
    await live('w2', 'AWAITING_QR');
    await live('w2', 'AWAITING_PAIRING');
    await live('w2', 'AWAITING_CODE');
    await live('w2', 'AWAITING_PASSWORD');
    await live('w2', 'DISCONNECTED');
    await session({ status: 'CONNECTED', ownerWorkerId: 'w3', leaseUntil: past() });
    await session({ status: 'AWAITING_QR', ownerWorkerId: 'w3', leaseUntil: past() });
    await session({ status: 'CONNECTED', ownerWorkerId: 'w1', leaseUntil: future(), deletedAt: new Date() });
    const v = values(await source.read());
    expect(v.sessions_connected).toBe(2);
    expect(v.sessions_pending_login).toBe(5);
  });

  it('sem adoção: aguardando = 0 mesmo com órfã; capacidade = teto × processos donos de lease vivo', async () => {
    await session({ status: 'DISCONNECTED', connectRequestedAt: past() });
    await live('w1', 'CONNECTED');
    await live('w2', 'CONNECTED');
    await live('w2', 'CONNECTING');
    await session({ status: 'CONNECTED', ownerWorkerId: 'w3', leaseUntil: past() });
    await beat('hb-1', 1000);
    const v = values(await source.read());
    expect(v.sessions_awaiting).toBe(0);
    expect(v.sessions_capacity).toBe(MAX * 2);
  });

  it('com adoção: aguardando = sem dono vivo, adotável, tenant ativo (sem filtro de idade)', async () => {
    adoption = true;
    await session({ status: 'DISCONNECTED', connectRequestedAt: new Date() });
    await session({ status: 'CONNECTED', connectRequestedAt: past(), ownerWorkerId: 'w9', leaseUntil: past() });
    await session({ status: 'DISCONNECTED', connectRequestedAt: past(), ownerWorkerId: 'w1', leaseUntil: future() });
    await session({ status: 'DISCONNECTED', connectRequestedAt: null });
    await session({ status: 'LOGGED_OUT', connectRequestedAt: past() });
    await session({ status: 'DISCONNECTED', connectRequestedAt: past(), deletedAt: new Date() });
    await prisma.session.create({ data: { tenantId: suspendedId, name: 'x', status: 'DISCONNECTED', connectRequestedAt: past() } });
    expect(values(await source.read()).sessions_awaiting).toBe(2);
  });

  it('com adoção: aguardando consultado com teto de 2 s', async () => {
    const countAwaitingCapacity = vi.fn(async () => 7);
    const spy = new SessionsOccupancySource({
      prisma, adoptionEnabled: () => true, adoption: { countAwaitingCapacity }, heartbeats, maxSessionsPerWorker: () => MAX,
    });
    expect(values(await spy.read()).sessions_awaiting).toBe(7);
    expect(AWAITING_STATEMENT_TIMEOUT_MS).toBe(2_000);
    expect(countAwaitingCapacity).toHaveBeenCalledWith(undefined, { statementTimeoutMs: 2_000 });
  });

  it('com adoção: capacidade = soma dos tetos dos batimentos vivos; sem batimento = 0', async () => {
    adoption = true;
    await live('w1', 'CONNECTED');
    expect(values(await source.read()).sessions_capacity).toBe(0);
    await beat('hb-1', 40);
    await beat('hb-2', 60);
    await prisma.$executeRaw`UPDATE "worker_heartbeats" SET "seenAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE "workerId" = 'hb-2'`;
    await beat('hb-3', 15);
    expect(values(await source.read()).sessions_capacity).toBe(55);
  });
});
