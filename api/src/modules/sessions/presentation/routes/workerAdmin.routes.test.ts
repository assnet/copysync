import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { workerAdminRoutes } from './workerAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositórios espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const adoption = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => ({ enabled: adoption.enabled, maxSessions: 40, shard: null }),
}));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/admin/workers';
const seenAt = new Date('2026-11-04T12:00:00.000Z');
let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = false;
  adoption.enabled = true;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(workerAdminRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('GET /admin/workers', () => {
  it('sem super-admin é negado e não consulta o banco', async () => {
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive');
    const res = await app.inject({ method: 'GET', url: URL });
    // superAdminHook do projeto responde 401 UNAUTHORIZED (mesmo das outras rotas /admin).
    expect(res.statusCode).toBe(401);
    expect(alive).not.toHaveBeenCalled();
  });

  it('super-admin: workers vivos com totais e aguardando', async () => {
    auth.isSuperAdmin = true;
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([
      { workerId: 'w1', role: 'worker', sessions: 3, maxSessions: 40, rssMb: 310, seenAt },
      { workerId: 'w2', role: 'all', sessions: 40, maxSessions: 40, rssMb: 900, seenAt },
    ]);
    vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity').mockResolvedValue(4);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(alive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    const { data } = res.json();
    expect(data.totals).toEqual({ workers: 2, sessions: 43, maxSessions: 80 });
    expect(data.awaiting).toBe(4);
    expect(data.workers[0]).toEqual({
      workerId: 'w1', role: 'worker', sessions: 3, maxSessions: 40, rssMb: 310, seenAt: seenAt.toISOString(),
    });
  });

  it('super-admin sem workers vivos: lista vazia ok', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([]);
    vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity').mockResolvedValue(0);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { workers: [], totals: { workers: 0, sessions: 0, maxSessions: 0 }, awaiting: 0 },
    });
  });

  it('flag de adoção desligada: resposta vazia sem consultar o banco', async () => {
    auth.isSuperAdmin = true;
    adoption.enabled = false;
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive');
    const awaiting = vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity');
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { workers: [], totals: { workers: 0, sessions: 0, maxSessions: 0 }, awaiting: 0 },
    });
    expect(alive).not.toHaveBeenCalled();
    expect(awaiting).not.toHaveBeenCalled();
  });
});
