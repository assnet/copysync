import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/* Fastify real + use case/presenter reais; repositório, leitor de produtos e auth falsos. */
const h = vi.hoisted(() => ({ rows: new Map<string, { product: string; status: 'ACTIVE' | 'INACTIVE' }[]>() }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => { request.user = { userId: 'u1', isSuperAdmin: false }; },
}));
vi.mock('../../../users/infrastructure/repositories/PrismaUserRepository', () => ({
  PrismaUserRepository: class {
    async findTenantsForUser() {
      return [
        { tenantId: 'legacy', tenantName: 'Legado', tenantSlug: 'legado', tenantStatus: 'ACTIVE', role: 'OWNER' },
        { tenantId: 'saver', tenantName: 'Novo', tenantSlug: 'novo', tenantStatus: 'ACTIVE', role: 'ADMIN' },
      ];
    }
  },
}));
vi.mock('../../infrastructure/repositories/PrismaTenantProductRepository', () => ({
  PrismaTenantProductRepository: class { async findAll(tenantId: string) { return h.rows.get(tenantId) ?? []; } },
}));

import { tenantRoutes } from './tenant.routes';

let app: FastifyInstance;
beforeEach(async () => {
  h.rows.clear();
  h.rows.set('saver', [{ product: 'AFFILIATES', status: 'INACTIVE' }, { product: 'SAVER', status: 'ACTIVE' }]);
  app = Fastify();
  app.addSchema({ $id: 'ErrorResponse', type: 'object', properties: {} });
  app.addSchema({
    $id: 'TenantItem',
    type: 'object',
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, role: { type: 'string' },
      status: { type: 'string' }, products: { type: 'array', items: { type: 'string' } },
    },
  });
  await app.register(tenantRoutes, { prefix: '/api/tenants' });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('GET /tenants', () => {
  it('legado sem linha = AFFILIATES e CHAT; só-Saver = SAVER; campos antigos intactos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tenants' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'legacy', name: 'Legado', slug: 'legado', status: 'ACTIVE', role: 'OWNER', products: ['AFFILIATES', 'CHAT'] },
      { id: 'saver', name: 'Novo', slug: 'novo', status: 'ACTIVE', role: 'ADMIN', products: ['SAVER'] },
    ]);
  });
});
