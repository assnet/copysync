import { describe, expect, it, vi } from 'vitest';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import type { OpsMetricSample } from '../../../metrics/domain/OpsMetric';
import { ScaleWorkersUseCase } from '../../application/use-cases/ScaleWorkersUseCase';
import { makeAuditRepo } from '../../application/use-cases/sessionTestFakes';
import { ScalerUnavailableError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import {
  countsForScaleCooldown,
  type NewWorkerScaleEvent,
  type RecordRequestedResult,
  type WorkerScaleEvent,
  type WorkerScaleOutcome,
} from '../../domain/contracts/IWorkerScaleEventRepository';
import type { WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import { defaultWorkerScalingSettings, type WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import {
  AUTOSCALER_CLEANUP_LEASE,
  AUTOSCALER_LEASE,
  NO_SAMPLES_ERROR,
  SCALE_EVENT_RETENTION_MS,
  WorkerAutoscalerJob,
  pairOccupancySamples,
} from './WorkerAutoscalerJob';

const MIN = 60_000;
const START = new Date('2026-11-11T12:00:00.000Z');

/** Lease com relógio: livre se ausente ou vencido (`expiresAt < now`), como o Prisma. */
class ClockLease implements IJobLease {
  held = new Map<string, { owner: string; until: Date }>();
  async tryAcquire(name: string, owner: string, until: Date, now: Date): Promise<boolean> {
    const cur = this.held.get(name);
    if (cur && !(cur.until < now)) return false;
    this.held.set(name, { owner, until });
    return true;
  }
  async release(name: string, owner: string): Promise<void> {
    if (this.held.get(name)?.owner === owner) this.held.delete(name);
  }
}

const ready = (desiredReplicas = 1): WorkerScalerState => ({
  status: 'ready', desiredReplicas, runningReplicas: desiredReplicas, hasDisk: false, autoscalingEnabled: false,
});

const sample = (metric: string, at: Date, value: number, over: Partial<OpsMetricSample> = {}): OpsMetricSample => ({
  at, source: 'sessions', resource: 'cluster', metric, value, meta: null, ...over,
});

/** Ambiente compartilhado entre instâncias do job (banco, lease e escalador falsos). */
function world(over: Partial<WorkerScalingSettings> = {}) {
  let clock = START;
  let settings: WorkerScalingSettings = {
    ...defaultWorkerScalingSettings({ maxSessionsPerWorker: 100, maxPendingLoginsPerWorker: 10 }),
    scalerMode: 'auto', minReplicas: 1, maxReplicas: 3, alertOccupancyRatio: 0.8,
    scaleUpSustainSeconds: 900, scaleCooldownSeconds: 1800, awaitingAlertSeconds: 120,
    ...over,
  };
  const lease = new ClockLease();
  const rows: WorkerScaleEvent[] = [];
  const events = {
    rows,
    record: vi.fn(async (e: NewWorkerScaleEvent) => {
      if (e.requestId && rows.some((r) => r.requestId === e.requestId)) throw new Error('unique');
      const id = rows.length + 1;
      rows.push({ id, at: clock, error: null, requestId: null, ...e } as WorkerScaleEvent);
      return id;
    }),
    updateOutcome: vi.fn(async (id: number, outcome: WorkerScaleOutcome, error?: string | null) => {
      const row = rows.find((r) => r.id === id)!;
      row.outcome = outcome;
      row.error = error ?? null;
    }),
    lastCooldownStartAt: vi.fn(async () => {
      const ok = rows.filter(countsForScaleCooldown);
      return ok.length ? ok[ok.length - 1].at : null;
    }),
    /** Como o Prisma: `requestId` já gravado → `existing`; dentro do intervalo → `blocked`. */
    recordRequestedIfIdle: vi.fn(
      async (input: { evt: Omit<NewWorkerScaleEvent, 'outcome' | 'error'>; cooldownSeconds: number; now: Date }): Promise<RecordRequestedResult> => {
        const dup = input.evt.requestId ? rows.find((r) => r.requestId === input.evt.requestId) : undefined;
        if (dup) return { existing: dup };
        const ok = rows.filter(countsForScaleCooldown);
        const last = ok.length ? ok[ok.length - 1].at : null;
        if (last) {
          const retryAt = new Date(last.getTime() + input.cooldownSeconds * 1000);
          if (retryAt > input.now) return { blocked: retryAt };
        }
        return { id: await events.record({ ...input.evt, outcome: 'requested' }) };
      },
    ),
    findByRequestId: vi.fn(async (id: string) => rows.find((r) => r.requestId === id) ?? null),
    latestSucceeded: vi.fn(async () => rows.filter((r) => r.outcome === 'succeeded').at(-1) ?? null),
    latestByTrigger: vi.fn(async (t: string) => rows.filter((r) => r.trigger === t).at(-1) ?? null),
    list: vi.fn(),
    deleteOlderThan: vi.fn(async () => 0),
  };
  let replicas = 1;
  let state: WorkerScalerState | null = null;
  const scaler = {
    getState: vi.fn(async () => state ?? ready(replicas)),
    scaleTo: vi.fn(async (n: number): Promise<void> => { replicas = n; }),
  };
  const stored: OpsMetricSample[] = [];
  const samples = {
    listSince: vi.fn(async (metric: string, since: Date) =>
      stored.filter((s) => s.metric === metric && s.at >= since).sort((a, b) => b.at.getTime() - a.at.getTime())),
  };
  let awaiting = 0;
  const adoption = { countAwaitingCapacity: vi.fn(async () => awaiting) };
  const provider = { current: () => ({ value: settings, origin: {} as never }), refresh: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const now = () => clock;
  let adoptionOn = true;
  const isAdoptionEnabled = vi.fn(() => adoptionOn);
  const scale = new ScaleWorkersUseCase({
    events, scaler, settings: provider, audit: makeAuditRepo(), isAdoptionEnabled, now,
  });
  const newJob = () =>
    new WorkerAutoscalerJob({ lease, settings: provider, samples, adoption, scaler, scale, events, isAdoptionEnabled, now });

  return {
    lease, events, rows, scaler, samples, adoption, newJob,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    now,
    configure: (patch: Partial<WorkerScalingSettings>) => { settings = { ...settings, ...patch }; },
    setAwaiting: (n: number) => { awaiting = n; },
    setAdoption: (on: boolean) => { adoptionOn = on; },
    setState: (s: WorkerScalerState | null) => { state = s; },
    /** Grava o par `sessions_*` no instante atual (como o sampler a cada 5 min). */
    persist: (connected: number, capacity = 100) => {
      stored.push(sample('sessions_connected', clock, connected, { meta: { agg: 'avg' } }));
      stored.push(sample('sessions_capacity', clock, capacity, { meta: { agg: 'last' } }));
    },
    get replicas() { return replicas; },
  };
}

/** Avança `minutes` com um tick por minuto e uma amostra a cada 5 min. */
async function run(w: ReturnType<typeof world>, job: WorkerAutoscalerJob, minutes: number, connected?: number) {
  for (let i = 0; i < minutes; i++) {
    w.advance(MIN);
    if (connected !== undefined && w.now().getTime() % (5 * MIN) === 0) w.persist(connected);
    await job.runTick();
  }
}

describe('pairOccupancySamples', () => {
  it('pareia por `at` só sessions/cluster; `at` sem par é descartado, com ou sem `meta.agg`', () => {
    const a = new Date(START.getTime());
    const b = new Date(START.getTime() + 5 * MIN);
    const out = pairOccupancySamples(
      [sample('sessions_connected', a, 50), sample('sessions_connected', b, 90), sample('sessions_connected', b, 1, { resource: 'w1' })],
      [sample('sessions_capacity', a, 100), sample('sessions_capacity', b, 100, { meta: { agg: 'last' } })],
    );
    expect(out).toEqual([
      { at: b, connected: 90, capacity: 100 },
      { at: a, connected: 50, capacity: 100 },
    ]);
    expect(pairOccupancySamples([sample('sessions_connected', a, 50)], [])).toEqual([]);
  });
});

describe('WorkerAutoscalerJob', () => {
  it.each(['off', 'manual'] as const)('modo %s não age, não lê amostra nem consulta o escalador', async (mode) => {
    const w = world({ scalerMode: mode });
    w.setAwaiting(5);
    w.persist(99);
    const job = w.newJob();
    await job.runTick();
    expect(w.scaler.getState).not.toHaveBeenCalled();
    expect(w.samples.listSince).not.toHaveBeenCalled();
    expect(w.adoption.countAwaitingCapacity).not.toHaveBeenCalled();
    expect(w.rows).toEqual([]);
    expect(w.lease.held.has(AUTOSCALER_LEASE)).toBe(false);
  });

  it('ocupação sustentada incompleta não sobe; completa sobe uma réplica', async () => {
    const w = world();
    const job = w.newJob();
    await run(w, job, 10, 90); // 2 amostras de 3 exigidas (900 s)
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
    // Só a recusa `no_samples` dos 4 primeiros minutos (antes da 1ª amostra)
    expect(w.rows.map((r) => r.error)).toEqual([NO_SAMPLES_ERROR]);
    w.rows.length = 0;
    await run(w, job, 5, 90);
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.scaler.scaleTo).toHaveBeenCalledWith(2);
    expect(w.rows[0]).toMatchObject({ trigger: 'auto', actorUserId: null, fromReplicas: 1, toReplicas: 2, outcome: 'succeeded', reason: 'auto: occupancy' });
  });

  it('uma amostra abaixo do limiar na janela não sobe', async () => {
    const w = world();
    const job = w.newJob();
    await run(w, job, 5, 90);
    await run(w, job, 5, 70);
    await run(w, job, 5, 90);
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('aguardando além do limiar dispara mesmo sem amostra e conta ao vivo com timeout', async () => {
    const w = world();
    w.setAwaiting(1);
    await w.newJob().runTick();
    expect(w.adoption.countAwaitingCapacity).toHaveBeenCalledWith(120_000, { statementTimeoutMs: 2000 });
    expect(w.scaler.scaleTo).toHaveBeenCalledWith(2);
    expect(w.rows[0]).toMatchObject({ outcome: 'succeeded', reason: 'auto: awaiting', requestId: expect.stringMatching(/^auto:\d+$/) });
  });

  it('sem amostra e sem aguardando: no máximo 1 evento no_samples por hora, sem consultar o escalador', async () => {
    const w = world();
    const job = w.newJob();
    await run(w, job, 59);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', error: NO_SAMPLES_ERROR, reason: 'auto: no_samples' });
    expect(w.scaler.getState).not.toHaveBeenCalled();
    await run(w, job, 2); // lease de 1 h vence estritamente depois de 60 min
    expect(w.rows).toHaveLength(1);
    await run(w, job, 1);
    expect(w.rows).toHaveLength(2);
  });

  it('intervalo mínimo: precondição falha grava 1 evento por hora, não a cada tick', async () => {
    const w = world({ scaleCooldownSeconds: 7200, maxReplicas: 5 });
    w.setAwaiting(3);
    const job = w.newJob();
    await job.runTick();
    expect(w.replicas).toBe(2);
    await run(w, job, 30);
    // Intervalo checado localmente: o provedor só foi lido no 1º tick (estado reaproveitado no pedido).
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    const rejected = w.rows.filter((r) => r.outcome === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ error: 'SCALE_COOLDOWN_ACTIVE', fromReplicas: 2, toReplicas: 3, requestId: null });
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    // 1ª recusa no minuto 5 (antes, o mesmo balde é "já feito"); o lease dela vence após o minuto 65.
    await run(w, job, 35);
    expect(w.rows.filter((r) => r.outcome === 'rejected')).toHaveLength(1);
    await run(w, job, 1);
    expect(w.rows.filter((r) => r.outcome === 'rejected')).toHaveLength(2);
  });

  it('não sobe acima de maxReplicas e recusa 1×/hora', async () => {
    const w = world({ maxReplicas: 1 });
    w.setAwaiting(1);
    const job = w.newJob();
    await run(w, job, 10);
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', error: 'SCALE_TARGET_OUT_OF_RANGE', fromReplicas: 1, toReplicas: 2 });
  });

  it('escalador não configurado vira recusa por hora sem chamar scaleTo', async () => {
    const w = world();
    w.setAwaiting(1);
    w.setState({ status: 'not_configured', missing: ['RENDER_API_KEY'] });
    const job = w.newJob();
    await run(w, job, 3);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', error: 'SCALER_NOT_CONFIGURED' });
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('troca de dono do lease no mesmo balde: requestId estável, sem escalada dupla', async () => {
    const w = world({ scaleCooldownSeconds: 300, maxReplicas: 5 });
    w.setAwaiting(1);
    const a = w.newJob();
    await a.runTick();
    expect(w.replicas).toBe(2);
    // Dono A morre sem soltar o lease; B assume após o vencimento, dentro do mesmo balde de 5 min.
    // Mesmo com o intervalo vencido (simulado pelo cooldown curto) o id repete: já feito, nada
    // chamado nem gravado (o alvo de B seria 3 e o replay estrito daria REQUEST_ID_REUSED).
    w.configure({ scaleCooldownSeconds: 0 });
    w.advance(MIN);
    const b = w.newJob();
    await b.runTick();
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'succeeded', toReplicas: 2 });
  });

  it('corrida no mesmo balde (id gravado entre a checagem e o lock): já feito, sem evento novo', async () => {
    const w = world({ scaleCooldownSeconds: 0, maxReplicas: 5 });
    w.setAwaiting(1);
    const a = w.newJob();
    await a.runTick();
    expect(w.replicas).toBe(2);
    w.advance(MIN);
    // B não vê o id na checagem antecipada (gravado logo depois por A); o lock devolve `existing`.
    w.events.findByRequestId.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await w.newJob().runTick();
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.rows).toHaveLength(1);
  });

  it('falha incerta do POST conta no intervalo: o próximo tick é bloqueado, sem 2º scaleTo', async () => {
    const w = world({ maxReplicas: 5 });
    w.setAwaiting(1);
    w.scaler.scaleTo.mockRejectedValueOnce(new ScalerUnavailableError('timeout', 'write'));
    const job = w.newJob();
    await job.runTick();
    expect(w.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_UNAVAILABLE:timeout', toReplicas: 2 });
    await run(w, job, 10); // baldes seguintes: id novo, mas o intervalo segura (checado localmente)
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    // Sem `succeeded` conhecido as réplicas ficam desconhecidas (0), como nas recusas antes da leitura.
    expect(w.rows.filter((r) => r.outcome === 'rejected')).toEqual([
      expect.objectContaining({ error: 'SCALE_COOLDOWN_ACTIVE', fromReplicas: 0, toReplicas: 0 }),
    ]);
  });

  it('falha certa do POST (recusa do provedor) não segura o intervalo', async () => {
    const w = world({ maxReplicas: 5 });
    w.setAwaiting(1);
    w.scaler.scaleTo.mockRejectedValueOnce(new ScalerUnavailableError('rejected_by_provider', 'write'));
    const job = w.newJob();
    await job.runTick();
    expect(w.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_UNAVAILABLE:rejected_by_provider' });
    await run(w, job, 5); // próximo balde: id novo, sem intervalo
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(2);
    expect(w.replicas).toBe(2);
  });

  it('escalador indisponível na leitura do estado: recusa SCALER_UNAVAILABLE (fase read) 1×/hora', async () => {
    const w = world();
    w.setAwaiting(1);
    w.setState({ status: 'unavailable', reason: 'upstream' } as WorkerScalerState);
    const job = w.newJob();
    await run(w, job, 3);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', error: 'SCALER_UNAVAILABLE:read_upstream' });
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('reinício no meio da janela: a contagem vem das amostras, não do processo', async () => {
    const w = world();
    const first = w.newJob();
    await run(w, first, 10, 90);
    await first.stop();
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
    const second = w.newJob(); // processo novo: sem estado em memória
    await run(w, second, 5, 90);
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it('limpeza de 180 dias 1×/24 h, em qualquer modo', async () => {
    const w = world({ scalerMode: 'off' });
    const job = w.newJob();
    await job.runTick();
    expect(w.events.deleteOlderThan).toHaveBeenCalledTimes(1);
    expect(w.events.deleteOlderThan).toHaveBeenCalledWith(new Date(START.getTime() - SCALE_EVENT_RETENTION_MS));
    await run(w, job, 60 * 23);
    expect(w.events.deleteOlderThan).toHaveBeenCalledTimes(1);
    await run(w, job, 61);
    expect(w.events.deleteOlderThan).toHaveBeenCalledTimes(2);
    expect(w.lease.held.has(AUTOSCALER_CLEANUP_LEASE)).toBe(true);
  });

  it('falha na limpeza não impede a decisão', async () => {
    const w = world();
    w.events.deleteOlderThan.mockRejectedValueOnce(new Error('timeout'));
    w.setAwaiting(1);
    await w.newJob().runTick();
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it('nunca reduz: 3 réplicas e ocupação baixa por 30+ min não pedem escala', async () => {
    const w = world({ maxReplicas: 5 });
    w.setState(ready(3));
    w.persist(5);
    const job = w.newJob();
    await run(w, job, 35, 5);
    expect(w.scaler.getState).not.toHaveBeenCalled();
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
    expect(w.rows.filter((r) => r.outcome === 'succeeded' || r.outcome === 'requested')).toEqual([]);
    expect(w.rows).toEqual([]);
  });

  it('troca de dono com lease VIVO (B no mesmo minuto): B não lê o provedor, não pede nem grava', async () => {
    const w = world({ scaleCooldownSeconds: 0, maxReplicas: 5 });
    w.setAwaiting(1);
    await w.newJob().runTick();
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    const b = w.newJob();
    w.advance(30_000); // lease de A vale até tick − 1 s
    await b.runTick();
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.adoption.countAwaitingCapacity).toHaveBeenCalledTimes(1);
    expect(w.rows).toHaveLength(1);
  });

  it('janela sustentada recomeça depois da subida: amostras velhas não sobem de novo', async () => {
    const w = world({ scaleCooldownSeconds: 0, maxReplicas: 5 });
    const job = w.newJob();
    await run(w, job, 15, 90); // amostras 5, 10, 15 → sobe no minuto 15
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    await run(w, job, 14, 90); // 20 e 25: só 2 amostras depois da subida
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    await run(w, job, 1, 90); // 30: 3ª amostra nova
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(2);
    expect(w.replicas).toBe(3);
  });

  it('adoção desligada: não conta aguardando nem lê amostras/provedor; ADOPTION_DISABLED 1×/hora', async () => {
    const w = world();
    w.setAdoption(false);
    w.setAwaiting(5);
    w.persist(99);
    const job = w.newJob();
    await run(w, job, 59);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ outcome: 'rejected', error: 'ADOPTION_DISABLED', reason: 'auto: adoption_disabled', requestId: null });
    expect(w.adoption.countAwaitingCapacity).not.toHaveBeenCalled();
    expect(w.samples.listSince).not.toHaveBeenCalled();
    expect(w.scaler.getState).not.toHaveBeenCalled();
    await run(w, job, 2);
    expect(w.rows).toHaveLength(1);
    await run(w, job, 1);
    expect(w.rows).toHaveLength(2);
  });

  it('último succeeded já no maxReplicas: recusa 1×/hora sem ler o provedor', async () => {
    const w = world({ scaleCooldownSeconds: 0, maxReplicas: 2 });
    w.setAwaiting(1);
    const job = w.newJob();
    await job.runTick();
    expect(w.replicas).toBe(2);
    await run(w, job, 20);
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    expect(w.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(w.rows.filter((r) => r.outcome === 'rejected')).toEqual([
      expect.objectContaining({ error: 'SCALE_TARGET_OUT_OF_RANGE', fromReplicas: 2, toReplicas: 3 }),
    ]);
  });

  it('corrida no lock com intervalo > 0: recusa do execute não é gravada por ele; job grava 1×/hora', async () => {
    const w = world({ scaleCooldownSeconds: 1800, maxReplicas: 5 });
    w.setAwaiting(1);
    // Pedido manual entra entre a checagem do job e o lock: o lock devolve `blocked`.
    w.events.recordRequestedIfIdle.mockImplementationOnce(async () => {
      await w.events.record({ trigger: 'manual', actorUserId: 'u1', fromReplicas: 1, toReplicas: 2, reason: 'pico', outcome: 'requested' });
      return { blocked: new Date(START.getTime() + 1800_000) };
    });
    const job = w.newJob();
    await job.runTick();
    await run(w, job, 12); // baldes 5 e 10: intervalo ativo visto localmente, mesma recusa silenciada
    expect(w.events.recordRequestedIfIdle).toHaveBeenCalledTimes(1);
    expect(w.scaler.getState).toHaveBeenCalledTimes(1);
    expect(w.scaler.scaleTo).not.toHaveBeenCalled();
    expect(w.rows.filter((r) => r.trigger === 'auto')).toEqual([
      expect.objectContaining({ outcome: 'rejected', error: 'SCALE_COOLDOWN_ACTIVE', fromReplicas: 1, toReplicas: 2, requestId: null }),
    ]);
    expect(w.events.record).toHaveBeenCalledTimes(2); // o manual + a recusa do job (o execute não gravou)
  });
});
