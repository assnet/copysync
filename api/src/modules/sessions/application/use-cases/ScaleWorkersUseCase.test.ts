import { describe, it, expect, vi } from 'vitest';
import { ScaleWorkersUseCase, type ScaleWorkersInput } from './ScaleWorkersUseCase';
import { makeAuditRepo } from './sessionTestFakes';
import { workerScalingEnforcedCheck } from './GetWorkerScalingSettingsUseCase';
import {
  countsForScaleCooldown,
  isUncertainScaleFailure,
  type IWorkerScaleEventRepository,
  type NewWorkerScaleEvent,
  type RecordRequestedResult,
  type WorkerScaleEvent,
  type WorkerScaleOutcome,
} from '../../domain/contracts/IWorkerScaleEventRepository';
import type { IWorkerScaler, WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import {
  defaultWorkerScalingSettings,
  type WorkerScalingSettings,
} from '../../domain/services/workerScalingSettings';
import { ScalerRateLimitedError, ScalerUnavailableError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { RenderWorkerScaler } from '../../infrastructure/scaler/RenderWorkerScaler';

const NOW = new Date('2026-11-11T12:00:00.000Z');

function makeEvents(lastCooldownStartAt: Date | null = null) {
  const rows: WorkerScaleEvent[] = [];
  let seq = 0;
  const repo = {
    rows,
    record: vi.fn(async (e: NewWorkerScaleEvent) => {
      if (e.requestId && rows.some((r) => r.requestId === e.requestId)) throw new Error('unique');
      const id = ++seq;
      rows.push({ id, at: NOW, error: null, requestId: null, ...e } as WorkerScaleEvent);
      return id;
    }),
    updateOutcome: vi.fn(async (id: number, outcome: WorkerScaleOutcome, error?: string | null) => {
      const row = rows.find((r) => r.id === id)!;
      row.outcome = outcome;
      row.error = error ?? null;
    }),
    recordRequestedIfIdle: vi.fn(async ({ evt, cooldownSeconds, now }: { evt: Omit<NewWorkerScaleEvent, 'outcome' | 'error'>; cooldownSeconds: number; now: Date }): Promise<RecordRequestedResult> => {
      const existing = evt.requestId ? rows.find((r) => r.requestId === evt.requestId) : undefined;
      if (existing) return { existing };
      const counted = rows.filter(countsForScaleCooldown).map((r) => r.at);
      if (lastCooldownStartAt) counted.push(lastCooldownStartAt);
      const last = counted.sort((a, b) => b.getTime() - a.getTime())[0];
      if (last && last.getTime() + cooldownSeconds * 1000 > now.getTime()) {
        return { blocked: new Date(last.getTime() + cooldownSeconds * 1000) };
      }
      return { id: await repo.record({ ...evt, outcome: 'requested', error: null }) };
    }),
    lastCooldownStartAt: vi.fn(async () => lastCooldownStartAt),
    findByRequestId: vi.fn(async (id: string) => rows.find((r) => r.requestId === id) ?? null),
    list: vi.fn(),
    deleteOlderThan: vi.fn(),
  };
  return repo as typeof repo & IWorkerScaleEventRepository;
}

const ready = (desiredReplicas = 2, over: Partial<Extract<WorkerScalerState, { status: 'ready' }>> = {}): WorkerScalerState => ({
  status: 'ready',
  desiredReplicas,
  runningReplicas: desiredReplicas,
  hasDisk: false,
  autoscalingEnabled: false,
  ...over,
});

function makeScaler(state: WorkerScalerState = ready()) {
  return { getState: vi.fn(async () => state), scaleTo: vi.fn(async () => undefined) } as IWorkerScaler & {
    getState: ReturnType<typeof vi.fn>;
    scaleTo: ReturnType<typeof vi.fn>;
  };
}

const settingsOf = (over: Partial<WorkerScalingSettings> = {}): IWorkerScalingSettingsProvider => {
  const value = {
    ...defaultWorkerScalingSettings({ maxSessionsPerWorker: 100, maxPendingLoginsPerWorker: 10 }),
    scalerMode: 'manual' as const,
    minReplicas: 1,
    maxReplicas: 5,
    alertOccupancyRatio: 0.8,
    scaleCooldownSeconds: 600,
    ...over,
  };
  return { current: () => ({ value, origin: {} as never }), refresh: vi.fn(), start: vi.fn(), stop: vi.fn() };
};

function setup(opts: {
  settings?: Partial<WorkerScalingSettings>;
  state?: WorkerScalerState;
  adoption?: boolean | (() => Promise<boolean> | boolean);
  last?: Date | null;
} = {}) {
  const events = makeEvents(opts.last ?? null);
  const scaler = makeScaler(opts.state ?? ready());
  const audit = makeAuditRepo();
  const log = { warn: vi.fn() };
  const useCase = new ScaleWorkersUseCase({
    events,
    scaler,
    audit,
    settings: settingsOf(opts.settings),
    isAdoptionEnabled: typeof opts.adoption === 'function' ? opts.adoption : () => (opts.adoption as boolean | undefined) ?? true,
    log,
    now: () => NOW,
  });
  return { events, scaler, audit, log, useCase };
}

const input = (over: Partial<ScaleWorkersInput> = {}): ScaleWorkersInput => ({
  replicas: 3,
  reason: 'pico',
  requestId: 'req-1',
  trigger: 'manual',
  actorUserId: 'u1',
  connected: 0,
  ...over,
});

async function expectRejected(ctx: ReturnType<typeof setup>, i: ScaleWorkersInput, code: string, fromReplicas: number) {
  await expect(ctx.useCase.execute(i)).rejects.toMatchObject({ code });
  expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
  expect(ctx.events.rows).toHaveLength(1);
  expect(ctx.events.rows[0]).toMatchObject({ outcome: 'rejected', error: code, requestId: null, fromReplicas });
  expect(ctx.audit.create).not.toHaveBeenCalled();
}

describe('ScaleWorkersUseCase — recusas', () => {
  it('modo off → SCALER_MODE_OFF sem ler o escalador', async () => {
    const ctx = setup({ settings: { scalerMode: 'off' } });
    await expectRejected(ctx, input(), 'SCALER_MODE_OFF', 0);
    expect(ctx.scaler.getState).not.toHaveBeenCalled();
  });

  it('adoção desligada → ADOPTION_DISABLED', async () => {
    await expectRejected(setup({ adoption: false }), input(), 'ADOPTION_DISABLED', 0);
  });

  it('flag local off sem batimento vivo → ADOPTION_DISABLED (mesma checagem do enforced)', async () => {
    const check = workerScalingEnforcedCheck(() => false, { hasAlive: async () => false }, { warn: vi.fn() });
    await expectRejected(setup({ adoption: check }), input(), 'ADOPTION_DISABLED', 0);
  });

  it('falha da consulta de batimento cai na flag local (off) → ADOPTION_DISABLED', async () => {
    const check = workerScalingEnforcedCheck(() => false, { hasAlive: async () => { throw new Error('db'); } }, { warn: vi.fn() });
    await expectRejected(setup({ adoption: check }), input(), 'ADOPTION_DISABLED', 0);
  });

  it.each([0, 6, 2.5])('alvo %s fora da faixa → SCALE_TARGET_OUT_OF_RANGE com campo replicas', async (replicas) => {
    const ctx = setup();
    await expect(ctx.useCase.execute(input({ replicas }))).rejects.toMatchObject({
      code: 'SCALE_TARGET_OUT_OF_RANGE',
      statusCode: 400,
      meta: { field: 'replicas', min: 1, max: 5 },
    });
    expect(ctx.events.rows[0].outcome).toBe('rejected');
  });

  it('escalador não configurado → SCALER_NOT_CONFIGURED com missing', async () => {
    const ctx = setup({ state: { status: 'not_configured', missing: ['RENDER_API_KEY'] } });
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ meta: { missing: ['RENDER_API_KEY'] } });
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'rejected', error: 'SCALER_NOT_CONFIGURED' });
  });

  it('escalador indisponível → SCALER_UNAVAILABLE / SCALER_RATE_LIMITED', async () => {
    await expectRejected(setup({ state: { status: 'unavailable', reason: 'timeout' } }), input(), 'SCALER_UNAVAILABLE', 0);
    await expectRejected(setup({ state: { status: 'unavailable', reason: 'rate_limited' } }), input(), 'SCALER_RATE_LIMITED', 0);
  });

  it('limite do provedor no estado: retryAt preservado na recusa', async () => {
    const ctx = setup({ state: { status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 30 } });
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
      code: 'SCALER_RATE_LIMITED',
      statusCode: 429,
      meta: { retryAfterSeconds: 30, retryAt: new Date(NOW.getTime() + 30_000).toISOString() },
    });
  });

  it('serviço com disco ou autoescala nativa → SCALER_SERVICE_NOT_SCALABLE', async () => {
    await expectRejected(setup({ state: ready(2, { hasDisk: true }) }), input(), 'SCALER_SERVICE_NOT_SCALABLE', 2);
    await expectRejected(setup({ state: ready(2, { autoscalingEnabled: true }) }), input(), 'SCALER_SERVICE_NOT_SCALABLE', 2);
  });

  it('dentro do intervalo mínimo → SCALE_COOLDOWN_ACTIVE com retryAt', async () => {
    const ctx = setup({ last: new Date(NOW.getTime() - 60_000) });
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
      code: 'SCALE_COOLDOWN_ACTIVE',
      meta: { retryAt: new Date(NOW.getTime() + 540_000).toISOString() },
    });
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'rejected', fromReplicas: 2 });
  });

  it('intervalo vencido libera o pedido', async () => {
    const ctx = setup({ last: new Date(NOW.getTime() - 600_000) });
    await ctx.useCase.execute(input());
    expect(ctx.scaler.scaleTo).toHaveBeenCalledWith(3);
  });

  it('redução sem capacidade → SCALE_DOWN_WOULD_EXCEED_CAPACITY com os números', async () => {
    const ctx = setup({ state: ready(3) });
    await expect(ctx.useCase.execute(input({ replicas: 2, connected: 161 }))).rejects.toMatchObject({
      code: 'SCALE_DOWN_WOULD_EXCEED_CAPACITY',
      meta: { replicas: 2, maxSessionsPerWorker: 100, ratio: 0.8, connected: 161, capacity: 160 },
    });
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'rejected', fromReplicas: 3, toReplicas: 2 });
  });

  it('redução com capacidade passa', async () => {
    const ctx = setup({ state: ready(3) });
    const res = await ctx.useCase.execute(input({ replicas: 2, connected: 160 }));
    expect(res.event.outcome).toBe('succeeded');
  });

  it('alvo igual ao atual → SCALE_TARGET_UNCHANGED sem chamada', async () => {
    await expectRejected(setup({ state: ready(3) }), input({ replicas: 3 }), 'SCALE_TARGET_UNCHANGED', 3);
  });

  it('automático só sobe uma réplica', async () => {
    const auto = { trigger: 'auto' as const, actorUserId: null, requestId: null };
    await expectRejected(setup({ state: ready(2) }), input({ ...auto, replicas: 4 }), 'SCALE_TARGET_OUT_OF_RANGE', 2);
    await expectRejected(setup({ state: ready(2) }), input({ ...auto, replicas: 1 }), 'SCALE_TARGET_OUT_OF_RANGE', 2);
    const ctx = setup({ state: ready(2) });
    await ctx.useCase.execute(input({ ...auto, replicas: 3 }));
    expect(ctx.scaler.scaleTo).toHaveBeenCalledWith(3);
  });
});

describe('ScaleWorkersUseCase — pedido aceito', () => {
  it('flag local off com batimento vivo de outro processo → aceita (http e worker separados)', async () => {
    const hasAlive = vi.fn(async () => true);
    const ctx = setup({ adoption: workerScalingEnforcedCheck(() => false, { hasAlive }, { warn: vi.fn() }) });
    const res = await ctx.useCase.execute(input());
    expect(res.event.outcome).toBe('succeeded');
    expect(ctx.scaler.scaleTo).toHaveBeenCalledWith(3);
    expect(hasAlive).toHaveBeenCalled();
  });

  it('grava requested antes da chamada, depois succeeded, e audita o ator', async () => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockImplementation(async () => {
      expect(ctx.events.rows[0].outcome).toBe('requested');
    });
    const res = await ctx.useCase.execute(input());
    expect(res.replayed).toBe(false);
    expect(res.event).toMatchObject({ outcome: 'succeeded', fromReplicas: 2, toReplicas: 3, requestId: 'req-1' });
    expect(ctx.events.rows[0].outcome).toBe('succeeded');
    expect(ctx.audit.create).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'WORKER_SCALE_REQUESTED',
      meta: expect.objectContaining({ fromReplicas: 2, toReplicas: 3, outcome: 'succeeded', reason: 'pico' }),
    });
  });

  it('falha do escalador → failed com código curto, auditoria e relança', async () => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValue(new ScalerUnavailableError('timeout'));
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
      code: 'SCALER_UNAVAILABLE',
      meta: { reason: 'timeout', uncertain: true },
    });
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_UNAVAILABLE:timeout' });
    expect(ctx.audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ outcome: 'failed' }) }),
    );
  });

  it('erro desconhecido → SCALE_REQUEST_FAILED (503) sem a mensagem original no erro nem no log', async () => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValue(new Error('Bearer rnd_secret'));
    const err = (await ctx.useCase.execute(input()).catch((e: unknown) => e)) as Error & { meta?: unknown };
    expect(err).toMatchObject({ code: 'SCALE_REQUEST_FAILED', statusCode: 503, meta: { uncertain: true } });
    expect(err.message).not.toContain('rnd_secret');
    expect(JSON.stringify(err.meta ?? null)).not.toContain('rnd_secret');
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALE_REQUEST_FAILED' });
    expect(ctx.log.warn).toHaveBeenCalled();
    expect(JSON.stringify(ctx.log.warn.mock.calls)).not.toContain('rnd_secret');
    expect(JSON.stringify(ctx.audit.create.mock.calls)).not.toContain('rnd_secret');
  });

  it('429 do provedor no scaleTo: relança com retryAt', async () => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValue(new ScalerRateLimitedError(12, NOW));
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
      code: 'SCALER_RATE_LIMITED',
      meta: { retryAt: new Date(NOW.getTime() + 12_000).toISOString() },
    });
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_RATE_LIMITED' });
  });

  it.each(['updateOutcome', 'audit'] as const)('falha de escrita (%s) depois do scaleTo aceito: sucesso com warn', async (what) => {
    const ctx = setup();
    if (what === 'updateOutcome') ctx.events.updateOutcome.mockRejectedValueOnce(new Error('db down secret'));
    else ctx.audit.create.mockRejectedValueOnce(new Error('db down secret'));
    const res = await ctx.useCase.execute(input());
    expect(res).toMatchObject({ replayed: false, event: { outcome: 'succeeded', toReplicas: 3 } });
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1, outcome: 'succeeded' }), expect.any(String));
    expect(JSON.stringify(ctx.log.warn.mock.calls)).not.toContain('secret');
    if (what === 'updateOutcome') expect(ctx.events.rows[0].outcome).toBe('requested');
  });

  it('linha que ficou requested segura o intervalo mínimo do pedido seguinte', async () => {
    const ctx = setup();
    ctx.events.updateOutcome.mockRejectedValueOnce(new Error('db'));
    await ctx.useCase.execute(input());
    // checagem antecipada lê `lastCooldownStartAt` (fixo no fake); o lock vê a linha `requested`
    await expect(ctx.useCase.execute(input({ requestId: 'req-2', replicas: 4 }))).rejects.toMatchObject({
      code: 'SCALE_COOLDOWN_ACTIVE',
    });
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', new ScalerUnavailableError('timeout')],
    ['5xx', new ScalerUnavailableError('upstream')],
    ['erro desconhecido', new Error('boom')],
  ])('falha incerta (%s) segura o intervalo mínimo do pedido seguinte', async (_label, err) => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValueOnce(err);
    await expect(ctx.useCase.execute(input())).rejects.toBeTruthy();
    expect(ctx.events.rows[0].outcome).toBe('failed');
    await expect(ctx.useCase.execute(input({ requestId: 'req-2' }))).rejects.toMatchObject({
      code: 'SCALE_COOLDOWN_ACTIVE',
      meta: { retryAt: new Date(NOW.getTime() + 600_000).toISOString() },
    });
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', new ScalerUnavailableError('timeout', 'read')],
    ['5xx', new ScalerUnavailableError('upstream', 'read')],
  ])('falha na leitura antes do POST (%s) grava read_* e não segura o intervalo', async (_label, err) => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValueOnce(err);
    const thrown = await ctx.useCase.execute(input()).catch((e) => e);
    expect(thrown).toBe(err);
    expect(thrown.meta.uncertain).toBeUndefined();
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: `SCALER_UNAVAILABLE:read_${err.reason}` });
    expect(isUncertainScaleFailure('failed', ctx.events.rows[0].error)).toBe(false);
    const res = await ctx.useCase.execute(input({ requestId: 'req-2' }));
    expect(res.event.outcome).toBe('succeeded');
  });

  describe('com o RenderWorkerScaler real (fetchFn falso, sem rede)', () => {
    const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const serviceBody = { serviceDetails: { numInstances: 2, autoscaling: null, disk: null } };
    function withRealScaler(fail: 'service' | 'scale') {
      const fetchFn = vi.fn(async (url: string | URL | Request) => {
        const isScale = String(url).endsWith('/scale');
        if ((fail === 'scale') === isScale) throw timeout();
        return new Response(isScale ? null : JSON.stringify(serviceBody), { status: isScale ? 202 : 200 });
      });
      const ctx = setup();
      const real = new RenderWorkerScaler({ apiKey: 'k', serviceId: 's', baseUrl: 'http://render.invalid/v1', fetchFn });
      ctx.scaler.scaleTo.mockImplementationOnce((n: number) => real.scaleTo(n));
      return { ctx, fetchFn };
    }

    it('timeout no GET dentro do scaleTo não conta no intervalo', async () => {
      const { ctx, fetchFn } = withRealScaler('service');
      await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ code: 'SCALER_UNAVAILABLE', meta: { reason: 'timeout', phase: 'read' } });
      expect(fetchFn.mock.calls.some(([u]) => String(u).endsWith('/scale'))).toBe(false);
      expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_UNAVAILABLE:read_timeout' });
      const res = await ctx.useCase.execute(input({ requestId: 'req-2' }));
      expect(res.event.outcome).toBe('succeeded');
    });

    it('timeout no POST conta no intervalo', async () => {
      const { ctx } = withRealScaler('scale');
      await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
        code: 'SCALER_UNAVAILABLE',
        meta: { reason: 'timeout', uncertain: true },
      });
      expect(ctx.events.rows[0]).toMatchObject({ outcome: 'failed', error: 'SCALER_UNAVAILABLE:timeout' });
      await expect(ctx.useCase.execute(input({ requestId: 'req-2' }))).rejects.toMatchObject({ code: 'SCALE_COOLDOWN_ACTIVE' });
    });
  });

  it.each([
    ['auth', new ScalerUnavailableError('auth')],
    ['not_found', new ScalerUnavailableError('not_found')],
    ['429', new ScalerRateLimitedError(null, NOW)],
  ])('falha certa (%s) não segura o intervalo mínimo', async (_label, err) => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValueOnce(err);
    await expect(ctx.useCase.execute(input())).rejects.toBe(err);
    expect((err as { meta?: Record<string, unknown> }).meta?.uncertain).toBeUndefined();
    const res = await ctx.useCase.execute(input({ requestId: 'req-2' }));
    expect(res.event.outcome).toBe('succeeded');
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(2);
  });

  it('intervalo ocupado no lock (corrida entre requestId diferentes) → rejected sem scaleTo', async () => {
    const ctx = setup();
    ctx.events.recordRequestedIfIdle.mockResolvedValueOnce({ blocked: new Date(NOW.getTime() + 600_000) });
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({
      code: 'SCALE_COOLDOWN_ACTIVE',
      meta: { retryAt: new Date(NOW.getTime() + 600_000).toISOString() },
    });
    expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
    expect(ctx.events.rows).toEqual([expect.objectContaining({ outcome: 'rejected', requestId: null, fromReplicas: 2 })]);
  });

  it('automático (sem ator) não audita', async () => {
    const ctx = setup();
    await ctx.useCase.execute(input({ trigger: 'auto', actorUserId: null, requestId: null }));
    expect(ctx.events.rows[0]).toMatchObject({ outcome: 'succeeded', actorUserId: null, trigger: 'auto' });
    expect(ctx.audit.create).not.toHaveBeenCalled();
  });
});

describe('ScaleWorkersUseCase — idempotência', () => {
  it('requestId repetido devolve o evento anterior sem chamar de novo', async () => {
    const ctx = setup();
    const first = await ctx.useCase.execute(input());
    const again = await ctx.useCase.execute(input());
    expect(again.replayed).toBe(true);
    expect(again.event.id).toBe(first.event.id);
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(ctx.scaler.getState).toHaveBeenCalledTimes(1);
    expect(ctx.events.rows).toHaveLength(1);
  });

  it.each<[string, Partial<ScaleWorkersInput>, string | null]>([
    ['mesmo corpo → replay', {}, null],
    ['outro alvo → REQUEST_ID_REUSED', { replicas: 4 }, 'REQUEST_ID_REUSED'],
  ])('corrida sob o lock (existing do repositório), %s, sem rejected espúrio', async (_n, over, code) => {
    const ctx = setup();
    const winner = { id: 9, at: NOW, trigger: 'manual', actorUserId: 'u1', fromReplicas: 2, toReplicas: 3, reason: 'pico', outcome: 'requested', error: null, requestId: 'req-1' } as WorkerScaleEvent;
    ctx.events.recordRequestedIfIdle.mockResolvedValueOnce({ existing: winner });
    const run = ctx.useCase.execute(input(over));
    if (code) await expect(run).rejects.toMatchObject({ code, statusCode: 409 });
    else await expect(run).resolves.toEqual({ event: winner, replayed: true });
    expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
    expect(ctx.events.record).not.toHaveBeenCalled();
  });

  it('corrida: unicidade barra o segundo record e devolve o vencedor', async () => {
    const ctx = setup();
    const winner = { id: 9, at: NOW, trigger: 'manual', actorUserId: 'u1', fromReplicas: 2, toReplicas: 3, reason: 'x', outcome: 'requested', error: null, requestId: 'req-1' } as WorkerScaleEvent;
    const winnerOf = (reason: string) => ({ ...winner, reason });
    ctx.events.findByRequestId.mockResolvedValueOnce(null).mockResolvedValueOnce(winnerOf('pico'));
    ctx.events.recordRequestedIfIdle.mockRejectedValueOnce(new Error('unique'));
    const res = await ctx.useCase.execute(input());
    expect(res).toEqual({ event: winnerOf('pico'), replayed: true });
    expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<ScaleWorkersInput>]>([
    ['outro alvo', { replicas: 4 }],
    ['outro motivo', { reason: 'outro' }],
    ['outro ator', { actorUserId: 'u2' }],
  ])('mesmo requestId com %s → REQUEST_ID_REUSED (409) sem chamar', async (_n, over) => {
    const ctx = setup();
    await ctx.useCase.execute(input());
    await expect(ctx.useCase.execute(input(over))).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED', statusCode: 409 });
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(ctx.events.rows).toHaveLength(1);
  });

  it('replay de pedido failed devolve o failed sem chamar de novo', async () => {
    const ctx = setup();
    ctx.scaler.scaleTo.mockRejectedValueOnce(new ScalerUnavailableError('timeout'));
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ code: 'SCALER_UNAVAILABLE' });
    const again = await ctx.useCase.execute(input());
    expect(again).toMatchObject({ replayed: true, event: { outcome: 'failed', error: 'SCALER_UNAVAILABLE:timeout' } });
    expect(ctx.scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it('corrida com o mesmo requestId e corpo diferente → REQUEST_ID_REUSED', async () => {
    const ctx = setup();
    const other = { id: 9, at: NOW, trigger: 'manual', actorUserId: 'u1', fromReplicas: 2, toReplicas: 5, reason: 'pico', outcome: 'requested', error: null, requestId: 'req-1' } as WorkerScaleEvent;
    ctx.events.findByRequestId.mockResolvedValueOnce(null).mockResolvedValueOnce(other);
    ctx.events.recordRequestedIfIdle.mockRejectedValueOnce(new Error('unique'));
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
    expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('recusa não guarda requestId: o mesmo pedido pode ser refeito', async () => {
    const ctx = setup({ adoption: false });
    await expect(ctx.useCase.execute(input())).rejects.toMatchObject({ code: 'ADOPTION_DISABLED' });
    expect(ctx.events.findByRequestId).toHaveBeenCalledWith('req-1');
    expect(ctx.events.rows[0].requestId).toBeNull();
  });
});

describe('ScaleWorkersUseCase.checkPreconditions', () => {
  it('passa sem gravar nem chamar scaleTo', async () => {
    const ctx = setup();
    await expect(ctx.useCase.checkPreconditions(input())).resolves.toEqual({ fromReplicas: 2 });
    expect(ctx.events.record).not.toHaveBeenCalled();
    expect(ctx.scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('recusa lança o mesmo erro sem gravar evento', async () => {
    const ctx = setup({ last: NOW });
    await expect(ctx.useCase.checkPreconditions(input())).rejects.toMatchObject({ code: 'SCALE_COOLDOWN_ACTIVE' });
    expect(ctx.events.record).not.toHaveBeenCalled();
    expect(ctx.audit.create).not.toHaveBeenCalled();
  });
});

describe('isUncertainScaleFailure / countsForScaleCooldown', () => {
  it.each([
    ['failed', 'SCALER_UNAVAILABLE:timeout', true],
    ['failed', 'SCALER_UNAVAILABLE:upstream', true],
    ['failed', 'SCALE_REQUEST_FAILED', true],
    ['failed', 'SCALER_UNAVAILABLE:auth', false],
    ['failed', 'SCALER_UNAVAILABLE:not_found', false],
    ['failed', 'SCALER_UNAVAILABLE:read_timeout', false],
    ['failed', 'SCALER_UNAVAILABLE:read_upstream', false],
    ['failed', 'SCALER_RATE_LIMITED', false],
    ['failed', 'SCALER_SERVICE_NOT_SCALABLE:disk', false],
    ['failed', null, false],
    ['rejected', 'SCALE_REQUEST_FAILED', false],
  ] as const)('%s + %s → incerta %s', (outcome, error, expected) => {
    expect(isUncertainScaleFailure(outcome, error)).toBe(expected);
    expect(countsForScaleCooldown({ outcome, error })).toBe(expected);
  });

  it('requested e succeeded sempre contam', () => {
    expect(countsForScaleCooldown({ outcome: 'requested', error: null })).toBe(true);
    expect(countsForScaleCooldown({ outcome: 'succeeded' })).toBe(true);
  });
});
