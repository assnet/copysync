import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { SetTenantProductUseCase } from '../../application/use-cases/SetTenantProductUseCase';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, use case espionado. */
const auth = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => { request.user = { userId: 'admin-1', isSuperAdmin: auth.isSuperAdmin }; },
}));

import { tenantProductAdminRoutes } from './tenantProductAdmin.routes';
import { marketplaceRiskAdminRoutes } from '../../../integrations/presentation/routes/marketplaceRiskAdmin.routes';

const URL = '/api/admin/tenants';
let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = true;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addSchema({ $id: 'ErrorResponse', type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'object', additionalProperties: true } } });
  await app.register(marketplaceRiskAdminRoutes, { prefix: URL });
  await app.register(tenantProductAdminRoutes, { prefix: URL });
  await app.ready();
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); });

describe('PUT /admin/tenants/:tenantId/products/:product', () => {
  it('super admin → 200 e repassa parâmetros (convive com marketplaceRiskAdminRoutes no mesmo prefixo)', async () => {
    const spy = vi.spyOn(SetTenantProductUseCase.prototype, 'execute')
      .mockResolvedValue({ tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'ADMIN' });
    const res = await app.inject({ method: 'PUT', url: `${URL}/t1/products/SAVER`, payload: { status: 'ACTIVE', planSlug: 'SAVER_PRO' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'ADMIN' } });
    expect(spy).toHaveBeenCalledWith({ tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', actorUserId: 'admin-1' });
  });

  it('não super admin → 401 sem gravar', async () => {
    auth.isSuperAdmin = false;
    const spy = vi.spyOn(SetTenantProductUseCase.prototype, 'execute');
    expect((await app.inject({ method: 'PUT', url: `${URL}/t1/products/SAVER`, payload: { status: 'ACTIVE' } })).statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('status inválido → 400', async () => {
    const spy = vi.spyOn(SetTenantProductUseCase.prototype, 'execute');
    expect((await app.inject({ method: 'PUT', url: `${URL}/t1/products/SAVER`, payload: { status: 'ON' } })).statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('CHAT → 400 pelo use case', async () => {
    const res = await app.inject({ method: 'PUT', url: `${URL}/t1/products/CHAT`, payload: { status: 'ACTIVE' } });
    expect(res.statusCode).toBe(400);
  });
});
