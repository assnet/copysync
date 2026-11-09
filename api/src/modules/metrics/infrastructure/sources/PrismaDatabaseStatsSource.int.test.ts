import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaDatabaseStatsSource, STATEMENT_SHAPE_MAX, statementTimeout } from './PrismaDatabaseStatsSource';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaDatabaseStatsSource', () => {
  it('statement_timeout de 2 s é efetivo dentro da transação: pg_sleep(3) aborta', async () => {
    const started = Date.now();
    await expect(prisma.$transaction([statementTimeout(prisma), prisma.$queryRaw`SELECT pg_sleep(3)`])).rejects.toThrow(/statement timeout|canceling statement/i);
    expect(Date.now() - started).toBeLessThan(2_900);
  });

  it('SET LOCAL não vaza para a conexão depois da transação', async () => {
    await prisma.$transaction([statementTimeout(prisma), prisma.$queryRaw`SELECT 1`]);
    const [row] = await prisma.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    expect(row!.statement_timeout).not.toBe('2s');
  });

  it('lê pg_stat_database e pg_stat_activity; statements só com a extensão, sem erro sem ela', async () => {
    const out = await new PrismaDatabaseStatsSource(prisma).read();
    const metrics = new Set(out.map((r) => r.metric));
    for (const m of ['db_connections', 'db_xact_commit', 'db_cache_hit_pct', 'db_active', 'db_idle_in_transaction']) {
      expect(metrics.has(m)).toBe(true);
    }
    expect(out.every((r) => r.source === 'postgres' && Number.isFinite(r.value))).toBe(true);
    const [ext] = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS ok`;
    const statements = out.filter((r) => r.metric === 'db_statement_total_ms');
    if (!ext!.ok) expect(statements).toEqual([]);
    for (const s of statements) expect(String(s.meta?.shape ?? '').length).toBeLessThanOrEqual(STATEMENT_SHAPE_MAX);
  });

  it('conta conexões idle in transaction', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const tx = prisma.$transaction(async (t) => {
      await t.$queryRaw`SELECT 1`;
      await hold;
    }, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 200));
    const out = await new PrismaDatabaseStatsSource(prisma).read();
    release();
    await tx;
    expect(out.find((r) => r.metric === 'db_idle_in_transaction')!.value).toBeGreaterThanOrEqual(1);
  });
});
