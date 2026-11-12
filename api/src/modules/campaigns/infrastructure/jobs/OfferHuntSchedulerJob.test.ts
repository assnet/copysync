import { describe, expect, it, vi } from 'vitest';
import type { OfferHunt } from '../../domain/hunter/OfferHunt';
import type { OfferHuntClaim } from '../../domain/contracts/hunter/IOfferHuntRepository';
import type { RunOfferHuntOutput } from '../../application/use-cases/hunter/RunOfferHuntUseCase';
import { nextHuntRunAt, nextHuntRunNextDay } from '../../domain/services/hunter/huntSchedule';
import { OFFER_HUNT_SCHEDULER_LEASE, OfferHuntSchedulerJob, type OfferHuntSchedulerJobOptions } from './OfferHuntSchedulerJob';
import { startOfferHunterSchedulerJob } from '../offerHunterSchedulerStart';

// 2026-11-12 13:00 em São Paulo (quinta)
const NOW = new Date('2026-11-12T16:00:00.000Z');

const hunt = (tenantId: string, patch: Partial<OfferHunt> = {}): OfferHunt => ({
  id: `h-${tenantId}`, tenantId, name: 'h', sort: 'BEST_SELLING', categoryId: null, commissionBand: null, keyword: null,
  filters: {}, aiEnabled: false, topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60,
  windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127, status: 'ACTIVE', pauseReason: null,
  nextRunAt: new Date('2026-11-12T15:00:00.000Z'), lastRunAt: null, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW,
  ...patch,
} as OfferHunt);

const out = (patch: Partial<RunOfferHuntOutput> = {}): RunOfferHuntOutput => ({
  runId: 'r', status: 'SUCCEEDED', errorCode: null, seenCount: 0, matchedCount: 0, chosenCount: 1, sentCount: 0,
  aiUsed: false, aiFallback: false, ranking: [], finds: [], remainingToday: 5, pausedReason: null, ...patch,
});

const schedule = (h: OfferHunt) => ({ intervalMinutes: h.intervalMinutes, startMinute: h.windowStartMinute, endMinute: h.windowEndMinute, weekdaysMask: h.weekdaysMask });

function setup(claims: OfferHuntClaim[], opts: Partial<OfferHuntSchedulerJobOptions> & { acquire?: boolean; execute?: (i: { tenantId: string }) => Promise<RunOfferHuntOutput> } = {}) {
  const lease = { tryAcquire: vi.fn(async () => opts.acquire ?? true), release: vi.fn(async () => undefined) };
  const byId = new Map(claims.map((c) => [c.hunt.id, c.hunt]));
  const hunts = {
    claimDue: vi.fn(async () => claims),
    releaseClaim: vi.fn(async (_t: string, _id: string, _tok: string, _next: Date | null) => true),
    findById: vi.fn(async (_t: string, id: string) => byId.get(id) ?? null),
  };
  const execute = vi.fn(opts.execute ?? (async () => out()));
  const sleep = vi.fn(async () => undefined);
  const job = new OfferHuntSchedulerJob({ lease, hunts, run: () => ({ execute }), now: () => NOW, sleep, rand: () => 0, ...opts });
  return { job, lease, hunts, execute, sleep };
}

const claim = (h: OfferHunt): OfferHuntClaim => ({ hunt: h, claimToken: `tok-${h.id}` });

describe('OfferHuntSchedulerJob', () => {
  it('lease negado: não reivindica nem roda', async () => {
    const { job, hunts, execute, lease } = setup([claim(hunt('t1'))], { acquire: false });
    await job.runTick();
    expect(lease.tryAcquire).toHaveBeenCalledWith(OFFER_HUNT_SCHEDULER_LEASE, expect.any(String), expect.any(Date), NOW);
    expect(hunts.claimDue).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('pede 3 por tique, roda como SCHEDULED com atraso entre tenants e solta o lease', async () => {
    const cs = ['t1', 't2', 't3'].map((t) => claim(hunt(t)));
    const { job, hunts, execute, sleep, lease } = setup(cs);
    await job.runTick();
    expect(hunts.claimDue).toHaveBeenCalledWith(NOW, 3, 15 * 60_000);
    expect(execute.mock.calls.map(([i]) => i)).toEqual(
      ['t1', 't2', 't3'].map((t) => ({ tenantId: t, huntId: `h-${t}`, trigger: 'SCHEDULED', now: NOW })),
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(lease.release).toHaveBeenCalledWith(OFFER_HUNT_SCHEDULER_LEASE, expect.any(String));
  });

  it('defesa de 1 por tenant: 2ª do mesmo tenant é solta sem rodar e sem mudar o horário', async () => {
    const a = hunt('t1');
    const b = hunt('t1', { id: 'h-b', nextRunAt: new Date('2026-11-12T15:30:00.000Z') });
    const { job, hunts, execute } = setup([claim(a), claim(b)]);
    await job.runTick();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t1', 'h-b', 'tok-h-b', b.nextRunAt);
  });

  it('normal → nextHuntRunAt; teto zerado (código ou saldo 0) → dia seguinte', async () => {
    const [h1, h2, h3, h4] = ['t1', 't2', 't3', 't4'].map((t) => hunt(t));
    const results: Record<string, RunOfferHuntOutput> = {
      t1: out(),
      t2: out({ status: 'SKIPPED', errorCode: 'OFFER_HUNT_DAILY_LIMIT', remainingToday: 0 }),
      t3: out({ remainingToday: 0 }),
      t4: out({ status: 'SKIPPED', errorCode: 'OFFER_HUNT_RUN_THROTTLED', remainingToday: 0 }),
    };
    const { job, hunts } = setup([h1, h2, h3, h4].map(claim), { perTick: 4, execute: async (i) => results[i.tenantId]! });
    await job.runTick();
    const next = (t: string) => hunts.releaseClaim.mock.calls.find((c) => c[0] === t)![3];
    expect(next('t1')).toEqual(nextHuntRunAt(NOW, schedule(h1!)));
    const tomorrow = nextHuntRunNextDay(NOW, schedule(h2!));
    expect(next('t2')).toEqual(tomorrow);
    expect(next('t3')).toEqual(tomorrow);
    expect(next('t4')).toEqual(tomorrow);
    expect(tomorrow.getTime()).toBeGreaterThan(nextHuntRunAt(NOW, schedule(h1!)).getTime());
  });

  it('falha de fonte (FAILED) segue o intervalo normal', async () => {
    const h = hunt('t1');
    const { job, hunts } = setup([claim(h)], { execute: async () => out({ status: 'FAILED', errorCode: 'AFFILIATE_API_UNAVAILABLE', remainingToday: 4 }) });
    await job.runTick();
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t1', h.id, 'tok-h-t1', nextHuntRunAt(NOW, schedule(h)));
  });

  it('fora da janela/dia: não roda, só recalcula a próxima abertura', async () => {
    // Janela 08:00–12:00; agora 13:00 em SP → abre amanhã 08:00 (11:00Z)
    const h = hunt('t1', { windowStartMinute: 480, windowEndMinute: 720 });
    const { job, hunts, execute } = setup([claim(h)]);
    await job.runTick();
    expect(execute).not.toHaveBeenCalled();
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t1', h.id, 'tok-h-t1', new Date('2026-11-13T11:00:00.000Z'));
  });

  it('agenda relida após a execução: edição no meio vale; apagada não solta', async () => {
    const h = hunt('t1');
    const edited = { ...h, intervalMinutes: 120 };
    const { job, hunts } = setup([claim(h), claim(hunt('t2'))]);
    hunts.findById.mockImplementation(async (_t, id) => (id === h.id ? edited : null));
    await job.runTick();
    expect(hunts.releaseClaim).toHaveBeenCalledTimes(1);
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t1', h.id, 'tok-h-t1', nextHuntRunAt(NOW, schedule(edited)));
  });

  it('exceção inesperada: loga, solta com o próximo horário, segue para a próxima e o tique seguinte roda', async () => {
    const [h1, h2] = [hunt('t1'), hunt('t2')];
    let n = 0;
    const { job, hunts, execute } = setup([claim(h1!), claim(h2!)], {
      execute: async () => {
        n += 1;
        if (n === 1) throw Object.assign(new Error('boom secret'), { code: 'X' });
        return out();
      },
    });
    await expect(job.runTick()).resolves.toBeUndefined();
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t1', h1!.id, 'tok-h-t1', nextHuntRunAt(NOW, schedule(h1!)));
    expect(execute).toHaveBeenCalledTimes(2);
    hunts.claimDue.mockRejectedValueOnce(new Error('db down'));
    await expect(job.runTick()).resolves.toBeUndefined();
    await job.runTick();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('falha ao soltar a posse não derruba o tique', async () => {
    const { job, hunts, execute } = setup([claim(hunt('t1')), claim(hunt('t2'))]);
    hunts.releaseClaim.mockRejectedValueOnce(new Error('x'));
    await expect(job.runTick()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stop espera a execução corrente; as não iniciadas são soltas sem mudar o horário', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => { finish = r; });
    const [h1, h2] = [hunt('t1'), hunt('t2')];
    const { job, hunts, execute } = setup([claim(h1!), claim(h2!)], {
      execute: async () => { await gate; return out(); },
    });
    const tick = job.runTick();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stopping = job.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(stopped).toBe(false);
    finish();
    await stopping;
    await tick;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(hunts.releaseClaim).toHaveBeenCalledWith('t2', h2!.id, 'tok-h-t2', h2!.nextRunAt);
  });

  it('tique concorrente no mesmo processo reaproveita o em curso', async () => {
    const { job, lease } = setup([]);
    await Promise.all([job.runTick(), job.runTick()]);
    expect(lease.tryAcquire).toHaveBeenCalledTimes(1);
  });
});

describe('startOfferHunterSchedulerJob', () => {
  it('flag desligada: nada montado', () => {
    const factory = vi.fn();
    expect(startOfferHunterSchedulerJob(false, factory)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('flag ligada: monta e liga', () => {
    const job = { start: vi.fn(), stop: vi.fn(async () => undefined) };
    expect(startOfferHunterSchedulerJob(true, () => job)).toBe(job);
    expect(job.start).toHaveBeenCalledTimes(1);
  });
});
