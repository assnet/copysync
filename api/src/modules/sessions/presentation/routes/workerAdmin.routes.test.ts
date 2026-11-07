import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { workerAdminRoutes } from './workerAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { PrismaSessionLeaseHolderRepository } from '../../infrastructure/repositories/PrismaSessionLeaseHolderRepository';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositórios espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const adoption = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => ({ enabled: adoption.enabled, maxSessions: 40, maxPendingLogins: 50, shard: null }),
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
      { workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 2, maxSessions: 40, rssMb: 310, seenAt },
      { workerId: 'w2', role: 'all', sessions: 40, pendingLogins: 0, maxSessions: 40, rssMb: 900, seenAt },
    ]);
    vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity').mockResolvedValue(4);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(alive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    const { data } = res.json();
    expect(data.adoptionEnabled).toBe(true);
    expect(data.processes).toEqual([]);
    expect(data.leasedSessions).toBe(0);
    expect(data.totals).toEqual({ workers: 2, sessions: 43, pendingLogins: 2, maxSessions: 80 });
    expect(data.awaiting).toBe(4);
    expect(data.workers[0]).toEqual({
      workerId: 'w1', role: 'worker', sessions: 3, pendingLogins: 2, maxSessions: 40, rssMb: 310, seenAt: seenAt.toISOString(),
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
      data: {
        adoptionEnabled: true,
        workers: [],
        totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 },
        awaiting: 0,
        processes: [],
        leasedSessions: 0,
      },
    });
  });

  it('adoção ligada não consulta os leases', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([]);
    vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity').mockResolvedValue(0);
    const holders = vi.spyOn(PrismaSessionLeaseHolderRepository.prototype, 'listLiveHolders');
    await app.inject({ method: 'GET', url: URL });
    expect(holders).not.toHaveBeenCalled();
  });

  it('adoção desligada: processos pelos leases vivos, sem heartbeat nem adoção', async () => {
    auth.isSuperAdmin = true;
    adoption.enabled = false;
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive');
    const awaiting = vi.spyOn(PrismaSessionAdoptionRepository.prototype, 'countAwaitingCapacity');
    vi.spyOn(PrismaSessionLeaseHolderRepository.prototype, 'listLiveHolders').mockResolvedValue([
      { workerId: 'api-1', sessions: 5, leaseUntil: seenAt },
      { workerId: 'api-2', sessions: 1, leaseUntil: seenAt },
    ]);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: {
        adoptionEnabled: false,
        workers: [],
        totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 },
        awaiting: 0,
        processes: [
          { workerId: 'api-1', sessions: 5, leaseUntil: seenAt.toISOString() },
          { workerId: 'api-2', sessions: 1, leaseUntil: seenAt.toISOString() },
        ],
        leasedSessions: 6,
      },
    });
    expect(alive).not.toHaveBeenCalled();
    expect(awaiting).not.toHaveBeenCalled();
  });

  it('adoção desligada sem lease vivo: lista vazia', async () => {
    auth.isSuperAdmin = true;
    adoption.enabled = false;
    vi.spyOn(PrismaSessionLeaseHolderRepository.prototype, 'listLiveHolders').mockResolvedValue([]);
    const { data } = (await app.inject({ method: 'GET', url: URL })).json();
    expect(data).toMatchObject({ adoptionEnabled: false, processes: [], leasedSessions: 0 });
  });
});
