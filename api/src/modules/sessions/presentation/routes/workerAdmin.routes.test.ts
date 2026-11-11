import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { workerAdminRoutes } from './workerAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { PrismaSessionLeaseHolderRepository } from '../../infrastructure/repositories/PrismaSessionLeaseHolderRepository';
import { PrismaWorkerScalingSettingsRepository } from '../../infrastructure/repositories/PrismaWorkerScalingSettingsRepository';
import { RefreshingWorkerScalingSettingsProvider } from '../../infrastructure/lease/RefreshingWorkerScalingSettingsProvider';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { WorkerScalingSettingsConflictError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositórios espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const adoption = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => ({ enabled: adoption.enabled, shard: null }),
  workerScalingEnvDefaults: () => ({ maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50 }),
}));
// A rota não importa Prisma; o container das factories sim (só importa, sem I/O).
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

const SETTINGS_URL = `${URL}/settings`;
const savedAt = new Date('2026-11-10T09:00:00.000Z');
const fullSettings = {
  maxSessionsPerWorker: 60,
  maxPendingLoginsPerWorker: 20,
  alertOccupancyRatio: 0.8,
  awaitingAlertSeconds: 120,
  scalerMode: 'manual',
  minReplicas: 1,
  maxReplicas: 3,
  scaleUpSustainSeconds: 900,
  scaleCooldownSeconds: 1800,
};

describe('/admin/workers/settings', () => {
  it('sem super-admin: GET e PUT negados sem tocar no banco', async () => {
    const get = vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'get');
    const save = vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'save');
    expect((await app.inject({ method: 'GET', url: SETTINGS_URL })).statusCode).toBe(401);
    const put = await app.inject({ method: 'PUT', url: SETTINGS_URL, payload: { settings: fullSettings, expectedUpdatedAt: null } });
    expect(put.statusCode).toBe(401);
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('GET sem linha salva: defaults da env, origem default e updatedAt null', async () => {
    auth.isSuperAdmin = true;
    adoption.enabled = false;
    vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'get').mockResolvedValue(null);
    vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: SETTINGS_URL });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.settings).toMatchObject({ maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50, scalerMode: 'off' });
    expect(Object.values(body.data.origin).every((o) => o === 'default')).toBe(true);
    expect(body.data.updatedAt).toBeNull();
    expect(body.data.enforced).toBe(false);
  });

  it('GET com a flag só no worker (processo http): batimento vivo = enforced', async () => {
    auth.isSuperAdmin = true;
    adoption.enabled = false;
    vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'get').mockResolvedValue(null);
    const alive = vi.spyOn(PrismaWorkerHeartbeatRepository.prototype, 'listAlive').mockResolvedValue([
      { workerId: 'w1', role: 'worker', sessions: 0, pendingLogins: 0, maxSessions: 40, rssMb: 1, seenAt },
    ]);
    const res = await app.inject({ method: 'GET', url: SETTINGS_URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.enforced).toBe(true);
    expect(alive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
  });

  it('PUT grava, audita, aplica no processo e devolve o novo estado', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'get').mockResolvedValue(null);
    const save = vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'save')
      .mockResolvedValue({ value: fullSettings, updatedAt: savedAt, updatedById: 'user-a' });
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined as never);
    const refresh = vi.spyOn(RefreshingWorkerScalingSettingsProvider.prototype, 'refresh').mockResolvedValue();
    const res = await app.inject({ method: 'PUT', url: SETTINGS_URL, payload: { settings: fullSettings, expectedUpdatedAt: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ settings: fullSettings, updatedAt: savedAt.toISOString(), enforced: true });
    expect(Object.values(res.json().data.origin).every((o) => o === 'saved')).toBe(true);
    expect(save).toHaveBeenCalledWith(fullSettings, 'user-a', null);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', action: 'WORKER_SCALING_SETTINGS_CHANGED' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('PUT com campo fora da faixa: 400 com meta.field, sem gravar', async () => {
    auth.isSuperAdmin = true;
    const save = vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'save');
    const res = await app.inject({
      method: 'PUT', url: SETTINGS_URL, payload: { settings: { ...fullSettings, maxSessionsPerWorker: 0 }, expectedUpdatedAt: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_WORKER_SCALING_SETTINGS', meta: { field: 'maxSessionsPerWorker' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('PUT sem settings: 400 pelo schema do body', async () => {
    auth.isSuperAdmin = true;
    const res = await app.inject({ method: 'PUT', url: SETTINGS_URL, payload: { expectedUpdatedAt: null } });
    expect(res.statusCode).toBe(400);
  });

  it('PUT com updatedAt desatualizado: 409 sem auditar nem aplicar', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'get')
      .mockResolvedValue({ value: fullSettings, updatedAt: savedAt, updatedById: 'user-b' });
    vi.spyOn(PrismaWorkerScalingSettingsRepository.prototype, 'save').mockRejectedValue(new WorkerScalingSettingsConflictError());
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create');
    const refresh = vi.spyOn(RefreshingWorkerScalingSettingsProvider.prototype, 'refresh');
    const res = await app.inject({
      method: 'PUT', url: SETTINGS_URL, payload: { settings: fullSettings, expectedUpdatedAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WORKER_SCALING_SETTINGS_CONFLICT');
    expect(audit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
