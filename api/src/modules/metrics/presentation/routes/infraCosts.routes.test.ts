import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { infraCostsRoutes } from './infraCosts.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaInfraCostSettingsRepository } from '../../infrastructure/repositories/PrismaInfraCostSettingsRepository';
import { PrismaInfraCostLiveReader } from '../../infrastructure/repositories/PrismaInfraCostLiveReader';
import { PrismaWorkerCapacityReader } from '../../../sessions/infrastructure/repositories/PrismaWorkerCapacityReader';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { InfraCostSettingsConflictError } from '../../../../shared/errors/internal/InfraCostErrors';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { PrismaInfraCostSnapshotRepository } from '../../infrastructure/repositories/PrismaInfraCostSnapshotRepository';
import { PrismaInfraFxFetchStateRepository } from '../../infrastructure/repositories/PrismaInfraFxFetchStateRepository';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositórios espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../shared/config/env')>();
  return { env: { ...mod.env, WORKER_SCALER_SERVICE_ID: 'srv-teste' } };
});
vi.mock('../../../sessions/infrastructure/lease/sessionLeaseContainer', () => ({
  workerScalingSettingsProvider: () => ({
    current: () => ({ value: { maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50, alertOccupancyRatio: 0.8 }, origin: {} }),
  }),
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'admin-1', isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/admin/costs';
const SAVED_AT = new Date('2026-11-10T10:00:00.000Z');
let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = false;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(infraCostsRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await app.close();
});

describe('auth', () => {
  it.each([
    ['GET', '/settings'],
    ['PUT', '/settings'],
    ['GET', '/summary'],
  ] as const)('%s %s sem super admin: 401 sem ler o banco', async (method, path) => {
    const get = vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'get');
    const res = await app.inject({ method, url: `${URL}${path}`, payload: method === 'PUT' ? { settings: {}, expectedUpdatedAt: null } : undefined });
    expect(res.statusCode).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('GET/PUT /admin/costs/settings', () => {
  it('GET sem linha: valores iniciais', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'get').mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: `${URL}/settings` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ settings: defaultInfraCostSettings(), origin: 'default', updatedAt: null });
  });

  it('PUT grava, audita e devolve a view', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'get').mockResolvedValue(null);
    const save = vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'save')
      .mockImplementation(async (value) => ({ value, updatedAt: SAVED_AT, updatedById: 'admin-1' }));
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue();
    const settings = defaultInfraCostSettings();
    const res = await app.inject({ method: 'PUT', url: `${URL}/settings`, payload: { settings, expectedUpdatedAt: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ settings, origin: 'saved', updatedAt: SAVED_AT.toISOString() });
    expect(save).toHaveBeenCalledWith(settings, 'admin-1', null);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'INFRA_COST_SETTINGS_CHANGED', userId: 'admin-1' }));
  });

  it('PUT inválido: 400 com meta.field', async () => {
    auth.isSuperAdmin = true;
    const save = vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'save');
    const settings = { ...defaultInfraCostSettings(), extra: 1 };
    const res = await app.inject({ method: 'PUT', url: `${URL}/settings`, payload: { settings, expectedUpdatedAt: null } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_INFRA_COST_SETTINGS', meta: { field: 'extra' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('PUT com outro admin antes: 409', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'get').mockResolvedValue(null);
    vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'save').mockRejectedValue(new InfraCostSettingsConflictError());
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create');
    const res = await app.inject({
      method: 'PUT', url: `${URL}/settings`,
      payload: { settings: defaultInfraCostSettings(), expectedUpdatedAt: SAVED_AT.toISOString() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INFRA_COST_SETTINGS_CONFLICT');
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('GET /admin/costs/summary', () => {
  beforeEach(() => {
    vi.spyOn(PrismaInfraCostSnapshotRepository.prototype, 'latestFxRate').mockResolvedValue(null);
    vi.spyOn(PrismaInfraFxFetchStateRepository.prototype, 'get').mockResolvedValue(null);
  });

  function stubReads(sessionsSampledAt: Date = new Date()) {
    const settings = defaultInfraCostSettings();
    settings.fx.override = { rate: 5.5, date: '2026-11-10' };
    vi.spyOn(PrismaInfraCostSettingsRepository.prototype, 'get')
      .mockResolvedValue({ value: settings, updatedAt: SAVED_AT, updatedById: 'admin-1' });
    vi.spyOn(PrismaInfraCostLiveReader.prototype, 'read').mockResolvedValue({
      sessionsConnected: 5, sessionsCapacity: 40, sessionsSampledAt, workerInstances: 2,
    });
    const ch = (whatsapp = 0, telegram = 0) => ({ whatsapp, telegram });
    vi.spyOn(PrismaWorkerCapacityReader.prototype, 'readByPlan').mockResolvedValue([
      { planSlug: 'COPYSYNC_LITE', tenants: 2, contracted: ch(2), unlimitedTenants: ch(), created: ch(2), connected: ch(2) },
      { planSlug: null, tenants: 1, contracted: ch(1), unlimitedTenants: ch(), created: ch(1), connected: ch(1) },
    ]);
  }

  it('mês corrente: contrato do painel, sem id da Render nem preço de plano do produto', async () => {
    auth.isSuperAdmin = true;
    stubReads();
    const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.month).toBe(new Date().toISOString().slice(0, 7));
    expect(data.basis).toBe('snapshot');
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
    expect(data.fx).toEqual({ rate: 5.5, referenceDate: '2026-11-10', source: 'override', fetchedAt: null, stale: expect.any(Boolean) });
    expect(data.totals.total.usd).toBe(145.25);
    expect(data.items.find((i: { key: string }) => i.key === 'email').planLabel).toBe('');
    expect(data.plans).toHaveLength(2);
    expect(Object.keys(data.plans[0]).sort()).toEqual([
      'connectedCostPerTenant', 'connectedSessions', 'connectedShare', 'contractedSessions', 'costPerTenant', 'planSlug', 'share', 'tenants',
    ]);
    expect(data.perSession.connected).toMatchObject({ sessions: 3, unallocatedSessions: 2 });
    expect(Number.isNaN(Date.parse(data.sessionsSampledAt))).toBe(false);
    expect(data.warnings.some((w: { code: string }) => w.code === 'sessions_sample_stale')).toBe(false);
    const body = res.body;
    expect(body).not.toContain('srv-');
    expect(body).not.toMatch(/"price|"margin"|"marginBrl"|"marginPct"/i);
  });

  it('mês do momento explícito: 200; outro mês: 400 INFRA_COST_MONTH_UNAVAILABLE', async () => {
    auth.isSuperAdmin = true;
    stubReads();
    const current = new Date().toISOString().slice(0, 7);
    expect((await app.inject({ method: 'GET', url: `${URL}/summary?month=${current}` })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?month=2020-01` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INFRA_COST_MONTH_UNAVAILABLE');
  });

  it('mês em formato inválido: 400 de validação', async () => {
    auth.isSuperAdmin = true;
    const res = await app.inject({ method: 'GET', url: `${URL}/summary?month=2026-13` });
    expect(res.statusCode).toBe(400);
  });

  it('amostra de sessões velha (> 10 min): não alocadas null, aviso e sessionsSampledAt ISO', async () => {
    auth.isSuperAdmin = true;
    stubReads(SAVED_AT);
    const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.sessionsSampledAt).toBe(SAVED_AT.toISOString());
    expect(data.perSession.connected).toMatchObject({ sessions: 3, unallocatedSessions: null, unallocatedCost: null });
    expect(data.warnings).toContainEqual({ code: 'sessions_sample_stale' });
  });

  it('sem amostra: sessionsSampledAt null', async () => {
    auth.isSuperAdmin = true;
    stubReads();
    vi.spyOn(PrismaInfraCostLiveReader.prototype, 'read').mockResolvedValue({
      sessionsConnected: null, sessionsCapacity: null, sessionsSampledAt: null, workerInstances: null,
    });
    const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sessionsSampledAt).toBeNull();
  });

  describe('statement_timeout (57014) → 503 INFRA_COST_READ_UNAVAILABLE', () => {
    const timeout = () =>
      new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`', {
        code: 'P2010', clientVersion: 'test', meta: { code: '57014', message: 'ERROR: canceling statement due to statement timeout' },
      });

    it('na leitura das amostras', async () => {
      auth.isSuperAdmin = true;
      stubReads();
      // `read` real (a tradução fica nele); só a consulta ao banco falha.
      vi.mocked(PrismaInfraCostLiveReader.prototype.read).mockRestore();
      vi.spyOn(PrismaInfraCostLiveReader.prototype as unknown as { query: () => Promise<unknown> }, 'query').mockRejectedValue(timeout());
      const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('INFRA_COST_READ_UNAVAILABLE');
      expect(res.body).not.toMatch(/57014|canceling|SELECT/);
    });

    it('na capacidade por plano', async () => {
      auth.isSuperAdmin = true;
      stubReads();
      vi.spyOn(PrismaWorkerCapacityReader.prototype, 'readByPlan').mockRejectedValue(timeout());
      const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('INFRA_COST_READ_UNAVAILABLE');
    });

    it('outro erro de banco segue 500', async () => {
      auth.isSuperAdmin = true;
      stubReads();
      vi.spyOn(PrismaWorkerCapacityReader.prototype, 'readByPlan').mockRejectedValue(new Error('boom'));
      const res = await app.inject({ method: 'GET', url: `${URL}/summary` });
      expect(res.statusCode).toBe(500);
    });
  });
});
