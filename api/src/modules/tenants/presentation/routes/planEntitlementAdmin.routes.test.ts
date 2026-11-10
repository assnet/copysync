import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { planEntitlementAdminRoutes } from './planEntitlementAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { ListAdminPlanEntitlementsUseCase } from '../../application/use-cases/ListAdminPlanEntitlementsUseCase';
import { SetPlanEntitlementUseCase } from '../../application/use-cases/SetPlanEntitlementUseCase';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, use cases espionados no protótipo. */
const auth = vi.hoisted(() => ({ loggedIn: true, isSuperAdmin: false }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', async () => {
  const { UnauthorizedError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    authHook: async (request: { user?: unknown }) => {
      if (!auth.loggedIn) throw new UnauthorizedError('Missing token');
      request.user = { userId: 'admin-1', isSuperAdmin: auth.isSuperAdmin };
    },
  };
});

const URL = '/api/admin/plan-entitlements';
const PUT_OK = `${URL}/COPYSYNC_PRO/marketplace_shein_enabled`;
let app: FastifyInstance;

beforeEach(async () => {
  auth.loggedIn = true;
  auth.isSuperAdmin = true;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(planEntitlementAdminRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('GET /admin/plan-entitlements', () => {
  it('sem login → 401, sem consultar', async () => {
    auth.loggedIn = false;
    const spy = vi.spyOn(ListAdminPlanEntitlementsUseCase.prototype, 'execute');
    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('não super admin → 401 (superAdminHook lança UnauthorizedError)', async () => {
    auth.isSuperAdmin = false;
    const spy = vi.spyOn(ListAdminPlanEntitlementsUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('super admin → 200 com planos e chaves', async () => {
    vi.spyOn(ListAdminPlanEntitlementsUseCase.prototype, 'execute').mockResolvedValue([
      { key: 'marketplace_shein_enabled', plans: { COPYSYNC_LITE: null, COPYSYNC_PRO: false, COPYSYNC_MAX: true } },
    ]);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: {
        plans: ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'],
        entitlements: [{ key: 'marketplace_shein_enabled', plans: { COPYSYNC_LITE: null, COPYSYNC_PRO: false, COPYSYNC_MAX: true } }],
      },
    });
  });
});

describe('PUT /admin/plan-entitlements/:planSlug/:key', () => {
  it('sem login → 401; não super admin → 401; sem gravar', async () => {
    const spy = vi.spyOn(SetPlanEntitlementUseCase.prototype, 'execute');
    auth.loggedIn = false;
    expect((await app.inject({ method: 'PUT', url: PUT_OK, payload: { value: true } })).statusCode).toBe(401);
    auth.loggedIn = true;
    auth.isSuperAdmin = false;
    expect((await app.inject({ method: 'PUT', url: PUT_OK, payload: { value: true } })).statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('chave fora da allowlist → 400 VALIDATION_ERROR (use case real, sem transação)', async () => {
    const res = await app.inject({ method: 'PUT', url: `${URL}/COPYSYNC_PRO/storefront_enabled`, payload: { value: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('plano inválido → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'PUT', url: `${URL}/COPYSYNC_GOLD/marketplace_shein_enabled`, payload: { value: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('corpo sem boolean → 400', async () => {
    const spy = vi.spyOn(SetPlanEntitlementUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'PUT', url: PUT_OK, payload: { value: 'yes' } });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ok → 200 e chama o use case com o super admin como autor', async () => {
    const spy = vi.spyOn(SetPlanEntitlementUseCase.prototype, 'execute').mockResolvedValue({
      planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, tenantsUpdated: 4,
    });
    const res = await app.inject({ method: 'PUT', url: PUT_OK, payload: { value: true } });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith({ planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, actorUserId: 'admin-1' });
    expect(res.json()).toEqual({ success: true, data: { planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, tenantsUpdated: 4 } });
  });
});
