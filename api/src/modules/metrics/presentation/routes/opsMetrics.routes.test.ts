import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { opsMetricsRoutes } from './opsMetrics.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaOpsMetricsSampleRepository } from '../../infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { PrismaWorkerHeartbeatRepository } from '../../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { OPS_METRICS_PAGE_SIZE } from '../../application/use-cases/ListOpsMetricsUseCase';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositórios espionados no protótipo; sem fetch. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/admin/ops/metrics';
const at = new Date('2026-11-09T11:55:00.000Z');
const seenAt = new Date('2026-11-09T11:59:30.000Z');
let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = false;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(opsMetricsRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('GET /admin/ops/metrics', () => {
  it('sem super-admin é negado e não consulta o banco', async () => {
    const page = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'listPage');
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive');
    const res = await app.inject({ method: 'GET', url: URL });
    // superAdminHook do projeto responde 401 UNAUTHORIZED (mesmo das outras rotas /admin).
    expect(res.statusCode).toBe(401);
    expect(page).not.toHaveBeenCalled();
    expect(alive).not.toHaveBeenCalled();
  });

  it('super-admin: filtros chegam ao repositório; amostras e workers em ISO, sem chamar a rede', async () => {
    auth.isSuperAdmin = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const page = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'listPage').mockResolvedValue([
      { at, source: 'render', resource: 'srv-a', metric: 'cpu_pct', value: 42.5, meta: { min: 10, max: 80, n: 5, unit: 'pct' } },
    ]);
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([
      { workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 0, maxSessions: 40, rssMb: 310, cpuPct: 12.5, eventLoopP99Ms: null, seenAt },
      { workerId: 'w2', role: 'all', sessions: 1, pendingLogins: 0, maxSessions: 40, rssMb: 200, seenAt },
    ]);
    const res = await app.inject({
      method: 'GET', url: `${URL}?metric=cpu_pct&from=2026-11-09T00:00:00.000Z&to=2026-11-09T12:00:00.000Z`,
    });
    expect(res.statusCode).toBe(200);
    expect(page).toHaveBeenCalledWith(
      { metric: 'cpu_pct', from: new Date('2026-11-09T00:00:00.000Z'), to: new Date('2026-11-09T12:00:00.000Z') }, 0, OPS_METRICS_PAGE_SIZE + 1,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.json()).toEqual({
      success: true,
      data: {
        window: { from: '2026-11-09T00:00:00.000Z', to: '2026-11-09T12:00:00.000Z' },
        samples: [{ at: at.toISOString(), source: 'render', resource: 'srv-a', metric: 'cpu_pct', value: 42.5, meta: { min: 10, max: 80, n: 5, unit: 'pct' } }],
        nextCursor: null,
        workers: [
          { workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 0, maxSessions: 40, rssMb: 310, cpuPct: 12.5, eventLoopP99Ms: null, seenAt: seenAt.toISOString() },
          { workerId: 'w2', role: 'all', sessions: 1, pendingLogins: 0, maxSessions: 40, rssMb: 200, cpuPct: null, eventLoopP99Ms: null, seenAt: seenAt.toISOString() },
        ],
      },
    });
  });

  it('cursor: página seguinte com o cursor devolvido; limit/offset do cliente são ignorados', async () => {
    auth.isSuperAdmin = true;
    const rows = Array.from({ length: OPS_METRICS_PAGE_SIZE + 1 }, (_, i) => ({
      at: new Date(at.getTime() - i * 300_000), source: 'render' as const, resource: 'srv-a', metric: 'cpu_pct', value: i, meta: null,
    }));
    const page = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'listPage').mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([]);
    const q = 'from=2026-11-08T12:00:00.000Z&to=2026-11-09T12:00:00.000Z';
    const first = await app.inject({ method: 'GET', url: `${URL}?${q}&limit=99999&offset=7` });
    expect(first.statusCode).toBe(200);
    const body = first.json().data;
    expect(body.samples).toHaveLength(OPS_METRICS_PAGE_SIZE);
    expect(body.nextCursor).toEqual(expect.any(String));
    expect(page).toHaveBeenLastCalledWith(expect.anything(), 0, OPS_METRICS_PAGE_SIZE + 1);

    const second = await app.inject({ method: 'GET', url: `${URL}?${q}&cursor=${encodeURIComponent(body.nextCursor)}` });
    expect(second.statusCode).toBe(200);
    expect(page).toHaveBeenLastCalledWith(expect.anything(), OPS_METRICS_PAGE_SIZE, OPS_METRICS_PAGE_SIZE + 1);
    expect(second.json().data.nextCursor).toBeNull();
  });

  it('valida metric, datas e janela', async () => {
    auth.isSuperAdmin = true;
    const page = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'listPage');
    for (const qs of ['metric=CPU;drop', 'from=ontem', 'from=2026-11-09T12:00:00Z&to=2026-11-09T00:00:00Z', 'from=2026-10-01T00:00:00Z&to=2026-11-09T00:00:00Z']) {
      const res = await app.inject({ method: 'GET', url: `${URL}?${qs}` });
      expect(res.statusCode, qs).toBe(400);
    }
    expect(page).not.toHaveBeenCalled();
  });
});

describe('GET /admin/ops/metrics/series e /latest', () => {
  it('sem super-admin: 401 nas duas e não consulta o banco', async () => {
    const agg = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'aggregate');
    const last = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'latestSince');
    for (const path of ['/series', '/latest']) {
      expect((await app.inject({ method: 'GET', url: `${URL}${path}` })).statusCode, path).toBe(401);
    }
    expect(agg).not.toHaveBeenCalled();
    expect(last).not.toHaveBeenCalled();
  });

  it('series: métricas por vírgula, baldes e kind no contrato; sem rede', async () => {
    auth.isSuperAdmin = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const agg = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'aggregate').mockResolvedValue([
      { source: 'render', resource: 'srv-a', metric: 'cpu_pct', at, avg: 42.5, min: 10, max: 80 },
    ]);
    const res = await app.inject({
      method: 'GET', url: `${URL}/series?metrics=cpu_pct,memory_pct&from=2026-11-09T00:00:00.000Z&to=2026-11-09T12:00:00.000Z&resource=srv-a`,
    });
    expect(res.statusCode).toBe(200);
    expect(agg).toHaveBeenCalledWith({
      metrics: ['cpu_pct', 'memory_pct'], resource: 'srv-a',
      from: new Date('2026-11-09T00:00:00.000Z'), to: new Date('2026-11-09T12:00:00.000Z'), bucketMinutes: 5,
      maxSeries: 40, maxStatementSeries: 10,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.json()).toEqual({
      success: true,
      data: {
        window: { from: '2026-11-09T00:00:00.000Z', to: '2026-11-09T12:00:00.000Z' },
        bucketMinutes: 5,
        series: [{ resource: 'srv-a', kind: 'api', metric: 'cpu_pct', points: [{ at: at.toISOString(), avg: 42.5, min: 10, max: 80 }] }],
      },
    });
  });

  it('series: 400 para métrica inválida/desconhecida, >12, janela e datas', async () => {
    auth.isSuperAdmin = true;
    const agg = vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'aggregate');
    const many = Array.from({ length: 13 }, () => 'cpu_pct').join(',');
    const thirteen = 'cpu,cpu_pct,memory,memory_pct,rss_mb,node_cpu_pct,event_loop_p99_ms,db_connections,db_xact_commit,db_xact_rollback,db_deadlocks,db_temp_bytes,db_cache_hit_pct';
    for (const qs of [
      'metrics=CPU;drop', 'metrics=nao_existe', `metrics=${thirteen}`, 'metrics=cpu_pct,', 'resource=a%20b', 'from=ontem',
      'from=2026-11-09T12:00:00Z&to=2026-11-09T00:00:00Z', 'from=2026-11-01T00:00:00Z&to=2026-11-09T00:00:01Z',
    ]) {
      expect((await app.inject({ method: 'GET', url: `${URL}/series?${qs}` })).statusCode, qs).toBe(400);
    }
    expect(agg).not.toHaveBeenCalled();
    // repetida 13 vezes vira 1 métrica: aceita
    vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'aggregate').mockResolvedValue([]);
    expect((await app.inject({ method: 'GET', url: `${URL}/series?metrics=${many}` })).statusCode).toBe(200);
  });

  it('latest: valores, limiares, top consultas, sampler e workers', async () => {
    auth.isSuperAdmin = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'latestSince').mockResolvedValue([
      { at, source: 'worker', resource: 'w1', metric: 'rss_mb', value: 310, meta: { min: 300, max: 320, n: 5 } },
    ]);
    vi.spyOn(PrismaOpsMetricsSampleRepository.prototype, 'latestStatementSnapshot').mockResolvedValue([
      { at, source: 'postgres', resource: '123', metric: 'db_statement_total_ms', value: 50, meta: { calls: 5, meanMs: 10, shape: 'SELECT 1' } },
    ]);
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([
      { workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 0, maxSessions: 40, rssMb: 310, seenAt },
    ]);
    const res = await app.inject({ method: 'GET', url: `${URL}/latest` });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.json()).toEqual({
      success: true,
      data: {
        latest: [{ resource: 'w1', kind: 'worker', metric: 'rss_mb', value: 310, at: at.toISOString() }],
        thresholds: { memoryPct: 80, cpuPct: 80, idleInTransaction: 3, eventLoopP99Ms: 200 },
        topQueries: [{ queryid: '123', shape: 'SELECT 1', totalMs: 50, meanMs: 10, calls: 5, at: at.toISOString() }],
        samplerActive: expect.any(Boolean),
        workers: [{ workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 0, maxSessions: 40, rssMb: 310, cpuPct: null, eventLoopP99Ms: null, seenAt: seenAt.toISOString() }],
        workerInstances: [],
      },
    });
  });
});
