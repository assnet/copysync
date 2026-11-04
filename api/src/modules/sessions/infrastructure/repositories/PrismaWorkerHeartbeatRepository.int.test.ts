import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaWorkerHeartbeatRepository } from './PrismaWorkerHeartbeatRepository';

/** Heartbeat dos workers (ADOPT-10/12) contra Postgres local: relógio do banco. */
const repo = new PrismaWorkerHeartbeatRepository();
const ALIVE_MS = 90_000;
const base = { role: 'worker', sessions: 3, maxSessions: 40, rssMb: 512 };
const ago = (ms: number) => new Date(Date.now() - ms);
const plant = (workerId: string, seenAt: Date) =>
  prisma.workerHeartbeat.create({ data: { workerId, ...base, seenAt } });

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({});
});
afterAll(async () => {
  await prisma.workerHeartbeat.deleteMany({});
  await prisma.$disconnect();
});

describe('beat', () => {
  it('upsert idempotente: uma linha por worker, campos e seenAt atualizados', async () => {
    await repo.beat({ workerId: 'w1', ...base });
    const first = await prisma.workerHeartbeat.findUniqueOrThrow({ where: { workerId: 'w1' } });
    expect(Math.abs(first.seenAt.getTime() - Date.now())).toBeLessThan(10_000);
    await repo.beat({ workerId: 'w1', ...base, role: 'all', sessions: 7, rssMb: 600 });
    const rows = await prisma.workerHeartbeat.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workerId: 'w1', role: 'all', sessions: 7, maxSessions: 40, rssMb: 600 });
    expect(rows[0]!.seenAt.getTime()).toBeGreaterThanOrEqual(first.seenAt.getTime());
  });

  it('apaga linhas mortas há > 1 dia e mantém as recentes', async () => {
    await plant('dead', ago(25 * 3_600_000));
    await plant('old-but-kept', ago(2 * 3_600_000));
    await repo.beat({ workerId: 'w1', ...base });
    const ids = (await prisma.workerHeartbeat.findMany()).map((r) => r.workerId).sort();
    expect(ids).toEqual(['old-but-kept', 'w1']);
  });
});

describe('listAlive', () => {
  it('exclui batimento mais velho que maxAgeMs', async () => {
    await repo.beat({ workerId: 'w-alive', ...base });
    await plant('w-stale', ago(120_000));
    const alive = await repo.listAlive(ALIVE_MS);
    expect(alive.map((r) => r.workerId)).toEqual(['w-alive']);
    expect(alive[0]).toMatchObject({ role: 'worker', sessions: 3, maxSessions: 40, rssMb: 512 });
    expect(alive[0]!.seenAt).toBeInstanceOf(Date);
  });

  it('tabela vazia → []', async () => {
    expect(await repo.listAlive(ALIVE_MS)).toEqual([]);
  });
});

describe('remove', () => {
  it('apaga só o id pedido', async () => {
    await repo.beat({ workerId: 'w1', ...base });
    await repo.beat({ workerId: 'w2', ...base });
    await repo.remove('w1');
    expect((await prisma.workerHeartbeat.findMany()).map((r) => r.workerId)).toEqual(['w2']);
  });

  it('id inexistente → sem erro e sem efeito', async () => {
    await repo.beat({ workerId: 'w1', ...base });
    await repo.remove('nope');
    expect(await prisma.workerHeartbeat.count()).toBe(1);
  });
});
