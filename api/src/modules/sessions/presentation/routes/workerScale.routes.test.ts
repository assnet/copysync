import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { workerAdminRoutes } from './workerAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaWorkerScaleEventRepository } from '../../infrastructure/repositories/PrismaWorkerScaleEventRepository';
import { RefreshingWorkerScalingSettingsProvider } from '../../infrastructure/lease/RefreshingWorkerScalingSettingsProvider';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaOpsMetricsSampleRepository } from '../../../metrics/infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { PrismaWorkerCapacityReader } from '../../infrastructure/repositories/PrismaWorkerCapacityReader';
import { workerScalerStateCache } from '../../infrastructure/lease/sessionLeaseContainer';
import type { WorkerScaleEvent } from '../../domain/contracts/IWorkerScaleEventRepository';
import type { WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import { ScalerRateLimitedError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { WORKER_SCALE_EVENTS_PAGE_SIZE } from '../../application/use-cases/ListWorkerScaleEventsUseCase';

/* Sem banco nem rede: Prisma vazio, escalador falso, repositórios espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const adoption = vi.hoisted(() => ({ enabled: true }));
const scaler = vi.hoisted(() => ({ getState: vi.fn(), scaleTo: vi.fn() }));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => ({ enabled: adoption.enabled, shard: null }),
  workerScalingEnvDefaults: () => ({ maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50 }),
}));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../infrastructure/scaler/workerScaler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/scaler/workerScaler')>()),
  workerScaler: () => scaler,
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/admin/workers/scale';
const REQUEST_ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const at = new Date('2026-11-11T12:00:00.000Z');
const settings: WorkerScalingSettings = {
  maxSessionsPerWorker: 40,
  maxPendingLoginsPerWorker: 50,
  alertOccupancyRatio: 0.5,
  awaitingAlertSeconds: 120,
  scalerMode: 'manual',
  minReplicas: 1,
  maxReplicas: 4,
  scaleUpSustainSeconds: 900,
  scaleCooldownSeconds: 600,
};
const ready = { status: 'ready', desiredReplicas: 2, runningReplicas: 2, hasDisk: false, autoscalingEnabled: false } as const;
const event = (over: Partial<WorkerScaleEvent> = {}): WorkerScaleEvent => ({
  id: 7, at, trigger: 'manual', actorUserId: 'user-a', fromReplicas: 2, toReplicas: 3,
  reason: 'pico de sessões', outcome: 'succeeded', error: null, requestId: REQUEST_ID, ...over,
});
const publicEvent = (e: WorkerScaleEvent) => ({
  id: e.id, at: e.at.toISOString(), trigger: e.trigger, fromReplicas: e.fromReplicas, toReplicas: e.toReplicas,
  reason: e.reason, outcome: e.outcome, error: e.error,
});

let app: FastifyInstance;
let events: Record<'findByRequestId' | 'record' | 'recordRequestedIfIdle' | 'updateOutcome' | 'lastCooldownStartAt' | 'list', ReturnType<typeof vi.fn>>;
let audit: ReturnType<typeof vi.fn>;
let listSince: ReturnType<typeof vi.fn>;

function useSettings(over: Partial<WorkerScalingSettings> = {}) {
  vi.spyOn(RefreshingWorkerScalingSettingsProvider.prototype, 'current')
    .mockReturnValue({ value: { ...settings, ...over }, origin: {} as never });
}

beforeEach(async () => {
  auth.isSuperAdmin = true;
  adoption.enabled = true;
  scaler.getState.mockReset().mockResolvedValue(ready);
  scaler.scaleTo.mockReset().mockResolvedValue(undefined);
  workerScalerStateCache().invalidate();
  useSettings();
  const proto = PrismaWorkerScaleEventRepository.prototype;
  events = {
    findByRequestId: vi.spyOn(proto, 'findByRequestId').mockResolvedValue(null),
    record: vi.spyOn(proto, 'record').mockResolvedValue(7),
    recordRequestedIfIdle: vi.spyOn(proto, 'recordRequestedIfIdle').mockResolvedValue({ id: 7 }),
    updateOutcome: vi.spyOn(proto, 'updateOutcome').mockResolvedValue(undefined),
    lastCooldownStartAt: vi.spyOn(proto, 'lastCooldownStartAt').mockResolvedValue(null),
    list: vi.spyOn(proto, 'list').mockResolvedValue({ items: [], nextBeforeId: null }),
  } as never;
  audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined as never) as never;
  listSince = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'listSince').mockImplementation(async (metric) =>
    metric === 'sessions_connected'
      ? [{ at: new Date(), source: 'sessions', resource: 'cluster', metric, value: 30, meta: null }]
      : []) as never;
  vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'hasAlive').mockResolvedValue(false);
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(workerAdminRoutes, { prefix: '/api/admin/workers' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: URL, payload });
const body = (over: Record<string, unknown> = {}) => ({ replicas: 3, reason: 'pico de sessões', requestId: REQUEST_ID, ...over });

describe('rotas de escala: acesso', () => {
  it('sem super-admin: 401 nas três rotas, sem escalador nem banco', async () => {
    auth.isSuperAdmin = false;
    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
    expect((await post(body())).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${URL}/events` })).statusCode).toBe(401);
    expect(scaler.getState).not.toHaveBeenCalled();
    expect(scaler.scaleTo).not.toHaveBeenCalled();
    expect(events.list).not.toHaveBeenCalled();
  });
});

describe('GET /admin/workers/scale', () => {
  it('estado, faixa, intervalo mínimo e último evento sem ator; 2 GETs = 1 getState', async () => {
    const last = new Date(Date.now() - 60_000);
    events.lastCooldownStartAt.mockResolvedValue(last);
    events.list.mockResolvedValue({ items: [event()], nextBeforeId: 7 });
    const first = await app.inject({ method: 'GET', url: URL });
    const second = await app.inject({ method: 'GET', url: URL });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(scaler.getState).toHaveBeenCalledTimes(1);
    expect(events.list).toHaveBeenCalledWith({ limit: 1 });
    expect(first.json()).toEqual({
      success: true,
      data: {
        scaler: ready,
        settings: { scalerMode: 'manual', minReplicas: 1, maxReplicas: 4, scaleCooldownSeconds: 600 },
        cooldownUntil: new Date(last.getTime() + 600_000).toISOString(),
        lastEvent: publicEvent(event()),
        enforced: true,
      },
    });
    expect(first.body).not.toContain('user-a');
    expect(first.body).not.toContain(REQUEST_ID);
  });

  it('não configurado: só os nomes do que falta; intervalo vencido = null', async () => {
    scaler.getState.mockResolvedValue({ status: 'not_configured', missing: ['RENDER_API_KEY', 'WORKER_SCALER_SERVICE_ID'] });
    events.lastCooldownStartAt.mockResolvedValue(new Date(Date.now() - 3_600_000));
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      scaler: { status: 'not_configured', missing: ['RENDER_API_KEY', 'WORKER_SCALER_SERVICE_ID'] },
      cooldownUntil: null,
      lastEvent: null,
    });
  });
});

describe('POST /admin/workers/scale', () => {
  it('sucesso: lê ao vivo, conectadas da amostra, audita, invalida o cache', async () => {
    await app.inject({ method: 'GET', url: URL }); // aquece o cache
    const res = await post(body({ reason: '  pico de sessões  ' }));
    expect(res.statusCode).toBe(200);
    const { at: _at, ...rest } = publicEvent(event());
    expect(res.json()).toEqual({ success: true, data: { event: { ...rest, at: expect.any(String) }, replayed: false } });
    expect(scaler.scaleTo).toHaveBeenCalledWith(3);
    expect(listSince).toHaveBeenCalledWith('sessions_connected', expect.any(Date));
    expect(events.recordRequestedIfIdle).toHaveBeenCalledWith({
      evt: expect.objectContaining({
        trigger: 'manual', actorUserId: 'user-a', fromReplicas: 2, toReplicas: 3, reason: 'pico de sessões', requestId: REQUEST_ID,
      }),
      cooldownSeconds: 600,
      now: expect.any(Date),
    });
    expect(events.updateOutcome).toHaveBeenCalledWith(7, 'succeeded', null);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', action: 'WORKER_SCALE_REQUESTED' }));
    // GET (1) + POST ao vivo (1) + GET depois da invalidação (1)
    await app.inject({ method: 'GET', url: URL });
    expect(scaler.getState).toHaveBeenCalledTimes(3);
  });

  it('replay do mesmo requestId: devolve o evento anterior sem chamar o escalador', async () => {
    events.findByRequestId.mockResolvedValue(event());
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ event: publicEvent(event()), replayed: true });
    expect(scaler.getState).not.toHaveBeenCalled();
    expect(scaler.scaleTo).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
    expect(events.recordRequestedIfIdle).not.toHaveBeenCalled();
  });

  it('replay com o mesmo requestId e outro alvo: 409 REQUEST_ID_REUSED', async () => {
    events.findByRequestId.mockResolvedValue(event({ toReplicas: 4 }));
    const res = await post(body());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REQUEST_ID_REUSED');
    expect(scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('motivo curto depois do trim: 400 INVALID_SCALE_REASON, sem gravar nem ler o escalador', async () => {
    const res = await post(body({ reason: '   ab   ' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_SCALE_REASON', meta: { field: 'reason' } });
    expect(events.record).not.toHaveBeenCalled();
    expect(scaler.getState).not.toHaveBeenCalled();
  });

  it('motivo de 200 caracteres com espaços nas pontas: aceito (o schema não mede antes do trim)', async () => {
    const reason = 'x'.repeat(200);
    const res = await post(body({ reason: `   ${reason}   ` }));
    expect(res.statusCode).toBe(200);
    expect(events.recordRequestedIfIdle.mock.calls[0][0].evt).toMatchObject({ reason });
  });

  it('429 do provedor: Retry-After no header', async () => {
    scaler.scaleTo.mockRejectedValue(new ScalerRateLimitedError(42));
    const res = await post(body());
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('SCALER_RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(41);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(42);
  });

  it('429 no estado ao vivo: Retry-After no header', async () => {
    scaler.getState.mockResolvedValue({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 30 });
    const res = await post(body());
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(29);
    expect(scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('erro desconhecido do escalador: 503 SCALE_REQUEST_FAILED sem a mensagem original', async () => {
    scaler.scaleTo.mockRejectedValue(new Error('Bearer rnd_secret'));
    const res = await post(body());
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SCALE_REQUEST_FAILED');
    expect(res.body).not.toContain('rnd_secret');
  });

  it('falha ao gravar o resultado depois do escalador aceitar: 200 succeeded', async () => {
    events.updateOutcome.mockRejectedValue(new Error('db'));
    const res = await post(body());
    expect(res.statusCode).toBe(200);
    expect(res.json().data.event.outcome).toBe('succeeded');
    expect(scaler.scaleTo).toHaveBeenCalledTimes(1);
  });

  it('body inválido: 400 pelo schema, sem gravar', async () => {
    for (const payload of [
      body({ reason: 'ab' }),
      body({ reason: 'x'.repeat(201) }),
      body({ reason: 'x'.repeat(1001) }),
      body({ reason: '     ' }),
      body({ requestId: 'nao-e-uuid' }),
      body({ replicas: 2.5 }),
      { replicas: 3, reason: 'pico de sessões' },
    ]) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(events.record).not.toHaveBeenCalled();
    expect(scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('campo extra: removido pelo `additionalProperties: false` (padrão do Fastify), não chega ao use case', async () => {
    const res = await post(body({ extra: true, actorUserId: 'outro' }));
    expect(res.statusCode).toBe(200);
    expect(events.recordRequestedIfIdle.mock.calls[0][0].evt).toMatchObject({ actorUserId: 'user-a' });
    expect(events.recordRequestedIfIdle.mock.calls[0][0].evt).not.toHaveProperty('extra');
  });

  it('fora da faixa: 400 com meta.field', async () => {
    const res = await post(body({ replicas: 9 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SCALE_TARGET_OUT_OF_RANGE');
    expect(scaler.scaleTo).not.toHaveBeenCalled();
  });

  type RejectCase = [name: string, arrange: () => unknown, code: string, replicas?: number];
  it.each<RejectCase>([
    ['modo off', () => useSettings({ scalerMode: 'off' }), 'SCALER_MODE_OFF'],
    ['adoção desligada', () => { adoption.enabled = false; }, 'ADOPTION_DISABLED'],
    ['não configurado', () => scaler.getState.mockResolvedValue({ status: 'not_configured', missing: ['RENDER_API_KEY'] }), 'SCALER_NOT_CONFIGURED'],
    ['intervalo mínimo', () => events.lastCooldownStartAt.mockResolvedValue(new Date(Date.now() - 60_000)), 'SCALE_COOLDOWN_ACTIVE'],
    ['alvo igual ao atual', () => undefined, 'SCALE_TARGET_UNCHANGED', 2],
    ['redução sem vaga', () => undefined, 'SCALE_DOWN_WOULD_EXCEED_CAPACITY', 1],
  ])('%s: 409 sem chamar scaleTo', async (_name, arrange, code, replicas = 3) => {
    arrange();
    const res = await post(body({ replicas }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe(code);
    expect(scaler.scaleTo).not.toHaveBeenCalled();
  });

  it('redução sem amostra de conectadas usa a contagem ao vivo do banco', async () => {
    listSince.mockResolvedValue([]);
    const read = vi.spyOn(PrismaWorkerCapacityReader.prototype, 'readByPlan').mockResolvedValue([{
      planSlug: 'pro', tenants: 1,
      contracted: { whatsapp: 0, telegram: 0 }, unlimitedTenants: { whatsapp: 0, telegram: 0 },
      created: { whatsapp: 30, telegram: 0 }, connected: { whatsapp: 25, telegram: 0 },
    }]);
    const res = await post(body({ replicas: 1 }));
    expect(read).toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCALE_DOWN_WOULD_EXCEED_CAPACITY');
  });
});

describe('GET /admin/workers/scale/events', () => {
  it('página do servidor com cursor assinado; eventos sem ator', async () => {
    events.list.mockResolvedValueOnce({ items: [event({ id: 9 }), event({ id: 8, trigger: 'auto', actorUserId: null })], nextBeforeId: 8 });
    const first = await app.inject({ method: 'GET', url: `${URL}/events` });
    expect(first.statusCode).toBe(200);
    expect(events.list).toHaveBeenLastCalledWith({ beforeId: null, limit: WORKER_SCALE_EVENTS_PAGE_SIZE });
    const data = first.json().data;
    expect(data.items).toEqual([publicEvent(event({ id: 9 })), publicEvent(event({ id: 8, trigger: 'auto' }))]);
    expect(first.body).not.toContain('actorUserId');
    expect(data.nextCursor).toEqual(expect.any(String));

    events.list.mockResolvedValueOnce({ items: [event({ id: 3 })], nextBeforeId: null });
    const second = await app.inject({ method: 'GET', url: `${URL}/events?cursor=${encodeURIComponent(data.nextCursor)}` });
    expect(events.list).toHaveBeenLastCalledWith({ beforeId: 8, limit: WORKER_SCALE_EVENTS_PAGE_SIZE });
    expect(second.json().data.nextCursor).toBeNull();
  });

  it('cursor adulterado ou de outro recurso: recomeça do início', async () => {
    await app.inject({ method: 'GET', url: `${URL}/events?cursor=abc.def` });
    expect(events.list).toHaveBeenLastCalledWith({ beforeId: null, limit: WORKER_SCALE_EVENTS_PAGE_SIZE });
  });
});
