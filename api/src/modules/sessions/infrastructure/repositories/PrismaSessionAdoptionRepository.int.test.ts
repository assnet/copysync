import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionAdoptionRepository } from './PrismaSessionAdoptionRepository';

/**
 * Adoção por capacidade (ADOPT-03/04/05) contra Postgres local, com `TimeZone` da conexão ≠ UTC
 * para provar que o relógio é `now() AT TIME ZONE 'UTC'`. `adoptNext` é global: o banco é
 * descartável, então cada teste parte de `sessions` vazia.
 */
const repo = new PrismaSessionAdoptionRepository();
const TTL = 60_000;
const ME = 'worker-me';
const OTHER = 'worker-other';
const MIN = 60_000;
let tenantId = '';
let suspendedId = '';
let dbName = '';

const past = (ms = 1_000) => new Date(Date.now() - ms);
const future = (ms = 10 * MIN) => new Date(Date.now() + ms);
const newSession = async (data: Record<string, unknown> = {}) =>
  (
    await prisma.session.create({
      data: { tenantId, name: 'int-adopt', status: 'DISCONNECTED', connectRequestedAt: past(MIN), ...data },
    })
  ).id;
const row = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  const stamp = Date.now();
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-adopt-${stamp}` } })).id;
  suspendedId = (await prisma.tenant.create({ data: { name: 'int-s', slug: `int-adopt-s-${stamp}`, status: 'SUSPENDED' } }))
    .id;
});
beforeEach(async () => {
  await prisma.session.deleteMany({});
});
afterAll(async () => {
  await prisma.session.deleteMany({});
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, suspendedId] } } });
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

it('conexão roda com TimeZone ≠ UTC', async () => {
  const [r] = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
  expect(r!.tz).toBe('America/Sao_Paulo');
});

describe('adoptNext', () => {
  it('adota a órfã: lease ~TTL, adoptFailures+1, backoff 2 min, sem tocar updatedAt', async () => {
    const id = await newSession();
    const before = await row(id);
    expect(await repo.adoptNext(ME, null, TTL)).toEqual({ id, tenantId });
    const r = await row(id);
    expect(r.ownerWorkerId).toBe(ME);
    const left = r.leaseUntil!.getTime() - Date.now();
    expect(left).toBeGreaterThan(50_000);
    expect(left).toBeLessThan(70_000);
    expect(r.adoptFailures).toBe(1);
    expect(Math.abs(r.nextAdoptAt!.getTime() - Date.now() - 2 * MIN)).toBeLessThan(10_000);
    expect(r.updatedAt).toEqual(before.updatedAt);
    expect(r.status).toBe('DISCONNECTED');
  });

  it('nada a adotar → null', async () => {
    expect(await repo.adoptNext(ME, null, TTL)).toBeNull();
  });

  it('lease vencido de outro → adota; ordem por connectRequestedAt', async () => {
    const newer = await newSession({ connectRequestedAt: past(MIN) });
    const older = await newSession({ connectRequestedAt: past(5 * MIN), ownerWorkerId: OTHER, leaseUntil: past() });
    expect((await repo.adoptNext(ME, null, TTL))?.id).toBe(older);
    expect((await repo.adoptNext(ME, null, TTL))?.id).toBe(newer);
  });

  it('dois adoptNext concorrentes (mesmo tenant) pegam linhas diferentes', async () => {
    const a = await newSession({ connectRequestedAt: past(2 * MIN) });
    const b = await newSession({ connectRequestedAt: past(MIN) });
    const r = await Promise.all([repo.adoptNext(ME, null, TTL), repo.adoptNext(OTHER, null, TTL)]);
    expect(r.map((x) => x?.id).sort()).toEqual([a, b].sort());
    expect(new Set([(await row(a)).ownerWorkerId, (await row(b)).ownerWorkerId])).toEqual(new Set([ME, OTHER]));
  });

  it('fora: tenant SUSPENDED, apagada, AWAITING_QR, sem pedido, lease vivo, nextAdoptAt futuro, adoptFailures=5, shard diferente', async () => {
    await newSession({ tenantId: suspendedId });
    await newSession({ deletedAt: new Date() });
    await newSession({ status: 'AWAITING_QR' });
    await newSession({ connectRequestedAt: null });
    await newSession({ ownerWorkerId: OTHER, leaseUntil: future(TTL) });
    await newSession({ nextAdoptAt: future() });
    await newSession({ adoptFailures: 5 });
    await newSession({ shard: 'dedicado' });
    expect(await repo.adoptNext(ME, null, TTL)).toBeNull();
    expect(await prisma.session.count({ where: { ownerWorkerId: ME } })).toBe(0);
  });

  it('nextAdoptAt passado é adotável', async () => {
    const id = await newSession({ nextAdoptAt: past(), adoptFailures: 2 });
    expect((await repo.adoptNext(ME, null, TTL))?.id).toBe(id);
  });

  it('shard: NULL só com $shard NULL; valor só com o mesmo valor', async () => {
    const none = await newSession();
    const ded = await newSession({ shard: 'dedicado' });
    expect(await repo.adoptNext(ME, 'outro', TTL)).toBeNull();
    expect((await repo.adoptNext(ME, 'dedicado', TTL))?.id).toBe(ded);
    expect(await repo.adoptNext(ME, 'dedicado', TTL)).toBeNull();
    expect((await repo.adoptNext(ME, null, TTL))?.id).toBe(none);
  });

  it('backoff 2/4/8/16/30 min ao longo das tentativas; na 5ª sai da fila', async () => {
    const id = await newSession();
    const expected = [2, 4, 8, 16, 30];
    for (const [i, min] of expected.entries()) {
      expect((await repo.adoptNext(ME, null, TTL))?.id).toBe(id);
      const r = await row(id);
      expect(r.adoptFailures).toBe(i + 1);
      expect(Math.abs(r.nextAdoptAt!.getTime() - Date.now() - min * MIN)).toBeLessThan(10_000);
      await prisma.session.update({ where: { id }, data: { leaseUntil: past(), nextAdoptAt: past() } });
    }
    expect(await repo.adoptNext(ME, null, TTL)).toBeNull();
  });
});

describe('failExhausted', () => {
  it('esgotada sem lease vivo e com pedido → FAILED, pedido nulo, updatedAt novo', async () => {
    const id = await newSession({ adoptFailures: 5, ownerWorkerId: OTHER, leaseUntil: past(), updatedAt: past(MIN) });
    const before = await row(id);
    expect(await repo.failExhausted()).toEqual([{ id, tenantId }]);
    const r = await row(id);
    expect(r.status).toBe('FAILED');
    expect(r.connectRequestedAt).toBeNull();
    expect(r.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(Math.abs(r.updatedAt.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('fora: abaixo do teto, lease vivo, sem pedido, apagada', async () => {
    const ids = [
      await newSession({ adoptFailures: 4 }),
      await newSession({ adoptFailures: 5, ownerWorkerId: ME, leaseUntil: future(TTL) }),
      await newSession({ adoptFailures: 5, connectRequestedAt: null }),
      await newSession({ adoptFailures: 5, deletedAt: new Date() }),
    ];
    expect(await repo.failExhausted()).toEqual([]);
    for (const id of ids) expect((await row(id)).status).toBe('DISCONNECTED');
  });
});

describe('resetFailures', () => {
  it('zera contador e backoff', async () => {
    const id = await newSession({ adoptFailures: 3, nextAdoptAt: future() });
    await repo.resetFailures(id);
    const r = await row(id);
    expect(r.adoptFailures).toBe(0);
    expect(r.nextAdoptAt).toBeNull();
  });

  it('já zerados → nenhuma escrita (xmin inalterado)', async () => {
    const id = await newSession();
    const xmin = async () =>
      (await prisma.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM "sessions" WHERE "id" = ${id}`)[0]!.x;
    const before = await xmin();
    await repo.resetFailures(id);
    expect(await xmin()).toBe(before);
  });
});

describe('countAwaitingCapacity', () => {
  it('conta pedido vivo, status da lista, tenant ACTIVE, sem lease vivo', async () => {
    await newSession();
    await newSession({ status: 'CONNECTED', ownerWorkerId: OTHER, leaseUntil: past() });
    await newSession({ connectRequestedAt: past(10_000) });
    await newSession({ tenantId: suspendedId });
    await newSession({ deletedAt: new Date() });
    await newSession({ status: 'AWAITING_QR' });
    await newSession({ connectRequestedAt: null });
    await newSession({ ownerWorkerId: OTHER, leaseUntil: future(TTL) });
    expect(await repo.countAwaitingCapacity()).toBe(3);
    expect(await repo.countAwaitingCapacity(30_000)).toBe(2);
    expect(await repo.countAwaitingCapacity(10 * MIN)).toBe(0);
  });
});
