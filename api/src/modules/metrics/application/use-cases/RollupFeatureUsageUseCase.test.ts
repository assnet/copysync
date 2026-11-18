import { describe, expect, it, vi } from 'vitest';
import type { IJobLease, IJobLeaseRenewal } from '../../../../shared/jobs/IJobLease';
import type { FeatureUsageDayRow } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { FeatureUsageReadInput, FeatureUsageReadResult } from '../../domain/contracts/IFeatureUsageReader';
import type { FeatureUsageRollupState, IFeatureUsageRollupStateRepository } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import type { FeatureUsageDefinition } from '../../domain/services/featureUsageCatalog';
import { addDays, dayInZone } from '../../domain/services/featureUsagePeriod';
import {
  FEATURE_USAGE_BACKFILL_LEASE,
  FEATURE_USAGE_RETENTION_LEASE,
  FEATURE_USAGE_ROLLUP_LEASE,
  RollupFeatureUsageUseCase,
  type RollupFeatureUsageDeps,
} from './RollupFeatureUsageUseCase';

/** Lease com a semântica do `PrismaJobLease`: adquire se livre ou vencido (`expiresAt < now`). */
class FakeLease implements IJobLease, IJobLeaseRenewal {
  readonly held = new Map<string, { owner: string; until: Date }>();
  readonly acquired: string[] = [];
  readonly renewed: string[] = [];
  /** Simula outro processo tomando o lease: a próxima renovação desse nome falha. */
  stolen = new Set<string>();
  async renew(name: string, ownerId: string, until: Date): Promise<boolean> {
    const cur = this.held.get(name);
    if (this.stolen.has(name) || cur?.owner !== ownerId) return false;
    this.held.set(name, { owner: ownerId, until });
    this.renewed.push(name);
    return true;
  }
  async tryAcquire(name: string, ownerId: string, until: Date, now: Date): Promise<boolean> {
    const cur = this.held.get(name);
    if (cur && !(cur.until < now)) return false;
    this.held.set(name, { owner: ownerId, until });
    this.acquired.push(name);
    return true;
  }
  async release(name: string, ownerId: string): Promise<void> {
    if (this.held.get(name)?.owner === ownerId) this.held.delete(name);
  }
}

class FakeState implements IFeatureUsageRollupStateRepository {
  value: FeatureUsageRollupState = { backfillCompletedAt: null, backfilledFrom: null, backfillCursor: null, cutovers: {} };
  marks = 0;
  async get() {
    return { ...this.value };
  }
  async saveBackfillCursor(day: string) {
    this.value = { ...this.value, backfillCursor: day };
  }
  async markBackfillCompleted(m: { completedAt: Date; backfilledFrom: string }) {
    if (this.value.backfillCompletedAt) return false;
    this.marks++;
    this.value = { ...this.value, backfillCompletedAt: m.completedAt, backfilledFrom: m.backfilledFrom };
    return true;
  }
}

const budget: UsageReadBudget = { remainingMs: () => 1000, track: () => undefined, settled: async () => undefined };

const def = (key: string, extra: Partial<FeatureUsageDefinition> = {}): FeatureUsageDefinition =>
  ({ key, product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], source: 'LIVE', possibleCoverageReasons: [], phase: 1, ...extra }) as FeatureUsageDefinition;

type Setup = {
  catalog?: FeatureUsageDefinition[];
  groups?: string[][];
  /** Linhas que a fonte "tem" (o leitor filtra por período e chave). */
  data?: FeatureUsageRow[];
  firstData?: Record<string, string | null>;
  failKeys?: string[];
  now: Date;
};

function setup(s: Setup) {
  const lease = new FakeLease();
  const state = new FakeState();
  const replaced: { day: string; keys: string[]; rows: FeatureUsageDayRow[] }[] = [];
  const purged: string[] = [];
  const reads: FeatureUsageReadInput[] = [];
  const warn = vi.fn();
  let now = s.now;
  const reader = {
    read: vi.fn(async (input: FeatureUsageReadInput): Promise<FeatureUsageReadResult> => {
      reads.push(input);
      if (input.featureKeys.some((k) => s.failKeys?.includes(k))) throw new Error('boom');
      const from = dayInZone(input.from);
      const to = dayInZone(input.toExclusive);
      const rows = (s.data ?? []).filter((r) => (input.featureKeys as string[]).includes(r.featureKey) && r.day >= from && r.day < to);
      const firstDataDay: Record<string, string | null> = {};
      for (const k of input.featureKeys) firstDataDay[k] = s.firstData?.[k] ?? null;
      return { rows, firstDataDay };
    }),
  };
  const daily = {
    replaceDay: vi.fn(async (day: string, keys: readonly string[], rows: readonly FeatureUsageDayRow[]) => {
      replaced.push({ day, keys: [...keys], rows: [...rows] });
    }),
    purgeBefore: vi.fn(async (before: string) => {
      purged.push(before);
      return 0;
    }),
  };
  const deps: RollupFeatureUsageDeps = {
    reader,
    daily,
    state,
    lease,
    newBudget: () => budget,
    now: () => now,
    log: { warn, info: vi.fn() },
    ...(s.catalog ? { catalog: s.catalog } : {}),
    ...(s.groups ? { sourceGroups: s.groups } : {}),
  };
  const useCase = new RollupFeatureUsageUseCase(deps);
  return {
    useCase,
    lease,
    state,
    reader,
    daily,
    replaced,
    purged,
    reads,
    warn,
    setNow: (d: Date) => (now = d),
  };
}

const row = (day: string, featureKey: string, uses = 1, tenantId = 't1'): FeatureUsageRow => ({
  day,
  tenantId,
  featureKey,
  kind: 'ACTION',
  uses,
  activeDays: 1,
  lastDay: day,
});

const NOW = new Date('2026-11-17T15:00:00Z'); // 12:00 em Brasília, dia 17

describe('RollupFeatureUsageUseCase', () => {
  it('sem o lease não lê nem grava', async () => {
    const t = setup({ catalog: [def('a')], now: NOW });
    await t.lease.tryAcquire(FEATURE_USAGE_ROLLUP_LEASE, 'outro', new Date(NOW.getTime() + 60_000), NOW);
    expect(await t.useCase.execute()).toEqual({ status: 'skipped' });
    expect(t.reader.read).not.toHaveBeenCalled();
    expect(t.daily.replaceDay).not.toHaveBeenCalled();
    expect(t.daily.purgeBefore).not.toHaveBeenCalled();
    expect(t.state.marks).toBe(0);
  });

  it('recalcula hoje e ontem de Brasília; na virada (02:30 UTC) o dia certo é o anterior', async () => {
    const t = setup({
      catalog: [def('a')],
      data: [],
      firstData: { a: '2026-11-16' },
      now: new Date('2026-11-18T02:30:00Z'), // 23:30 de 17/11 em Brasília
    });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    await t.useCase.execute();
    expect(t.replaced.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-17']);
    expect(dayInZone(t.reads[0]!.from)).toBe('2026-11-16');
    expect(dayInZone(t.reads[0]!.toExclusive)).toBe('2026-11-18');
  });

  it('grava as linhas do dia de cada recurso e solta o lease do rollup ao terminar', async () => {
    const rows = [row('2026-11-16', 'a', 2), row('2026-11-17', 'b', 3, 't2')];
    const t2 = setup({ catalog: [def('a'), def('b')], groups: [['a', 'b']], data: rows, now: NOW });
    t2.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    await t2.useCase.execute();
    expect(t2.replaced).toEqual([
      { day: '2026-11-16', keys: ['a', 'b'], rows: [{ tenantId: 't1', featureKey: 'a', kind: 'ACTION', uses: 2 }] },
      { day: '2026-11-17', keys: ['a', 'b'], rows: [{ tenantId: 't2', featureKey: 'b', kind: 'ACTION', uses: 3 }] },
    ]);
    expect(t2.reader.read).toHaveBeenCalledTimes(1); // um grupo = uma leitura
    expect(t2.lease.held.has(FEATURE_USAGE_ROLLUP_LEASE)).toBe(false);
  });

  it('erro numa fonte não impede as outras, é logado e a chave dela não entra em keys', async () => {
    const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], failKeys: ['a'], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    const r = await t.useCase.execute();
    expect(r).toMatchObject({ status: 'ran', failedGroups: 1 });
    expect(t.replaced.map((x) => x.keys)).toEqual([['b'], ['b']]);
    expect(t.warn).toHaveBeenCalledWith(expect.objectContaining({ keys: ['a'], err: 'Error' }), 'feature usage rollup source failed');
  });

  it('backfill de 23 dias termina em 4 execuções, grava o marco só na última e depois não faz nada', async () => {
    const first = addDays('2026-11-17', -24); // anteontem até aqui = 23 dias
    const t = setup({ catalog: [def('a')], firstData: { a: first }, now: NOW });
    const backfillDays = () => t.replaced.map((r) => r.day).filter((d) => d < '2026-11-16');
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await t.useCase.execute();
      outcomes.push(r.status === 'ran' ? r.backfill : r.status);
      if (i < 3) expect(t.state.marks).toBe(0);
    }
    expect(outcomes).toEqual(['step', 'step', 'step', 'completed']);
    expect(t.state.marks).toBe(1);
    expect(t.state.value.backfilledFrom).toBe(first);
    expect(t.state.value.backfillCompletedAt).toEqual(NOW);
    const days = backfillDays();
    expect(new Set(days).size).toBe(23);
    expect(days.every((d) => d >= first)).toBe(true);

    const before = t.replaced.length;
    const r5 = await t.useCase.execute();
    expect(r5).toMatchObject({ backfill: 'done' });
    expect(t.replaced.slice(before).map((x) => x.day)).toEqual(['2026-11-16', '2026-11-17']);
    expect(t.state.marks).toBe(1);
    expect(t.state.value.backfillCompletedAt).toEqual(NOW);
    expect(t.lease.held.has(FEATURE_USAGE_BACKFILL_LEASE)).toBe(false);
  });

  it('backfill com fonte em erro não anda o cursor (o passo se repete)', async () => {
    const t = setup({ catalog: [def('a'), def('b')], firstData: { a: '2026-10-01', b: '2026-10-01' }, failKeys: ['b'], now: NOW });
    const r = await t.useCase.execute();
    expect(r).toMatchObject({ backfill: 'failed' });
    expect(t.state.value.backfillCursor).toBeNull();
  });

  it('nenhuma chave RECORDED vai ao replaceDay, nem nos dias antes do corte (view:*)', async () => {
    const catalog = [
      def('a'),
      def('view:home', { source: 'RECORDED', recordedFrom: 'FIRST_WRITE', kinds: ['ACCESS'] }),
      def('chat_send', { source: 'RECORDED', recordedFrom: 'FIRST_WRITE' }),
    ];
    const t = setup({ catalog, groups: [['a', 'view:home', 'chat_send']], firstData: { a: '2026-10-20' }, now: NOW });
    for (let i = 0; i < 6; i++) await t.useCase.execute();
    expect(t.replaced.length).toBeGreaterThan(2);
    for (const r of t.replaced) expect(r.keys).toEqual(['a']);
    for (const read of t.reads) expect(read.featureKeys).toEqual(['a']);
  });

  it('recurso CUTOVER sem corte gravado: todo dia é da fonte viva', async () => {
    const catalog = [def('a'), def('offer_story', { recordedFrom: 'CUTOVER' })];
    const t = setup({ catalog, groups: [['a', 'offer_story']], data: [row('2026-11-17', 'offer_story', 9)], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    await t.useCase.execute();
    expect(t.replaced.map((r) => [r.day, r.keys])).toEqual([
      ['2026-11-16', ['a', 'offer_story']],
      ['2026-11-17', ['a', 'offer_story']],
    ]);
  });

  it('recurso com corte gravado: o dia anterior ao corte é gravado e o dia do corte em diante não entra em keys', async () => {
    const catalog = [def('a'), def('offer_story', { recordedFrom: 'CUTOVER' })];
    const t = setup({
      catalog,
      groups: [['a', 'offer_story']],
      data: [row('2026-11-16', 'offer_story', 4), row('2026-11-17', 'offer_story', 9)],
      now: NOW,
    });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: { offer_story: '2026-11-17' } };
    await t.useCase.execute();
    expect(t.replaced).toEqual([
      { day: '2026-11-16', keys: ['a', 'offer_story'], rows: [{ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', uses: 4 }] },
      { day: '2026-11-17', keys: ['a'], rows: [] },
    ]);
  });

  it('retenção apaga antes de hoje − 400 uma vez a cada 24 h', async () => {
    const t = setup({ catalog: [def('a')], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    await t.useCase.execute();
    await t.useCase.execute();
    expect(t.purged).toEqual([addDays('2026-11-17', -400)]);
    expect(t.lease.held.has(FEATURE_USAGE_RETENTION_LEASE)).toBe(true);
    t.setNow(new Date(NOW.getTime() + 24 * 3_600_000 + 1));
    await t.useCase.execute();
    expect(t.purged).toHaveLength(2);
  });

  it('sem dado nenhum o backfill termina na primeira execução a partir de ontem', async () => {
    const t = setup({ catalog: [def('a')], now: NOW });
    expect(await t.useCase.execute()).toMatchObject({ backfill: 'completed' });
    expect(t.state.value.backfilledFrom).toBe('2026-11-16');
    expect(t.replaced.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-17']);
  });

  it('renova o lease antes de cada fonte e de cada gravação; a renovação falhando aborta o tick sem gravar mais', async () => {
    const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    await t.useCase.execute();
    // 2 fontes + 2 dias
    expect(t.lease.renewed.filter((n) => n === FEATURE_USAGE_ROLLUP_LEASE)).toHaveLength(4);

    const lost = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], now: NOW });
    lost.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillCursor: null, cutovers: {} };
    const realRead = lost.reader.read.getMockImplementation()!;
    lost.reader.read.mockImplementation(async (input) => {
      lost.lease.stolen.add(FEATURE_USAGE_ROLLUP_LEASE);
      return realRead(input);
    });
    expect(await lost.useCase.execute()).toEqual({ status: 'lost' });
    expect(lost.reader.read).toHaveBeenCalledTimes(1);
    expect(lost.daily.replaceDay).not.toHaveBeenCalled();
    expect(lost.daily.purgeBefore).not.toHaveBeenCalled();
    expect(lost.warn).toHaveBeenCalledWith({ lease: FEATURE_USAGE_ROLLUP_LEASE }, 'feature usage rollup lost lease, tick aborted');
  });

  it('no backfill renova também o lease do backfill', async () => {
    const t = setup({ catalog: [def('a')], firstData: { a: '2026-10-01' }, now: NOW });
    await t.useCase.execute();
    expect(t.lease.renewed).toContain(FEATURE_USAGE_BACKFILL_LEASE);
  });
});
