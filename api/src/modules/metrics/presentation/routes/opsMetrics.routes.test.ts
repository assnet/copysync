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
