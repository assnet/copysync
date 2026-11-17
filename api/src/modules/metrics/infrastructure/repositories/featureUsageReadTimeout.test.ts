import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { FEATURE_USAGE_CATALOG } from '../../domain/services/featureUsageCatalog';
import { FEATURE_USAGE_SOURCES, FIRST_DATA_DAYS_SQL, PrismaLiveFeatureUsageReader, firstDataDaysSql } from './PrismaLiveFeatureUsageReader';
import { ProcessUsageReadGate, createReadBudget, runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

type Call = { set: string; query: Prisma.Sql };

/** Dublê do Prisma: cada `$transaction` vira uma chamada registrada; `answer` decide o resultado. */
function fakePrisma(answer: (call: Call, index: number) => Promise<unknown[]> = () => Promise.resolve([])) {
  const calls: Call[] = [];
  const prisma = {
    $executeRawUnsafe: (sql: string) => ({ set: sql }),
    $queryRaw: (sql: Prisma.Sql) => ({ query: sql }),
    $transaction: (ops: [{ set: string }, { query: Prisma.Sql }]) => {
      const call = { set: ops[0].set, query: ops[1].query };
      calls.push(call);
      return answer(call, calls.length - 1).then((rows) => [0, rows]);
    },
  } as unknown as UsageReadPrisma;
  return { prisma, calls };
}

const clockAt = (start: number) => {
  const c = { now: start };
  return { c, clock: () => c.now };
};
const never = () => new Promise<unknown[]>(() => undefined);
const Q = Prisma.sql`SELECT 1`;

describe('runWithinBudget', () => {
  it('orçamento já gasto (2 s) lança sem ir ao banco', async () => {
    const { c, clock } = clockAt(0);
    const budget = createReadBudget(2000, clock);
    c.now = 2000;
    const { prisma, calls } = fakePrisma();
    await expect(runWithinBudget(budget, prisma, Q)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it('menos de 1 ms restante lança sem ir ao banco (nunca SET 0)', async () => {
    const { c, clock } = clockAt(0);
    const budget = createReadBudget(2000, clock);
    c.now = 1999.4;
    const { prisma, calls } = fakePrisma();
    await expect(runWithinBudget(budget, prisma, Q)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it('SET LOCAL leva o restante em ms inteiro, uma transação por instrução', async () => {
    const { c, clock } = clockAt(0);
    const budget = createReadBudget(2000, clock);
    const { prisma, calls } = fakePrisma(() => Promise.resolve([{ x: 1 }]));
    c.now = 765.3;
    expect(await runWithinBudget(budget, prisma, Q)).toEqual([{ x: 1 }]);
    c.now = 1500.9;
    await runWithinBudget(budget, prisma, Q);
    expect(calls.map((x) => x.set)).toEqual(['SET LOCAL statement_timeout = 1234', 'SET LOCAL statement_timeout = 499']);
  });

  it('leitura que nunca resolve (espera por conexão) lança quando o temporizador vence', async () => {
    const budget = createReadBudget(30);
    const { prisma } = fakePrisma(never);
    await expect(runWithinBudget(budget, prisma, Q)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
  });

  it('SQLSTATE 57014 vira UsageMetricsReadUnavailableError; outro erro propaga', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `57014`', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '57014' },
    });
    const a = fakePrisma(() => Promise.reject(timeout));
    await expect(runWithinBudget(createReadBudget(), a.prisma, Q)).rejects.toBeInstanceOf(UsageMetricsReadUnavailableError);
    const boom = new Error('boom');
    const b = fakePrisma(() => Promise.reject(boom));
    await expect(runWithinBudget(createReadBudget(), b.prisma, Q)).rejects.toBe(boom);
  });
});

describe('usageReadGate', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const hold = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    return { p, release: () => release() };
  };

  it('segunda leitura espera a vaga e conclui (FIFO)', async () => {
    const gate = new ProcessUsageReadGate();
    const a = hold();
    const order: string[] = [];
    const first = gate.runExclusive(() => a.p.then(() => order.push('1')));
    const second = gate.runExclusive(async () => order.push('2'));
    const third = gate.runExclusive(async () => order.push('3'));
    await tick();
    expect(gate.waiting).toBe(2);
    expect(order).toEqual([]);
    a.release();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['1', '2', '3']);
    await tick();
    expect(gate.waiting).toBe(0);
    await expect(gate.runExclusive(async () => 'ok')).resolves.toBe('ok');
  });

  it('quinta na fila recebe 503 na hora sem tocar o prisma', async () => {
    const gate = new ProcessUsageReadGate();
    const a = hold();
    const first = gate.runExclusive(() => a.p);
    const queued = [1, 2, 3, 4].map((n) => gate.runExclusive(async () => n));
    expect(gate.waiting).toBe(4);
    const { prisma, calls } = fakePrisma();
    await expect(gate.runExclusive((b) => runWithinBudget(b, prisma, Q))).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
    expect(calls).toHaveLength(0);
    expect(gate.waiting).toBe(4);
    a.release();
    await first;
    await expect(Promise.all(queued)).resolves.toEqual([1, 2, 3, 4]);
  });

  it('espera que estoura o orçamento recebe 503, sai da fila e não deixa temporizador', async () => {
    vi.useFakeTimers();
    try {
      const gate = new ProcessUsageReadGate(() => createReadBudget(2000));
      const a = hold();
      const first = gate.runExclusive(() => a.p);
      const late = gate.runExclusive(async () => 'nunca');
      const caught = late.catch((e: unknown) => e);
      expect(gate.waiting).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await caught).toBeInstanceOf(UsageMetricsReadUnavailableError);
      expect(gate.waiting).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      a.release();
      await first;
      await vi.advanceTimersByTimeAsync(0);
      await expect(gate.runExclusive(async () => 'livre')).resolves.toBe('livre');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('vaga entregue à fila limpa o temporizador da espera', async () => {
    vi.useFakeTimers();
    try {
      const gate = new ProcessUsageReadGate(() => createReadBudget(2000));
      const a = hold();
      const first = gate.runExclusive(() => a.p);
      const second = gate.runExclusive(async () => 'b');
      expect(vi.getTimerCount()).toBe(1);
      a.release();
      await first;
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBe('b');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('orçamento gasto na fila é o mesmo da leitura (começa na chegada)', async () => {
    const { c, clock } = clockAt(0);
    const gate = new ProcessUsageReadGate(() => createReadBudget(2000, clock));
    const a = hold();
    const first = gate.runExclusive(() => a.p);
    let seen = -1;
    const second = gate.runExclusive(async (b) => {
      seen = b.remainingMs();
    });
    c.now = 1500;
    a.release();
    await Promise.all([first, second]);
    expect(seen).toBe(500);
  });

  it.each([
    ['resolve', (r: { ok: () => void; fail: () => void }) => r.ok()],
    ['falha', (r: { ok: () => void; fail: () => void }) => r.fail()],
  ])('vaga fica ocupada pela instrução órfã e volta quando ela %s', async (_label, finish) => {
    const gate = new ProcessUsageReadGate(() => createReadBudget(20));
    const ctl = { ok: () => undefined, fail: () => undefined } as { ok: () => void; fail: () => void };
    const { prisma } = fakePrisma(
      () =>
        new Promise<unknown[]>((res, rej) => {
          ctl.ok = () => res([]);
          ctl.fail = () => rej(new Error('late'));
        }),
    );
    await expect(gate.runExclusive((b) => runWithinBudget(b, prisma, Q))).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
    const waiting = gate.runExclusive(async () => 'x').catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 40));
    expect(await waiting).toBeInstanceOf(UsageMetricsReadUnavailableError);
    finish(ctl);
    await new Promise((r) => setTimeout(r, 0));
    await expect(gate.runExclusive(async () => 'x')).resolves.toBe('x');
  });

  it('erro no meio da leitura devolve a vaga', async () => {
    const gate = new ProcessUsageReadGate();
    await expect(
      gate.runExclusive(async () => {
        throw new Error('meio');
      }),
    ).rejects.toThrow('meio');
    await new Promise((r) => setTimeout(r, 0));
    await expect(gate.runExclusive(async () => 1)).resolves.toBe(1);
  });
});

describe('PrismaLiveFeatureUsageReader (dublê)', () => {
  const allKeys = FEATURE_USAGE_CATALOG.map((f) => f.key);
  const input = (budget = createReadBudget()) => ({
    from: new Date('2026-11-01T03:00:00Z'),
    toExclusive: new Date('2026-11-08T03:00:00Z'),
    featureKeys: allKeys,
    granularity: 'day' as const,
    budget,
  });

  it('faz doze idas ao banco (onze de uso + primeiro dado), em sequência', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { prisma, calls } = fakePrisma(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return [];
    });
    await new PrismaLiveFeatureUsageReader(prisma).read(input());
    expect(calls).toHaveLength(12);
    expect(calls[11]!.query.sql).toBe(FIRST_DATA_DAYS_SQL.sql);
    expect(maxInFlight).toBe(1);
  });

  it('depois do estouro nenhuma instrução seguinte é iniciada', async () => {
    const { prisma, calls } = fakePrisma((_c, i) => (i === 2 ? never() : Promise.resolve([])));
    await expect(new PrismaLiveFeatureUsageReader(prisma).read(input(createReadBudget(30)))).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
    expect(calls).toHaveLength(3);
  });

  it('primeiro dado também respeita o orçamento', async () => {
    const { c, clock } = clockAt(0);
    const budget = createReadBudget(2000, clock);
    const { prisma, calls } = fakePrisma(async (_c, i) => {
      if (i === 10) c.now = 2000;
      return [];
    });
    await expect(new PrismaLiveFeatureUsageReader(prisma).read(input(budget))).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
    expect(calls).toHaveLength(11);
  });

  it('acima da guarda de 100 mil linhas lança 503', async () => {
    const many = Array.from({ length: 100_001 }, () => ({ day: '2026-11-02', tenantId: 't', uses: 1 }));
    const { prisma } = fakePrisma((_c, i) => Promise.resolve(i === 1 ? many : []));
    await expect(new PrismaLiveFeatureUsageReader(prisma).read(input())).rejects.toBeInstanceOf(
      UsageMetricsReadUnavailableError,
    );
  });

  it('mapeia contagem para number e linha por dia; fonte sem recurso pedido não é lida', async () => {
    const { prisma, calls } = fakePrisma(() => Promise.resolve([{ day: '2026-11-02', tenantId: 't', uses: 3n }]));
    const out = await new PrismaLiveFeatureUsageReader(prisma).read({ ...input(), featureKeys: ['offer_dispatch'] });
    expect(calls).toHaveLength(2);
    expect(out.rows).toEqual([
      { day: '2026-11-02', tenantId: 't', featureKey: 'offer_dispatch', kind: 'AUTOMATIC', uses: 3, activeDays: 1, lastDay: '2026-11-02' },
    ]);
    expect(out.firstDataDay).toEqual({ offer_dispatch: null });
    expect(calls[1]!.query.sql).not.toMatch(/UNION ALL/);
    expect(calls[1]!.query.sql).toMatch(/'offer_dispatch' AS key/);
  });

  it('primeiro dado só com os ramos pedidos; nenhum recurso = sem ida ao banco', async () => {
    expect(firstDataDaysSql([])).toBeNull();
    const two = firstDataDaysSql(['panel_login', 'ai_rewrite'])!.sql;
    expect(two.match(/UNION ALL/g)).toHaveLength(1);
    expect(two).toMatch(/'ai_rewrite'[\s\S]*'panel_login'/);
    const { prisma, calls } = fakePrisma();
    const out = await new PrismaLiveFeatureUsageReader(prisma).read({ ...input(), featureKeys: [] });
    expect(calls).toHaveLength(0);
    expect(out).toEqual({ rows: [], firstDataDay: {} });
  });
});

describe('SQL do uso dos recursos', () => {
  const from = new Date('2026-11-01T03:00:00Z');
  const to = new Date('2026-11-08T03:00:00Z');
  const usage = FEATURE_USAGE_SOURCES.map((s) => ({ table: s.table, sql: s.sql(from, to).sql }));
  /** Sem literais entre aspas simples (`'offer.text'`, `'YYYY-MM-DD'`) e sem casts de tipo (`::text`). */
  const strip = (sql: string) =>
    sql
      .replace(/meta->>'completed' = 'true'/g, 'COMPLETED_FLAG')
      .replace(/'[^']*'/g, "''")
      .replace(/::\w+/g, '');
  const FORBIDDEN = ['body', 'text', 'name', 'phone', 'email', 'ip', 'title', 'url', 'userAgent', 'meta'];

  it('nenhuma consulta lê coluna de conteúdo; meta só como meta->>completed', () => {
    for (const sql of [...usage.map((u) => u.sql), FIRST_DATA_DAYS_SQL.sql]) {
      const bare = strip(sql);
      for (const word of FORBIDDEN) expect(bare, word).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
    const metas = [...usage.map((u) => u.sql), FIRST_DATA_DAYS_SQL.sql].join('\n').match(/\bmeta\b[^\n]*/g) ?? [];
    expect(metas.length).toBe(2);
    for (const m of metas) expect(m.startsWith("meta->>'completed' = 'true'")).toBe(true);
  });

  it('toda consulta de uso devolve o dia pela forma única, agrupa por tenantId e conta com ::int', () => {
    expect(usage).toHaveLength(11);
    const DAY =
      /to_char\(\(\((le\.)?"(createdAt|updatedAt|startedAt)" AT TIME ZONE 'UTC'\) AT TIME ZONE 'America\/Sao_Paulo'\)::date, 'YYYY-MM-DD'\) AS day/;
    for (const { table, sql } of usage) {
      expect(sql, table).toMatch(DAY);
      expect(sql.replace(DAY, ''), table).not.toMatch(/::date/);
      expect(sql, table).toMatch(/GROUP BY day, (ut\.)?"tenantId"/);
      expect(sql, table).toMatch(/count\(\*\)::int AS uses/);
      expect(sql, table).toMatch(/::timestamptz AT TIME ZONE 'UTC'\)/);
      expect(sql, table).not.toMatch(/"userId"\s*(,|AS|FROM)/);
    }
  });

  it('primeiro dado não tem GROUP BY nem período e não devolve userId', () => {
    expect(FIRST_DATA_DAYS_SQL.sql).not.toMatch(/GROUP BY/);
    expect(FIRST_DATA_DAYS_SQL.values).toEqual([]);
    expect(FIRST_DATA_DAYS_SQL.sql.match(/UNION ALL/g)).toHaveLength(15);
  });
});
