import { describe, expect, it, vi } from 'vitest';
import type { IJobLease, IJobLeaseRenewal } from '../../../../shared/jobs/IJobLease';
import type { FeatureUsageDayRow } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { FeatureUsageReadInput, FeatureUsageReadResult } from '../../domain/contracts/IFeatureUsageReader';
import type { FeatureUsageRollupState, FeatureUsageTickPatch, IFeatureUsageRollupStateRepository } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import type { FeatureUsageDefinition } from '../../domain/services/featureUsageCatalog';
import { addDays, dayInZone } from '../../domain/services/featureUsagePeriod';
import {
  FEATURE_USAGE_BACKFILL_LEASE,
  recentWindow,
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
  value: FeatureUsageRollupState = { backfillCompletedAt: null, backfilledFrom: null, backfillStopReason: null, backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
  marks = 0;
  /** Cortes que passam a valer na N-ésima leitura (simula o contador gravando o corte no meio do tick). */
  cutoverAfterReads: { reads: number; cutovers: Record<string, string> } | null = null;
  gets = 0;
  async get() {
    this.gets++;
    if (this.cutoverAfterReads && this.gets > this.cutoverAfterReads.reads) this.value = { ...this.value, cutovers: this.cutoverAfterReads.cutovers };
    return structuredClone(this.value);
  }
  async saveBackfillCursor(day: string) {
    this.value = { ...this.value, backfillCursor: day };
  }
  async markBackfillCompleted(m: { completedAt: Date; backfilledFrom: string; stopReason: FeatureUsageRollupState['backfillStopReason']; pendingKeys?: readonly string[] }) {
    if (this.value.backfillCompletedAt) return false;
    this.marks++;
    this.value = { ...this.value, backfillCompletedAt: m.completedAt, backfilledFrom: m.backfilledFrom, backfillStopReason: m.stopReason, backfillPendingKeys: [...(m.pendingKeys ?? [])] };
    return true;
  }
  ticks: FeatureUsageTickPatch[] = [];
  async recordTick(p: FeatureUsageTickPatch) {
    this.ticks.push(p);
    this.value = {
      ...this.value,
      failureStreak: p.failureStreak,
      ...(p.lastSuccessAt ? { lastSuccessAt: p.lastSuccessAt } : {}),
      ...(p.finalizedThrough ? { finalizedThrough: p.finalizedThrough } : {}),
      ...(p.groups ? { groups: structuredClone(p.groups) } : {}),
      ...(p.retryQueue ? { retryQueue: [...p.retryQueue] } : {}),
      ...(p.revisitCursor ? { revisitCursor: p.revisitCursor } : {}),
      ...(p.backfillPendingKeys ? { backfillPendingKeys: [...p.backfillPendingKeys] } : {}),
      ...(p.liveSince && !this.value.liveSince ? { liveSince: p.liveSince } : {}),
    };
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
    /** Soma gravada por chave no dia (último replaceDay do dia que tocou a chave). */
    dayTotals: vi.fn(async (day: string, keys: readonly string[]) => {
      const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
      for (const k of keys) {
        const last = [...replaced].reverse().find((r) => r.day === day && r.keys.includes(k));
        out[k] = (last?.rows ?? []).filter((x) => x.featureKey === k).reduce((n, x) => n + x.uses, 0);
      }
      return out;
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
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t.useCase.execute();
    expect(t.replaced.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-17']);
    expect(dayInZone(t.reads[0]!.from)).toBe('2026-11-16');
    expect(dayInZone(t.reads[0]!.toExclusive)).toBe('2026-11-18');
  });

  it('grava as linhas do dia de cada recurso e solta o lease do rollup ao terminar', async () => {
    const rows = [row('2026-11-16', 'a', 2), row('2026-11-17', 'b', 3, 't2')];
    const t2 = setup({ catalog: [def('a'), def('b')], groups: [['a', 'b']], data: rows, now: NOW });
    t2.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t2.useCase.execute();
    expect(t2.replaced).toEqual([
      { day: '2026-11-16', keys: ['a', 'b'], rows: [{ tenantId: 't1', featureKey: 'a', kind: 'ACTION', uses: 2 }] },
      { day: '2026-11-17', keys: ['a', 'b'], rows: [{ tenantId: 't2', featureKey: 'b', kind: 'ACTION', uses: 3 }] },
    ]);
    expect(t2.reader.read).toHaveBeenCalledTimes(1); // um grupo = uma leitura
    expect(t2.lease.held.has(FEATURE_USAGE_ROLLUP_LEASE)).toBe(false);
  });

  it('catálogo real: nenhuma chave view:* (tela) entra nas keys nem nas leituras do rollup', async () => {
    const t = setup({ data: [row('2026-11-17', 'view:offers'), row('2026-11-17', 'offer_generator')], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t.useCase.execute();
    expect(t.replaced.length).toBeGreaterThan(0);
    for (const r of t.replaced) {
      expect(r.keys.some((k) => k.startsWith('view:'))).toBe(false);
      expect(r.rows.some((x) => x.featureKey.startsWith('view:'))).toBe(false);
    }
    for (const read of t.reads) expect(read.featureKeys.some((k) => (k as string).startsWith('view:'))).toBe(false);
  });

  it('erro numa fonte não impede as outras, é logado e a chave dela não entra em keys', async () => {
    const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], failKeys: ['a'], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
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
    expect(t.state.value.backfillStopReason).toBe('FIRST_DATA');
    expect(t.state.value.backfillCompletedAt).toEqual(NOW);
    const days = backfillDays();
    expect(new Set(days).size).toBe(23);
    expect(days.every((d) => d >= first)).toBe(true);

    const before = t.replaced.length;
    const r5 = await t.useCase.execute();
    expect(r5).toMatchObject({ backfill: 'done' });
    // Janela + revisita (rodízio: 15, 14, 13 nos ticks 2–4; 12 agora)
    expect(t.replaced.slice(before).map((x) => x.day)).toEqual(['2026-11-16', '2026-11-17', '2026-11-12']);
    expect(t.state.marks).toBe(1);
    expect(t.state.value.backfillCompletedAt).toEqual(NOW);
    expect(t.lease.held.has(FEATURE_USAGE_BACKFILL_LEASE)).toBe(false);
  });

  it('backfill com fonte em erro: o cursor do grupo com erro não anda (o passo se repete); o do outro anda', async () => {
    const t = setup({ catalog: [def('a'), def('b')], firstData: { a: '2026-10-01', b: '2026-10-01' }, failKeys: ['b'], now: NOW });
    const r = await t.useCase.execute();
    expect(r).toMatchObject({ backfill: 'failed' });
    expect(t.state.value.groups!['a']).toMatchObject({ backfillCursor: '2026-11-08', backfillFailures: 0 });
    expect(t.state.value.groups!['b']).toMatchObject({ backfillCursor: '2026-11-15', backfillFailures: 1 });
  });

  it('cursor único legado só vale no estado sem grupos; grupo novo num estado com grupos começa de hoje − 2', async () => {
    const fromOf = (t: ReturnType<typeof setup>, key: string) =>
      t.reads.filter((r) => (r.featureKeys as string[]).includes(key) && dayInZone(r.from) < '2026-11-16').map((r) => dayInZone(r.from));
    // Estado antigo (sem grupos): todos os grupos herdam o cursor legado
    const legacy = setup({ catalog: [def('a'), def('b')], firstData: { a: '2026-01-01', b: '2026-01-01' }, now: NOW });
    legacy.state.value = { ...legacy.state.value, backfillCursor: '2026-10-01' };
    await legacy.useCase.execute();
    expect(fromOf(legacy, 'a')).toEqual(['2026-09-25']);
    expect(fromOf(legacy, 'b')).toEqual(['2026-09-25']);
    // Estado com grupos: `a` segue o próprio cursor; `b` (sem entrada) começa de anteontem, não do legado
    const t = setup({ catalog: [def('a'), def('b')], firstData: { a: '2026-01-01', b: '2026-01-01' }, now: NOW });
    t.state.value = {
      ...t.state.value,
      backfillCursor: '2026-10-01',
      groups: { a: { failureStreak: 0, lastSuccessAt: null, backfillCursor: '2026-10-20', backfillDone: null, backfillFailures: 0 } },
    };
    await t.useCase.execute();
    expect(fromOf(t, 'a')).toEqual(['2026-10-14']);
    expect(fromOf(t, 'b')).toEqual(['2026-11-09']);
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
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
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
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: { offer_story: '2026-11-17' }, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t.useCase.execute();
    expect(t.replaced).toEqual([
      { day: '2026-11-16', keys: ['a', 'offer_story'], rows: [{ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', uses: 4 }] },
      { day: '2026-11-17', keys: ['a'], rows: [] },
    ]);
  });

  it('retenção apaga antes de hoje − 400 uma vez a cada 24 h', async () => {
    const t = setup({ catalog: [def('a')], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t.useCase.execute();
    await t.useCase.execute();
    expect(t.purged).toEqual([addDays('2026-11-17', -400)]);
    expect(t.lease.held.has(FEATURE_USAGE_RETENTION_LEASE)).toBe(true);
    t.setNow(new Date(NOW.getTime() + 24 * 3_600_000 + 1));
    await t.useCase.execute();
    expect(t.purged).toHaveLength(2);
  });

  it('sem dado nenhum o backfill termina na primeira execução a partir de ontem (FIRST_DATA)', async () => {
    const t = setup({ catalog: [def('a')], now: NOW });
    expect(await t.useCase.execute()).toMatchObject({ backfill: 'completed' });
    expect(t.state.value.backfilledFrom).toBe('2026-11-16');
    expect(t.state.value.backfillStopReason).toBe('FIRST_DATA');
    expect(t.replaced.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-17']);
  });

  it('renova o lease antes de cada fonte e de cada gravação; a renovação falhando aborta o tick sem gravar mais', async () => {
    const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], now: NOW });
    t.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
    await t.useCase.execute();
    // 2 grupos × (1 fonte + 2 dias) + gravação do estado do tick
    expect(t.lease.renewed.filter((n) => n === FEATURE_USAGE_ROLLUP_LEASE)).toHaveLength(7);

    const lost = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], now: NOW });
    lost.state.value = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-11-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
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

  it('primeiro dado além dos 400 dias: o backfill para na retenção e grava RETENTION', async () => {
    const t = setup({ catalog: [def('a')], firstData: { a: '2024-01-01' }, now: NOW });
    t.state.value = { ...t.state.value, backfillCursor: addDays('2026-11-17', -398) };
    expect(await t.useCase.execute()).toMatchObject({ backfill: 'completed' });
    expect(t.state.value).toMatchObject({ backfilledFrom: addDays('2026-11-17', -400), backfillStopReason: 'RETENTION' });
  });

  describe('janela recente, frescor e falhas seguidas', () => {
    const DONE = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-01-01', backfillStopReason: 'RETENTION' as const, backfillCursor: null };

    it('recentWindow: sem marca ontem e hoje; com marca, de marca + 1 até hoje, no máximo 7 dias', () => {
      expect(recentWindow(null, '2026-11-17')).toEqual(['2026-11-16', '2026-11-17']);
      expect(recentWindow('2026-11-15', '2026-11-17')).toEqual(['2026-11-16', '2026-11-17']);
      expect(recentWindow('2026-11-13', '2026-11-17')).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
      expect(recentWindow('2026-11-01', '2026-11-17')).toEqual(
        ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'],
      );
      // Marca no futuro (relógio) não pula ontem
      expect(recentWindow('2026-11-20', '2026-11-17')).toEqual(['2026-11-16', '2026-11-17']);
    });

    it('tick sem falha grava lastSuccessAt e finalizedThrough = anteontem; ontem é revisitado no tick seguinte', async () => {
      const t = setup({ catalog: [def('a')], now: NOW });
      t.state.value = { ...t.state.value, ...DONE };
      await t.useCase.execute();
      expect(t.state.ticks[0]).toMatchObject({ failureStreak: 0, finalizedThrough: '2026-11-15', lastSuccessAt: NOW, retryQueue: [] });
      expect(t.state.value.groups!['a']).toMatchObject({ failureStreak: 0, lastSuccessAt: NOW });
      t.replaced.length = 0;
      await t.useCase.execute();
      // Janela de ontem e hoje + revisita de anteontem (finalizado no tick anterior)
      expect(t.replaced.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-17', '2026-11-15']);
      expect(t.state.ticks[1]).toMatchObject({ failureStreak: 0, lastSuccessAt: NOW });
      expect(t.state.ticks[1]).not.toHaveProperty('finalizedThrough'); // marca não anda para trás nem repete
    });

    it('primeiro tick inteiro grava liveSince = hoje uma única vez; tick incompleto não grava', async () => {
      const t = setup({ catalog: [def('a')], now: NOW });
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-06' };
      await t.useCase.execute(); // janela não chega a hoje: incompleto
      expect(t.state.ticks[0]).not.toHaveProperty('liveSince');
      await t.useCase.execute();
      expect(t.state.ticks[1]).toMatchObject({ lastSuccessAt: NOW, liveSince: '2026-11-17' });
      await t.useCase.execute();
      expect(t.state.ticks[2]).not.toHaveProperty('liveSince');
      expect(t.state.value.liveSince).toBe('2026-11-17');
    });

    it('job parado 10 dias: alcança hoje em 7 + resto, e só fica fresco quando a janela chega a hoje', async () => {
      const t = setup({ catalog: [def('a')], now: NOW });
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-06' };
      const r1 = await t.useCase.execute();
      expect(r1).toMatchObject({ window: { from: '2026-11-07', to: '2026-11-13' } });
      expect(t.state.ticks[0]).toMatchObject({ failureStreak: 0, finalizedThrough: '2026-11-13' });
      expect(t.state.ticks[0]).not.toHaveProperty('lastSuccessAt');
      expect(t.state.value.groups!['a']!.lastSuccessAt).toBeNull();
      const r2 = await t.useCase.execute();
      expect(r2).toMatchObject({ window: { from: '2026-11-14', to: '2026-11-17' } });
      expect(t.state.ticks[1]).toMatchObject({ failureStreak: 0, finalizedThrough: '2026-11-15', lastSuccessAt: NOW });
    });

    it('falha numa fonte: sem lastSuccessAt, marca parada e contador de falhas sobe; zera no primeiro tick bom', async () => {
      const failKeys = ['a'];
      const t = setup({ catalog: [def('a')], failKeys, now: NOW });
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-10', lastSuccessAt: new Date(0) };
      await t.useCase.execute();
      expect(t.state.ticks[0]).toMatchObject({ failureStreak: 1, retryQueue: [] });
      expect(t.state.ticks[0]).not.toHaveProperty('lastSuccessAt');
      expect(t.state.ticks[0]).not.toHaveProperty('finalizedThrough'); // todos os grupos falharam: nada anda
      expect(t.state.value).toMatchObject({ finalizedThrough: '2026-11-10', lastSuccessAt: new Date(0) });
      expect(t.state.value.groups!['a']).toMatchObject({ failureStreak: 1, lastSuccessAt: null });
      failKeys.length = 0;
      await t.useCase.execute();
      expect(t.state.value.failureStreak).toBe(0);
    });

    it('3 falhas seguidas do grupo: log error; dia ruim que ficou para trás vai ao reprocesso e é isolado', async () => {
      const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], now: NOW });
      const error = vi.fn();
      const uc = new RollupFeatureUsageUseCase({ ...(t.useCase as unknown as { deps: RollupFeatureUsageDeps }).deps, log: { warn: t.warn, info: vi.fn(), error } });
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-10', failureStreak: 2, groups: { a: { failureStreak: 2, lastSuccessAt: null, backfillCursor: null, backfillDone: null, backfillFailures: 0 } } };
      // Fonte `a` quebra em qualquer leitura que inclua o dia 13; `b` sempre bem
      const realRead = t.reader.read.getMockImplementation()!;
      t.reader.read.mockImplementation(async (input) => {
        const from = dayInZone(input.from);
        const to = dayInZone(input.toExclusive);
        if ((input.featureKeys as string[]).includes('a') && from <= '2026-11-13' && to > '2026-11-13') throw new Error('bad day');
        return realRead(input);
      });
      const r1 = await uc.execute();
      // `b` andou a marca até 15; os dias 11–15 de `a` (leitura da janela falhou) entram no reprocesso
      expect(r1).toMatchObject({ failedGroups: 1, failureStreak: 3, retryQueue: 5 });
      expect(t.state.value.finalizedThrough).toBe('2026-11-15');
      expect(t.state.value.retryQueue).toEqual(['11', '12', '13', '14', '15'].map((d) => ({ day: `2026-11-${d}`, group: 'a' })));
      expect(t.state.value.groups!['a']).toMatchObject({ failureStreak: 3 });
      expect(t.state.value.groups!['b']).toMatchObject({ failureStreak: 0, lastSuccessAt: NOW });
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ group: 'a', failureStreak: 3 }), 'feature usage rollup group failing repeatedly');
      // Tick seguinte: reprocesso dia a dia isola o 13; a janela (16–17) de `a` dá certo
      t.replaced.length = 0;
      const r2 = await uc.execute();
      expect(t.replaced.filter((x) => x.keys.includes('a')).map((x) => x.day)).toEqual(['2026-11-11', '2026-11-12', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-15']);
      expect(t.state.value.retryQueue).toEqual([{ day: '2026-11-13', group: 'a' }]);
      expect(r2).toMatchObject({ failedGroups: 0, retryQueue: 1 });
      expect(t.state.value.groups!['a']!.failureStreak).toBe(4);
      // Grupo com (dia, grupo) pendente no reprocesso não fica fresco, mesmo com a janela recente boa
      expect(t.state.value.groups!['a']!.lastSuccessAt).toBeNull();
      expect(t.state.value.groups!['b']!.lastSuccessAt).toEqual(NOW);
      // Reprocesso vazio: o grupo volta a ficar fresco
      t.reader.read.mockImplementation(realRead);
      await uc.execute();
      expect(t.state.value.retryQueue).toEqual([]);
      expect(t.state.value.groups!['a']!.lastSuccessAt).toEqual(NOW);
    });

    it('grupo A sempre falhando não impede B de avançar a marca, o frescor nem o backfill/marco de B', async () => {
      const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], failKeys: ['a'], firstData: { b: '2026-11-01' }, now: NOW });
      const outcomes: string[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await t.useCase.execute();
        outcomes.push(r.status === 'ran' ? r.backfill : r.status);
      }
      // B concluiu no 1º passo; A falhou 3 passos seguidos e ficou pendente: o marco sai no 3º tick
      expect(outcomes).toEqual(['failed', 'failed', 'failed', 'failed']);
      expect(t.state.marks).toBe(1);
      expect(t.state.value).toMatchObject({ backfilledFrom: '2026-11-01', backfillStopReason: 'FIRST_DATA', backfillPendingKeys: ['a'] });
      expect(t.state.value.finalizedThrough).toBe('2026-11-15');
      expect(t.state.value.groups!['b']).toMatchObject({ lastSuccessAt: NOW, failureStreak: 0, backfillDone: { from: '2026-11-01', reason: 'FIRST_DATA' } });
      expect(t.state.value.groups!['a']).toMatchObject({ lastSuccessAt: null, failureStreak: 4, backfillFailures: 4, backfillDone: null });
      // Tick inteiro nunca concluiu: sem frescor global
      expect(t.state.value.lastSuccessAt).toBeNull();
    });

    it('grupo pendente que volta conclui o backfill e sai de backfillPendingKeys', async () => {
      const failKeys = ['a'];
      const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], failKeys, now: NOW });
      for (let i = 0; i < 3; i++) await t.useCase.execute();
      expect(t.state.value.backfillPendingKeys).toEqual(['a']);
      failKeys.length = 0;
      expect(await t.useCase.execute()).toMatchObject({ backfill: 'completed' });
      expect(t.state.value.backfillPendingKeys).toEqual([]);
      expect(await t.useCase.execute()).toMatchObject({ backfill: 'done' });
      expect(t.state.marks).toBe(1);
    });

    it('lastSuccessAt global não grava quando o backfill falha, mesmo com a janela inteira boa', async () => {
      const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], firstData: { a: '2026-10-01', b: '2026-10-01' }, now: NOW });
      // `b` falha só nas leituras do backfill (antes de ontem)
      const realRead = t.reader.read.getMockImplementation()!;
      t.reader.read.mockImplementation(async (input) => {
        if ((input.featureKeys as string[]).includes('b') && dayInZone(input.from) < '2026-11-16') throw new Error('backfill');
        return realRead(input);
      });
      const r = await t.useCase.execute();
      expect(r).toMatchObject({ failedGroups: 0, backfill: 'failed' });
      expect(t.state.ticks[0]).not.toHaveProperty('lastSuccessAt');
      expect(t.state.value.groups!['a']!.lastSuccessAt).toEqual(NOW);
      expect(t.state.value.groups!['b']!.lastSuccessAt).toBeNull();
    });

    it('reprocesso cheio (30): o item mais antigo sai com log error e vira piso; o piso anda 1 dia por tick até hoje − 30', async () => {
      const failKeys = ['a'];
      const t = setup({ catalog: [def('a'), def('b')], groups: [['a'], ['b']], failKeys, now: NOW });
      const error = vi.fn();
      const uc = new RollupFeatureUsageUseCase({ ...(t.useCase as unknown as { deps: RollupFeatureUsageDeps }).deps, log: { warn: t.warn, info: vi.fn(), error } });
      const old = Array.from({ length: 30 }, (_, i) => ({ day: addDays('2026-11-08', -i), group: 'a' }));
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-10', retryQueue: old };
      await uc.execute();
      expect(t.state.value.retryQueue).toHaveLength(30);
      expect(t.state.value.retryQueue!.at(-1)).toEqual({ day: '2026-11-15', group: 'a' });
      expect(t.state.value.retryQueue![0]!.day).toBe(addDays('2026-11-08', -24));
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ dropped: 5, reprocessFrom: { a: '2026-10-10' } }),
        'feature usage rollup retry queue full, oldest dropped',
      );
      // Piso no menor dia descartado (abaixo da revisita, que só vai até hoje − 30 = 18/10); falhou, não anda
      expect(t.state.value.groups!['a']!.reprocessFrom).toBe('2026-10-10');
      // Fonte volta: 1 dia do piso por tick, até sair da faixa abaixo da revisita
      failKeys.length = 0;
      const walked: string[] = [];
      for (let i = 0; i < 8; i++) {
        t.replaced.length = 0;
        const r = await uc.execute();
        expect(r).toMatchObject({ reprocessed: 1 });
        walked.push(...t.replaced.filter((x) => x.keys.includes('a') && x.day < '2026-10-15').map((x) => x.day));
      }
      expect(walked).toEqual(['10', '11', '12', '13', '14'].map((d) => `2026-10-${d}`));
      expect(t.state.value.groups!['a']!.reprocessFrom).toBeNull();
      expect(await uc.execute()).toMatchObject({ reprocessed: 0 });
    });

    it('revisita: um dia antigo por tick em rodízio (hoje − 2 … hoje − 30) e warn quando o número mudou', async () => {
      const data: FeatureUsageRow[] = [];
      const t = setup({ catalog: [def('a')], data, now: NOW });
      t.state.value = { ...t.state.value, ...DONE, finalizedThrough: '2026-11-15' };
      const r1 = await t.useCase.execute();
      expect(r1).toMatchObject({ revisited: '2026-11-15' });
      expect(t.state.value.revisitCursor).toBe('2026-11-14');
      expect(t.warn).not.toHaveBeenCalledWith(expect.anything(), 'feature usage rollup revisit changed a finalized day');
      // Dado atrasado chega para o dia 14 (já finalizado)
      data.push(row('2026-11-14', 'a', 5));
      const r2 = await t.useCase.execute();
      expect(r2).toMatchObject({ revisited: '2026-11-14' });
      expect(t.warn).toHaveBeenCalledWith(
        { day: '2026-11-14', changed: [{ keys: ['a'], before: { a: 0 }, after: { a: 5 } }] },
        'feature usage rollup revisit changed a finalized day',
      );
      // Rodízio volta a hoje − 2 depois de hoje − 30
      t.state.value = { ...t.state.value, revisitCursor: addDays('2026-11-17', -30) };
      expect(await t.useCase.execute()).toMatchObject({ revisited: addDays('2026-11-17', -30) });
      expect(t.state.value.revisitCursor).toBe('2026-11-15');
    });

    it('corrida: corte gravado no meio do tick não deixa gravar o dia do corte (cortes relidos antes de cada gravação)', async () => {
      const catalog = [def('offer_story', { recordedFrom: 'CUTOVER' })];
      const t = setup({ catalog, data: [row('2026-11-16', 'offer_story', 4), row('2026-11-17', 'offer_story', 9)], now: NOW });
      t.state.value = { ...t.state.value, ...DONE };
      // 1ª leitura (início do tick) sem corte; a partir da 2ª, corte em 17
      t.state.cutoverAfterReads = { reads: 1, cutovers: { offer_story: '2026-11-17' } };
      await t.useCase.execute();
      expect(t.replaced.map((r) => [r.day, r.keys])).toEqual([['2026-11-16', ['offer_story']]]);
    });
  });
});
