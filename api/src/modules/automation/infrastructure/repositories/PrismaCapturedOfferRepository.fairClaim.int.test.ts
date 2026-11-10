import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaCapturedOfferRepository } from './PrismaCapturedOfferRepository';

/**
 * Entrega C (.specs/features/monitoring-queue-isolation, T10/T11): claim justo entre tenants.
 * Claims são GLOBAIS: o banco não pode ter capturas elegíveis de outros tenants (checado no beforeEach).
 * Serial (vitest.int.config.mts). Duas conexões = dois PrismaClient.
 */
const RUN = `fairc-${Date.now().toString(36)}`;
const T0 = new Date('2026-11-01T12:00:00.000Z');
const STALE_BEFORE = () => new Date(Date.now() - 5 * 60_000);
const fair = new PrismaCapturedOfferRepository(prisma, { fairClaim: true });
const legacy = new PrismaCapturedOfferRepository(prisma);
const extra: PrismaClient[] = [];
const newClient = () => {
  const c = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });
  extra.push(c);
  return c;
};
let tenants: string[] = [];

/** Tenant `RUN-tK` (ids ordenáveis) com `count` capturas PENDING; `offsetMin` intercala capturedAt entre tenants. */
async function seedTenant(k: number, count: number, offsetMin = 0): Promise<string> {
  const id = `${RUN}-t${k}`;
  await prisma.tenant.create({ data: { id, name: id, slug: id } });
  const s = await prisma.session.create({ data: { tenantId: id, name: 'S', status: 'CONNECTED' } });
  const c = await prisma.groupMonitorConfig.create({ data: { tenantId: id, sessionId: s.id } });
  await prisma.capturedOffer.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      tenantId: id, sessionId: s.id, configId: c.id, sourceExternalMessageId: `${id}-m${String(i).padStart(3, '0')}`,
      sourceText: 'x', capturedAt: new Date(T0.getTime() + (offsetMin + i) * 60_000),
    })),
  });
  tenants.push(id);
  return id;
}

const turnOf = async (id: string) => (await prisma.tenant.findUniqueOrThrow({ where: { id } })).monitoringClaimTurn;
const pendingOf = (tenantId: string) =>
  prisma.capturedOffer.findMany({ where: { tenantId, status: 'PENDING' }, orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }] });

async function claimMany(repo: PrismaCapturedOfferRepository, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const got = await repo.claimPending(3, STALE_BEFORE());
    expect(got.length).toBeLessThanOrEqual(1);
    if (got[0]) out.push(got[0]);
  }
  return out;
}

beforeEach(async () => {
  const foreign = await prisma.capturedOffer.count({
    where: { status: { in: ['PENDING', 'PROCESSING'] }, NOT: { tenantId: { startsWith: RUN } } },
  });
  if (foreign > 0) throw new Error(`banco com ${foreign} capturas PENDING/PROCESSING de outros tenants: use banco isolado`);
});
afterEach(async () => {
  const where = { tenantId: { in: tenants } };
  await prisma.capturedOffer.deleteMany({ where });
  await prisma.groupMonitorConfig.deleteMany({ where });
  await prisma.session.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  tenants = [];
});
afterAll(async () => {
  await Promise.all(extra.map((c) => c.$disconnect()));
  await prisma.$disconnect();
});

describe('claimPending justo (MONITORING_FAIR_CLAIM_ENABLED)', () => {
  it('7 tenants, lote 3, backlog desigual: duas rodadas completas na mesma ordem, FIFO no tenant, 1 por chamada', async () => {
    // t0 tem o backlog mais antigo e maior: o FIFO global o serviria 14 vezes seguidas
    const ids = [await seedTenant(0, 30, -1000)];
    for (let k = 1; k < 7; k++) ids.push(await seedTenant(k, 3 + k, k));
    const expectedFifo = new Map<string, string[]>();
    for (const t of ids) expectedFifo.set(t, (await pendingOf(t)).slice(0, 2).map((c) => c.id));

    const got = await claimMany(fair, 14);
    expect(got).toHaveLength(14);
    const order = got.map((c) => c.tenantId);
    expect(new Set(order.slice(0, 7))).toEqual(new Set(ids));
    expect(order.slice(7)).toEqual(order.slice(0, 7));
    expect(order.slice(0, 7)).toEqual(ids); // turnos null: desempate por id
    for (const t of ids) {
      expect(got.filter((c) => c.tenantId === t).map((c) => c.id)).toEqual(expectedFifo.get(t));
      expect((await pendingOf(t)).length).toBeGreaterThan(0); // nenhum backlog consumido inteiro
    }
    expect(got.every((c) => c.status === 'PROCESSING' && c.claimToken)).toBe(true);
    const turns = await Promise.all(ids.map(turnOf));
    expect(new Set(turns.map(String)).size).toBe(7);
  });

  it('PROCESSING stale volta a ser elegível; PROCESSING recente não', async () => {
    const t = await seedTenant(0, 2);
    const [a, b] = await pendingOf(t);
    await prisma.capturedOffer.update({ where: { id: a!.id }, data: { status: 'PROCESSING', claimToken: 'old', claimedAt: new Date(Date.now() - 10 * 60_000) } });
    await prisma.capturedOffer.update({ where: { id: b!.id }, data: { status: 'PROCESSING', claimToken: 'busy', claimedAt: new Date() } });
    const [got] = await fair.claimPending(1, STALE_BEFORE());
    expect(got?.id).toBe(a!.id);
    expect(got?.claimToken).not.toBe('old');
    expect(await fair.claimPending(1, STALE_BEFORE())).toEqual([]);
    expect(await turnOf(t)).not.toBeNull();
  });

  it('duas conexões concorrentes: posse exclusiva, tokens únicos, turnos distintos e persistidos', async () => {
    const ids = [];
    for (let k = 0; k < 7; k++) ids.push(await seedTenant(k, 4 + (k % 3)));
    const total = await prisma.capturedOffer.count({ where: { tenantId: { in: ids } } });
    const other = new PrismaCapturedOfferRepository(newClient(), { fairClaim: true });
    const worker = async (repo: PrismaCapturedOfferRepository) => {
      const out = [];
      for (let misses = 0; misses < 3;) {
        const [c] = await repo.claimPending(1, STALE_BEFORE());
        if (c) out.push(c); else misses++;
      }
      return out;
    };
    const [x, y] = await Promise.all([worker(fair), worker(other)]);
    const all = [...x, ...y];
    expect(all).toHaveLength(total);
    expect(new Set(all.map((c) => c.id)).size).toBe(total);
    expect(new Set(all.map((c) => c.claimToken)).size).toBe(total);
    expect(x.length).toBeGreaterThan(0);
    expect(y.length).toBeGreaterThan(0);
    const turns = await Promise.all(ids.map(turnOf));
    expect(turns.every((v) => v !== null)).toBe(true);
    expect(new Set(turns.map(String)).size).toBe(7);
  });

  it('restart: novo processo continua pelos turnos persistidos', async () => {
    const ids = [];
    for (let k = 0; k < 7; k++) ids.push(await seedTenant(k, 3));
    const first = await claimMany(fair, 3);
    const restarted = new PrismaCapturedOfferRepository(newClient(), { fairClaim: true });
    const next = await claimMany(restarted, 4);
    expect(first.map((c) => c.tenantId)).toEqual(ids.slice(0, 3));
    expect(next.map((c) => c.tenantId)).toEqual(ids.slice(3));
    expect((await claimMany(restarted, 1))[0]?.tenantId).toBe(ids[0]);
  });

  it('rollback: falha no UPDATE da captura não avança o turno nem muda a captura', async () => {
    const t = await seedTenant(0, 2);
    const fn = `${RUN.replace(/-/g, '_')}_fail`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."tenantId" = '${t}' AND NEW."status" = 'PROCESSING' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fn}" BEFORE UPDATE ON "captured_offers" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
    try {
      await expect(fair.claimPending(1, STALE_BEFORE())).rejects.toThrow(/falha simulada/);
      expect(await turnOf(t)).toBeNull();
      expect(await pendingOf(t)).toHaveLength(2);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "captured_offers"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
    expect(await fair.claimPending(1, STALE_BEFORE())).toHaveLength(1);
    expect(await turnOf(t)).not.toBeNull();
  });

  it('timeout explícito: tabela travada falha rápido, sem avançar turno', async () => {
    const t = await seedTenant(0, 1);
    const locker = newClient();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const tx = locker.$transaction(async (q) => {
      await q.$executeRawUnsafe('LOCK TABLE "captured_offers" IN ACCESS EXCLUSIVE MODE');
      locked();
      await held;
    }, { timeout: 20_000 });
    await isLocked;
    const t1 = Date.now();
    await expect(fair.claimPending(1, STALE_BEFORE())).rejects.toThrow();
    expect(Date.now() - t1).toBeLessThan(2_000);
    release();
    await tx;
    expect(await turnOf(t)).toBeNull();
  });

  it('captura indisponível (linha travada): nada obtido e turno intacto; atendida após liberar', async () => {
    const t = await seedTenant(0, 1);
    const [c] = await pendingOf(t);
    const locker = newClient();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const tx = locker.$transaction(async (q) => {
      await q.$queryRawUnsafe('SELECT 1 FROM "captured_offers" WHERE "id" = $1 FOR UPDATE', c!.id);
      locked();
      await held;
    }, { timeout: 20_000 });
    await isLocked;
    expect(await fair.claimPending(1, STALE_BEFORE())).toEqual([]);
    expect(await turnOf(t)).toBeNull();
    release();
    await tx;
    expect((await fair.claimPending(1, STALE_BEFORE()))[0]?.id).toBe(c!.id);
  });

  it('contenção: tenant travado (billing) é pulado sem esperar, sem avançar turno; atendido ao liberar', async () => {
    const ids = [];
    for (let k = 0; k < 7; k++) ids.push(await seedTenant(k, 3));
    const blocked = ids[0]!;
    const locker = newClient();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const tx = locker.$transaction(async (q) => {
      // mesmo lock de ApplyBillingEventUseCase/PrismaBillingReconcileRepository
      await q.$queryRawUnsafe('SELECT "id" FROM "tenants" WHERE "id" = $1 FOR UPDATE', blocked);
      locked();
      await held;
    }, { timeout: 20_000 });
    await isLocked;
    const t1 = Date.now();
    const during = await claimMany(fair, 8);
    expect(Date.now() - t1).toBeLessThan(5_000);
    expect(during.map((c) => c.tenantId)).not.toContain(blocked);
    expect(new Set(during.slice(0, 6).map((c) => c.tenantId))).toEqual(new Set(ids.slice(1)));
    expect(await turnOf(blocked)).toBeNull();
    expect(await pendingOf(blocked)).toHaveLength(3);
    release();
    await tx;
    expect((await fair.claimPending(1, STALE_BEFORE()))[0]?.tenantId).toBe(blocked);
  });

  it('flag false (padrão): FIFO global de hoje, lote inteiro, sem tocar turnos', async () => {
    const heavy = await seedTenant(0, 5, -100);
    const light = await seedTenant(1, 2);
    const got = await legacy.claimPending(3, STALE_BEFORE());
    expect(got.map((c) => c.tenantId)).toEqual([heavy, heavy, heavy]);
    expect(await turnOf(heavy)).toBeNull();
    expect(await turnOf(light)).toBeNull();
  });
});
