import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionLeaseRepository } from './PrismaSessionLeaseRepository';

/** Lease de sessão (LEASE-03/04/05/09) contra Postgres local: relógio do banco. */
const repo = new PrismaSessionLeaseRepository();
const TTL = 60_000;
const ME = 'worker-me';
const OTHER = 'worker-other';
let tenantId = '';

const newSession = async (data: Record<string, unknown> = {}) =>
  (await prisma.session.create({ data: { tenantId, name: 'int-lease', ...data } })).id;
const row = (id: string) =>
  prisma.session.findUniqueOrThrow({
    where: { id },
    select: { ownerWorkerId: true, leaseUntil: true, status: true, lastDisconnectedAt: true, connectRequestedAt: true },
  });
const expire = (id: string, owner = OTHER) =>
  prisma.session.update({ where: { id }, data: { ownerWorkerId: owner, leaseUntil: new Date(Date.now() - 1_000) } });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-lease-${Date.now()}` } })).id;
});
beforeEach(async () => {
  await prisma.session.deleteMany({ where: { tenantId } });
});
afterAll(async () => {
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('tryAcquire', () => {
  it('lease livre → adquire com validade ~TTL no relógio do banco', async () => {
    const id = await newSession();
    expect(await repo.tryAcquire(id, ME, TTL)).toBe(true);
    const r = await row(id);
    expect(r.ownerWorkerId).toBe(ME);
    const left = r.leaseUntil!.getTime() - Date.now();
    expect(left).toBeGreaterThan(50_000);
    expect(left).toBeLessThan(70_000);
  });

  it('lease vencido de outro → adquire', async () => {
    const id = await newSession();
    await expire(id);
    expect(await repo.tryAcquire(id, ME, TTL)).toBe(true);
    expect((await row(id)).ownerWorkerId).toBe(ME);
  });

  it('lease próprio vivo → re-adquire e estende', async () => {
    const id = await newSession();
    await repo.tryAcquire(id, ME, 5_000);
    const before = (await row(id)).leaseUntil!;
    expect(await repo.tryAcquire(id, ME, TTL)).toBe(true);
    expect((await row(id)).leaseUntil!.getTime()).toBeGreaterThan(before.getTime());
  });

  it('lease vivo de outro → false sem alterar nada', async () => {
    const id = await newSession();
    await repo.tryAcquire(id, OTHER, TTL);
    const before = await row(id);
    expect(await repo.tryAcquire(id, ME, TTL)).toBe(false);
    expect(await row(id)).toEqual(before);
  });

  it('sessão apagada ou inexistente → false', async () => {
    const id = await newSession({ deletedAt: new Date() });
    expect(await repo.tryAcquire(id, ME, TTL)).toBe(false);
    expect((await row(id)).ownerWorkerId).toBeNull();
    expect(await repo.tryAcquire('nao-existe', ME, TTL)).toBe(false);
  });

  it('corrida de dois workers no lease livre: só um adquire', async () => {
    const id = await newSession();
    const r = await Promise.all([repo.tryAcquire(id, ME, TTL), repo.tryAcquire(id, OTHER, TTL)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});

describe('renew', () => {
  it('devolve só os ids ainda do worker; vencido e de outro não renovam', async () => {
    const mine = await newSession();
    const expired = await newSession();
    const other = await newSession();
    await repo.tryAcquire(mine, ME, 5_000);
    await expire(expired, ME);
    await repo.tryAcquire(other, OTHER, TTL);
    const before = (await row(mine)).leaseUntil!;
    expect(await repo.renew([mine, expired, other], ME, TTL)).toEqual([mine]);
    expect((await row(mine)).leaseUntil!.getTime()).toBeGreaterThan(before.getTime());
    expect((await row(expired)).leaseUntil!.getTime()).toBeLessThan(Date.now());
    expect((await row(other)).ownerWorkerId).toBe(OTHER);
  });

  it('sessão apagada com lease próprio vivo → não renova nem volta no retorno', async () => {
    const live = await newSession();
    const deleted = await newSession();
    await repo.tryAcquire(live, ME, 5_000);
    await repo.tryAcquire(deleted, ME, 5_000);
    await prisma.session.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
    const before = (await row(deleted)).leaseUntil!;
    expect(await repo.renew([live, deleted], ME, TTL)).toEqual([live]);
    expect((await row(deleted)).leaseUntil).toEqual(before);
  });

  it('lista vazia → [] sem consultar', async () => {
    expect(await repo.renew([], ME, TTL)).toEqual([]);
  });
});

describe('release', () => {
  it('dono solta; outro dono não altera nada', async () => {
    const id = await newSession();
    await repo.tryAcquire(id, OTHER, TTL);
    const before = await row(id);
    await repo.release(id, ME);
    expect(await row(id)).toEqual(before);
    await repo.release(id, OTHER);
    const r = await row(id);
    expect(r.ownerWorkerId).toBeNull();
    expect(r.leaseUntil).toBeNull();
  });
});

describe('releaseAllOwned', () => {
  it('só toca as do worker: solta, ativas viram DISCONNECTED e connectRequestedAt fica', async () => {
    const requested = new Date('2026-11-01T00:00:00Z');
    const active = await newSession({ status: 'CONNECTED', connectRequestedAt: requested });
    const qr = await newSession({ status: 'AWAITING_QR' });
    const loggedOut = await newSession({ status: 'LOGGED_OUT' });
    const others = await newSession({ status: 'CONNECTED' });
    for (const id of [active, qr, loggedOut]) await repo.tryAcquire(id, ME, TTL);
    await repo.tryAcquire(others, OTHER, TTL);
    const othersBefore = await row(others);

    expect(await repo.releaseAllOwned(ME)).toBe(3);

    const a = await row(active);
    expect(a).toMatchObject({ ownerWorkerId: null, leaseUntil: null, status: 'DISCONNECTED', connectRequestedAt: requested });
    expect(Math.abs(a.lastDisconnectedAt!.getTime() - Date.now())).toBeLessThan(10_000);
    expect(await row(qr)).toMatchObject({ ownerWorkerId: null, status: 'DISCONNECTED' });
    expect(await row(loggedOut)).toMatchObject({ ownerWorkerId: null, status: 'LOGGED_OUT', lastDisconnectedAt: null });
    expect(await row(others)).toEqual(othersBefore);
    expect(await repo.releaseAllOwned(ME)).toBe(0);
  });
});

describe('findLiveOwner', () => {
  it('lease vivo → id do dono', async () => {
    const id = await newSession();
    await repo.tryAcquire(id, OTHER, TTL);
    expect(await repo.findLiveOwner(id)).toBe(OTHER);
  });

  it('lease vencido, sem lease ou sessão inexistente → null', async () => {
    const expired = await newSession();
    await expire(expired);
    const free = await newSession();
    expect(await repo.findLiveOwner(expired)).toBeNull();
    expect(await repo.findLiveOwner(free)).toBeNull();
    expect(await repo.findLiveOwner('nao-existe')).toBeNull();
  });
});
