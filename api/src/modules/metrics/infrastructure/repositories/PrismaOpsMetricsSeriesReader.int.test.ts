import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { PrismaOpsMetricsSampleRepository } from './PrismaOpsMetricsSampleRepository';

/* Leitura agregada do dashboard (`/series`, `/latest`) contra Postgres descartável. */
const repo = new PrismaOpsMetricsSampleRepository(prisma);
const T = (iso: string) => new Date(iso);
const s = (metric: string, at: string, value: number, resource = 'srv-a', source: OpsMetricSample['source'] = 'render', meta: OpsMetricSample['meta'] = null): OpsMetricSample =>
  ({ at: T(at), source, resource, metric, value, meta });

beforeEach(async () => {
  await prisma.opsMetricsSample.deleteMany({});
});
afterAll(async () => {
  await prisma.opsMetricsSample.deleteMany({});
  await prisma.$disconnect();
});

describe('PrismaOpsMetricsSampleRepository — leitura agregada', () => {
  it('aggregate: baldes UTC alinhados, avg/min/max, filtro de métrica, recurso e janela fechada', async () => {
    await repo.insertMany([
      s('cpu_pct', '2026-11-09T10:00:00Z', 10),
      s('cpu_pct', '2026-11-09T10:05:00Z', 20),
      s('cpu_pct', '2026-11-09T10:10:00Z', 60),
      s('cpu_pct', '2026-11-09T10:15:00Z', 40),
      s('cpu_pct', '2026-11-09T10:15:00Z', 99, 'srv-b'),
      s('memory_pct', '2026-11-09T10:05:00Z', 50),
      s('db_idle', '2026-11-09T10:05:00Z', 7, 'copysync', 'postgres'),
      s('cpu_pct', '2026-11-09T09:59:59.999Z', 1000), // fora da janela
    ]);
    const window = { from: T('2026-11-09T10:00:00Z'), to: T('2026-11-09T10:15:00Z'), bucketMinutes: 15 };
    const rows = await repo.aggregate({ metrics: ['cpu_pct', 'memory_pct'], resource: null, ...window });
    expect(rows).toEqual([
      { source: 'render', resource: 'srv-a', metric: 'cpu_pct', at: T('2026-11-09T10:00:00Z'), avg: 30, min: 10, max: 60 },
      { source: 'render', resource: 'srv-a', metric: 'cpu_pct', at: T('2026-11-09T10:15:00Z'), avg: 40, min: 40, max: 40 },
      { source: 'render', resource: 'srv-a', metric: 'memory_pct', at: T('2026-11-09T10:00:00Z'), avg: 50, min: 50, max: 50 },
      { source: 'render', resource: 'srv-b', metric: 'cpu_pct', at: T('2026-11-09T10:15:00Z'), avg: 99, min: 99, max: 99 },
    ]);
    const onlyB = await repo.aggregate({ metrics: ['cpu_pct'], resource: 'srv-b', ...window });
    expect(onlyB.map((r) => r.resource)).toEqual(['srv-b']);
    expect(await repo.aggregate({ metrics: [], resource: null, ...window })).toEqual([]);
  });

  it('fuso: TimeZone da sessão em São Paulo não desloca corte nem balde', async () => {
    await repo.insertMany([
      s('cpu_pct', '2026-11-09T02:30:00Z', 10), // 23:30 do dia 8 em São Paulo
      s('cpu_pct', '2026-11-09T03:10:00Z', 30),
      s('cpu_pct', '2026-11-09T01:59:00Z', 999), // antes do from
    ]);
    const filter = { metrics: ['cpu_pct'], resource: null, from: T('2026-11-09T02:00:00Z'), to: T('2026-11-09T04:00:00Z'), bucketMinutes: 60 };
    const utc = await repo.aggregate(filter);
    const [{ db, tz: prevTz }] = await prisma.$queryRaw<{ db: string; tz: string }[]>`
      SELECT current_database() AS db, current_setting('TimeZone') AS tz`;
    const setDbTz = (tz: string) => prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO '${tz.replace(/'/g, "''")}'`);
    await setDbTz('America/Sao_Paulo');
    try {
      await prisma.$disconnect(); // nova conexão herda o TimeZone do banco
      const tzRow = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
      expect(tzRow[0]!.tz).toBe('America/Sao_Paulo');
      const sp = await repo.aggregate(filter);
      expect(sp).toEqual(utc);
      expect(sp.map((r) => [r.at.toISOString(), r.avg])).toEqual([
        ['2026-11-09T02:00:00.000Z', 10],
        ['2026-11-09T03:00:00.000Z', 30],
      ]);
      const latest = await repo.latestSince(T('2026-11-09T03:00:00Z'));
      expect(latest.map((r) => [r.at.toISOString(), r.value])).toEqual([['2026-11-09T03:10:00.000Z', 30]]);
    } finally {
      await setDbTz(prevTz); // devolve o fuso do banco descartável (o script fixa UTC)
      await prisma.$disconnect();
    }
  });

  it('latestSince: última por (resource, metric), sem db_statement_total_ms; snapshot de consultas = último at', async () => {
    await repo.insertMany([
      s('cpu_pct', '2026-11-09T11:50:00Z', 1),
      s('cpu_pct', '2026-11-09T11:55:00Z', 2),
      s('cpu_pct', '2026-11-09T11:55:00Z', 3, 'srv-b'),
      s('cpu_pct', '2026-11-09T11:30:00Z', 4, 'srv-c'), // antes do since
      s('db_statement_total_ms', '2026-11-09T11:50:00Z', 500, '1', 'postgres', { calls: 1, meanMs: 500, shape: 'old' }),
      s('db_statement_total_ms', '2026-11-09T11:55:00Z', 10, '2', 'postgres', { calls: 2, meanMs: 5, shape: 'SELECT $1' }),
      s('db_statement_total_ms', '2026-11-09T11:55:00Z', 90, '3', 'postgres'),
    ]);
    const latest = await repo.latestSince(T('2026-11-09T11:45:00Z'));
    expect(latest.map((r) => [r.resource, r.metric, r.value, r.at.toISOString()])).toEqual([
      ['srv-a', 'cpu_pct', 2, '2026-11-09T11:55:00.000Z'],
      ['srv-b', 'cpu_pct', 3, '2026-11-09T11:55:00.000Z'],
    ]);
    const snap = await repo.latestStatementSnapshot();
    expect(snap.map((r) => [r.resource, r.value])).toEqual([['3', 90], ['2', 10]]);
    expect(snap[1]!.meta).toEqual({ calls: 2, meanMs: 5, shape: 'SELECT $1' });
  });

  it('latestStatementSnapshot vazio sem dados', async () => {
    expect(await repo.latestStatementSnapshot()).toEqual([]);
  });
});
