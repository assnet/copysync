import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageKey } from '../../domain/services/featureUsageCatalog';
import { PrismaDailyFeatureUsageReader } from './PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './PrismaFeatureUsageDailyRepository';
import { PrismaFeatureUsageRollupStateRepository } from './PrismaFeatureUsageRollupStateRepository';
import { createReadBudget } from './featureUsageReadTimeout';

/**
 * Agregado diário contra o Postgres descartável, com a sessão do banco em `America/Sao_Paulo` (≠ UTC).
 * Cada teste usa chaves próprias (prefixo único) para não depender da ordem.
 */
const s = `fud${Date.now().toString(36)}`;
const A = `${s}-ta`;
const B = `${s}-tb`;
let dbName = '';
let tick = Date.parse('2026-11-10T12:00:00Z');
const clock = () => new Date((tick += 1000));
const repo = new PrismaFeatureUsageDailyRepository(prisma, { now: clock });
const reader = new PrismaDailyFeatureUsageReader(prisma);
const key = (k: string) => `${s}:${k}`;

type Stored = { day: string; tenantId: string; featureKey: string; kind: string; uses: number; updatedAt: string };
const rowsOf = (...keys: string[]) =>
  prisma.$queryRawUnsafe<Stored[]>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, "tenantId", "featureKey", kind, uses,
            to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "updatedAt"
     FROM feature_usage_daily WHERE "featureKey" = ANY($1::text[]) ORDER BY day, "tenantId", "featureKey", kind`,
    keys,
  );
const strip = (rows: Stored[]) => rows.map(({ updatedAt: _u, ...r }) => r);

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  for (const t of [A, B]) await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, slug, "updatedAt") VALUES ('${t}', 'x', '${t}', now())`);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM platform_settings WHERE key = 'feature_usage_cutover'`);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id LIKE '${s}-%'`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('PrismaFeatureUsageDailyRepository', () => {
  it('replaceDay grava, é idempotente, apaga o que zerou e muda updatedAt a cada gravação', async () => {
    const k1 = key('r1');
    const k2 = key('r2');
    await repo.replaceDay('2026-11-01', [k1, k2], [
      { tenantId: A, featureKey: k1, kind: 'ACTION', uses: 3 },
      { tenantId: B, featureKey: k1, kind: 'ACTION', uses: 1 },
      { tenantId: A, featureKey: k2, kind: 'AUTOMATIC', uses: 5 },
    ]);
    const first = await rowsOf(k1, k2);
    expect(strip(first)).toEqual([
      { day: '2026-11-01', tenantId: A, featureKey: k1, kind: 'ACTION', uses: 3 },
      { day: '2026-11-01', tenantId: A, featureKey: k2, kind: 'AUTOMATIC', uses: 5 },
      { day: '2026-11-01', tenantId: B, featureKey: k1, kind: 'ACTION', uses: 1 },
    ]);

    await repo.replaceDay('2026-11-01', [k1, k2], [
      { tenantId: A, featureKey: k1, kind: 'ACTION', uses: 3 },
      { tenantId: B, featureKey: k1, kind: 'ACTION', uses: 1 },
      { tenantId: A, featureKey: k2, kind: 'AUTOMATIC', uses: 5 },
    ]);
    const second = await rowsOf(k1, k2);
    expect(strip(second)).toEqual(strip(first));
    expect(second[0]!.updatedAt > first[0]!.updatedAt).toBe(true);

    // B zerou em k1 e k2 inteiro zerou (uses 0 também conta como zerado)
    await repo.replaceDay('2026-11-01', [k1, k2], [
      { tenantId: A, featureKey: k1, kind: 'ACTION', uses: 4 },
      { tenantId: A, featureKey: k2, kind: 'AUTOMATIC', uses: 0 },
    ]);
    expect(strip(await rowsOf(k1, k2))).toEqual([{ day: '2026-11-01', tenantId: A, featureKey: k1, kind: 'ACTION', uses: 4 }]);

    await repo.replaceDay('2026-11-01', [k1], []);
    expect(await rowsOf(k1)).toEqual([]);
  });

  it('replaceDay não toca nem apaga chave fora de keys (o +1 do contador sobrevive)', async () => {
    const live = key('live');
    const counted = key('counted');
    await repo.increment({ tenantId: A, featureKey: counted, kind: 'ACTION', at: new Date('2026-11-02T15:00:00Z') });
    await repo.replaceDay('2026-11-02', [live], [{ tenantId: A, featureKey: live, kind: 'ACTION', uses: 2 }]);
    await repo.replaceDay('2026-11-02', [live], []);
    expect(strip(await rowsOf(live, counted))).toEqual([{ day: '2026-11-02', tenantId: A, featureKey: counted, kind: 'ACTION', uses: 1 }]);
  });

  it('replaceDay nunca grava nem apaga chave em dia ≥ corte gravado (corte chegou depois de o job ler o estado)', async () => {
    const story = key('cut');
    const other = key('nocut');
    // O job leu o estado sem corte; o contador grava o corte e conta no dia do corte antes do replaceDay
    await new PrismaFeatureUsageRollupStateRepository(prisma).claimCutover(story, '2026-11-05');
    await repo.increment({ tenantId: A, featureKey: story, kind: 'ACTION', at: new Date('2026-11-05T15:00:00Z') });
    await repo.replaceDay('2026-11-05', [story, other], [
      { tenantId: A, featureKey: story, kind: 'ACTION', uses: 4 },
      { tenantId: B, featureKey: story, kind: 'ACTION', uses: 2 },
      { tenantId: A, featureKey: other, kind: 'ACTION', uses: 3 },
    ]);
    await repo.replaceDay('2026-11-04', [story], [{ tenantId: B, featureKey: story, kind: 'ACTION', uses: 5 }]);
    expect(strip(await rowsOf(story, other))).toEqual([
      { day: '2026-11-04', tenantId: B, featureKey: story, kind: 'ACTION', uses: 5 },
      { day: '2026-11-05', tenantId: A, featureKey: story, kind: 'ACTION', uses: 1 },
      { day: '2026-11-05', tenantId: A, featureKey: other, kind: 'ACTION', uses: 3 },
    ]);
  });

  it('replaceDay com falha depois do DELETE deixa o dia exatamente como estava', async () => {
    const k = key('tx');
    await repo.replaceDay('2026-11-03', [k], [
      { tenantId: A, featureKey: k, kind: 'ACTION', uses: 2 },
      { tenantId: B, featureKey: k, kind: 'ACTION', uses: 7 },
    ]);
    const before = await rowsOf(k);
    // B some da lista (o DELETE o apagaria) e a conta inexistente faz o INSERT falhar (chave estrangeira)
    await expect(
      repo.replaceDay('2026-11-03', [k], [
        { tenantId: A, featureKey: k, kind: 'ACTION', uses: 9 },
        { tenantId: `${s}-ghost`, featureKey: k, kind: 'ACTION', uses: 1 },
      ]),
    ).rejects.toThrow();
    expect(await rowsOf(k)).toEqual(before);
  });

  it('replaceDay com 12 mil linhas (unnest, uma instrução cada): grava, regrava a metade e apaga o que zerou', async () => {
    const keys = Array.from({ length: 6_000 }, (_, i) => key(`big${i}`));
    const all = keys.flatMap((k, i) => [
      { tenantId: A, featureKey: k, kind: 'ACTION' as const, uses: i + 1 },
      { tenantId: B, featureKey: k, kind: 'ACTION' as const, uses: 1 },
    ]);
    expect(all).toHaveLength(12_000);
    await repo.replaceDay('2026-11-06', keys, all);
    const count = async () =>
      (await prisma.$queryRaw<{ n: number; sum: number }[]>`
        SELECT count(*)::int AS n, coalesce(sum(uses), 0)::int AS sum FROM feature_usage_daily
        WHERE day = '2026-11-06'::date AND "featureKey" = ANY(${keys}::text[])`)[0]!;
    expect(await count()).toEqual({ n: 12_000, sum: (6_000 * 6_001) / 2 + 6_000 });
    // Só A fica (B zerou em todas): 6 mil apagadas no mesmo replace
    await repo.replaceDay('2026-11-06', keys, all.filter((r) => r.tenantId === A).map((r) => ({ ...r, uses: 2 })));
    expect(await count()).toEqual({ n: 6_000, sum: 12_000 });
  }, 60_000);

  it('replaceDay recusa linha com chave fora de keys sem ir ao banco', async () => {
    const spy = vi.spyOn(prisma, '$transaction');
    await expect(repo.replaceDay('2026-11-04', [key('a')], [{ tenantId: A, featureKey: key('b'), kind: 'ACTION', uses: 1 }])).rejects.toThrow(
      /outside keys/,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('20 increment concorrentes somam 20 e 20 markOnce concorrentes deixam uses = 1', async () => {
    const inc = key('inc');
    const once = key('once');
    const at = new Date('2026-11-05T12:00:00Z');
    await Promise.all(Array.from({ length: 20 }, () => repo.increment({ tenantId: A, featureKey: inc, kind: 'ACTION', at })));
    await Promise.all(Array.from({ length: 20 }, () => repo.markOnce({ tenantId: A, featureKey: once, kind: 'ACCESS', at })));
    expect(strip(await rowsOf(inc, once)).map((r) => [r.featureKey, r.uses])).toEqual([
      [inc, 20],
      [once, 1],
    ]);
  });

  it('o dia gravado é o de Brasília: 00:30 UTC entra no dia anterior; tipos diferentes convivem no mesmo dia', async () => {
    const k = key('tz');
    await repo.increment({ tenantId: A, featureKey: k, kind: 'ACTION', at: new Date('2026-11-07T00:30:00Z') });
    await repo.increment({ tenantId: A, featureKey: k, kind: 'AUTOMATIC', at: new Date('2026-11-06T20:00:00Z') });
    expect(strip(await rowsOf(k))).toEqual([
      { day: '2026-11-06', tenantId: A, featureKey: k, kind: 'ACTION', uses: 1 },
      { day: '2026-11-06', tenantId: A, featureKey: k, kind: 'AUTOMATIC', uses: 1 },
    ]);
  });

  it('oldestDay lê o agregado', async () => {
    const k = key('old');
    await repo.replaceDay('2026-10-20', [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses: 1 }]);
    await repo.replaceDay('2026-10-22', [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses: 1 }]);
    expect(await repo.oldestDay([k])).toBe('2026-10-20');
    expect(await repo.oldestDay([key('nada')])).toBeNull();
    expect(await repo.oldestDay([])).toBeNull();
  });

  it('purgeBefore apaga em lotes de ctid, cada um com statement_timeout, e para no teto de lotes', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO feature_usage_daily (day, "tenantId", "featureKey", kind, uses, "updatedAt")
      SELECT DATE '2000-01-01' + (g % 300), '${A}', '${s}:p' || g, 'ACTION', 1, now() FROM generate_series(1, 12000) g`);
    const keep = key('keep');
    await repo.replaceDay('2001-01-01', [keep], [{ tenantId: A, featureKey: keep, kind: 'ACTION', uses: 1 }]);

    const small = new PrismaFeatureUsageDailyRepository(prisma, { retentionBatchSize: 5_000, retentionMaxBatches: 2 });
    const spy = vi.spyOn(prisma, '$executeRawUnsafe');
    expect(await small.purgeBefore('2001-01-01')).toBe(10_000);
    expect(spy.mock.calls.filter(([sql]) => String(sql).includes("statement_timeout = '2s'"))).toHaveLength(2);
    expect(await repo.purgeBefore('2001-01-01')).toBe(2_000);
    expect(await repo.purgeBefore('2001-01-01')).toBe(0);
    expect(await rowsOf(keep)).toHaveLength(1);
  });
});

describe('PrismaDailyFeatureUsageReader', () => {
  const read = (keys: string[], from: string, toExclusive: string, granularity: 'day' | 'week' | 'month') =>
    reader.read({
      from: new Date(from),
      toExclusive: new Date(toExclusive),
      featureKeys: keys as FeatureUsageKey[],
      granularity,
      budget: createReadBudget(10_000),
    });

  it('devolve linha por dia só do período, com tenantId, dia em texto e contagens number', async () => {
    const k = key('rd');
    await repo.replaceDay('2026-03-01', [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses: 2 }]);
    await repo.replaceDay('2026-03-02', [k], [{ tenantId: B, featureKey: k, kind: 'ACTION', uses: 3 }]);
    await repo.replaceDay('2026-03-08', [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses: 9 }]); // fora
    await repo.replaceDay('2026-02-28', [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses: 9 }]); // fora
    // 01 a 07/03 em Brasília
    const r = await read([k], '2026-03-01T03:00:00Z', '2026-03-08T03:00:00Z', 'day');
    const sorted = [...r.rows].sort((x, y) => x.day.localeCompare(y.day));
    expect(sorted).toEqual([
      { day: '2026-03-01', tenantId: A, featureKey: k, kind: 'ACTION', uses: 2, activeDays: 1, lastDay: '2026-03-01' },
      { day: '2026-03-02', tenantId: B, featureKey: k, kind: 'ACTION', uses: 3, activeDays: 1, lastDay: '2026-03-02' },
    ]);
    expect(typeof sorted[0]!.uses).toBe('number');
    expect(r.firstDataDay[k as FeatureUsageKey]).toBe('2026-02-28');
  });

  it('400 dias por semana: uma linha por semana × conta × recurso × tipo, com soma, dias ativos e último dia', async () => {
    const k = key('wk');
    // Semana de 2025-06-02 (segunda) a 2025-06-08: três dias de A; um dia de B; outro tipo de A
    for (const [day, uses] of [['2025-06-02', 1], ['2025-06-04', 2], ['2025-06-08', 4]] as const)
      await repo.replaceDay(day, [k], [{ tenantId: A, featureKey: k, kind: 'ACTION', uses }]);
    await repo.increment({ tenantId: A, featureKey: k, kind: 'AUTOMATIC', at: new Date('2025-06-05T15:00:00Z') });
    await repo.increment({ tenantId: B, featureKey: k, kind: 'ACTION', at: new Date('2025-06-03T15:00:00Z') });
    // semana seguinte
    await repo.increment({ tenantId: A, featureKey: k, kind: 'ACTION', at: new Date('2025-06-09T15:00:00Z') });

    const r = await read([k], '2025-01-01T03:00:00Z', '2026-02-05T03:00:00Z', 'week'); // 400 dias
    const sorted = [...r.rows].sort((x, y) => `${x.day}${x.tenantId}${x.kind}`.localeCompare(`${y.day}${y.tenantId}${y.kind}`));
    expect(sorted).toEqual([
      { day: '2025-06-02', tenantId: A, featureKey: k, kind: 'ACTION', uses: 7, activeDays: 3, lastDay: '2025-06-08' },
      { day: '2025-06-02', tenantId: A, featureKey: k, kind: 'AUTOMATIC', uses: 1, activeDays: 1, lastDay: '2025-06-05' },
      { day: '2025-06-02', tenantId: B, featureKey: k, kind: 'ACTION', uses: 1, activeDays: 1, lastDay: '2025-06-03' },
      { day: '2025-06-09', tenantId: A, featureKey: k, kind: 'ACTION', uses: 1, activeDays: 1, lastDay: '2025-06-09' },
    ]);

    const m = await read([k], '2025-01-01T03:00:00Z', '2026-02-05T03:00:00Z', 'month');
    expect(m.rows.filter((x) => x.tenantId === A && x.kind === 'ACTION')).toEqual([
      { day: '2025-06-01', tenantId: A, featureKey: k, kind: 'ACTION', uses: 8, activeDays: 4, lastDay: '2025-06-09' },
    ]);
  });

  it('firstDataDay de recurso só gravado pelo contador é o menor dia dele; null sem linha', async () => {
    const counted = key('cnt');
    const empty = key('empty');
    await repo.increment({ tenantId: A, featureKey: counted, kind: 'ACTION', at: new Date('2026-04-10T12:00:00Z') });
    await repo.increment({ tenantId: B, featureKey: counted, kind: 'ACTION', at: new Date('2026-04-03T12:00:00Z') });
    const r = await read([counted, empty], '2026-04-01T03:00:00Z', '2026-04-02T03:00:00Z', 'day');
    expect(r.rows).toEqual([]);
    expect(r.firstDataDay).toEqual({ [counted]: '2026-04-03', [empty]: null });
  });

  it('acima da guarda de linhas lança indisponível', async () => {
    const k = key('guard');
    await repo.replaceDay('2026-05-01', [k], [
      { tenantId: A, featureKey: k, kind: 'ACTION', uses: 1 },
      { tenantId: B, featureKey: k, kind: 'ACTION', uses: 1 },
    ]);
    const tiny = new PrismaDailyFeatureUsageReader(prisma, 1);
    await expect(
      tiny.read({
        from: new Date('2026-05-01T03:00:00Z'),
        toExclusive: new Date('2026-05-02T03:00:00Z'),
        featureKeys: [k as FeatureUsageKey],
        granularity: 'day',
        budget: createReadBudget(10_000),
      }),
    ).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
  });
});
