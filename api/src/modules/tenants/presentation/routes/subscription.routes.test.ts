import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { GetTenantSubscriptionUseCase } from '../../application/use-cases/GetTenantSubscriptionUseCase';
import type { GetTenantSubscriptionOutput } from '../../application/dtos/TenantSubscriptionDto';
import { subscriptionRoutes } from './subscription.routes';

/* Fastify real + hook tolerante real (membership no prisma falso); use case espionado. */
const db = vi.hoisted(() => ({ members: new Map<string, { role: string; tenant: { status: string } }>() }));
vi.mock('../../../../shared/database/prisma.client', () => ({
  prisma: {
    tenant: { findUnique: async () => null },
    userTenant: {
      findUnique: async ({ where }: { where: { userId_tenantId: { userId: string; tenantId: string } } }) =>
        db.members.get(`${where.userId_tenantId.userId}:${where.userId_tenantId.tenantId}`) ?? null,
    },
  },
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    request.user = { userId: auth.slice(7), isSuperAdmin: false };
  },
}));

const output = (over: Partial<GetTenantSubscriptionOutput> = {}): GetTenantSubscriptionOutput => ({
  tenantName: 'Loja da Ana',
  planSlug: 'COPYSYNC_PRO',
  status: 'ACTIVE',
  suspendedAt: null,
  expiresAt: new Date('2026-12-01T03:00:00.000Z'),
  limits: [
    { key: 'whatsapp_sessions', channel: 'whatsapp', kind: 'count', used: 1, limit: 1, enabled: true },
    { key: 'offer_generations_per_day', channel: null, kind: 'daily', used: 3, limit: null, enabled: true },
    { key: 'storefront_enabled', channel: null, kind: 'feature', used: null, limit: null, enabled: false },
  ],
  ...over,
} as GetTenantSubscriptionOutput);

const get = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/api/subscription', headers });
const member = { authorization: 'Bearer u1', 'x-tenant-id': 't1' };

let app: FastifyInstance;

beforeEach(async () => {
  db.members.clear();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    properties: { success: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
  });
  await app.register(subscriptionRoutes, { prefix: '/api/subscription' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('GET /subscription', () => {
  it('200 no ACTIVE: datas ISO e slug da vitrine', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    const execute = vi.spyOn(GetTenantSubscriptionUseCase.prototype, 'execute').mockResolvedValue(output());
    const res = await get(member);
    expect(res.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith('t1');
    expect(res.json()).toEqual({
      success: true,
      data: {
        tenantName: 'Loja da Ana',
        planSlug: 'pro',
        status: 'ACTIVE',
        suspendedAt: null,
        expiresAt: '2026-12-01T03:00:00.000Z',
        limits: output().limits,
      },
    });
  });

  it.each(['SUSPENDED', 'CANCELLED'] as const)('200 no %s (hook tolerante)', async (status) => {
    db.members.set('u1:t1', { role: 'OPERATOR', tenant: { status } });
    vi.spyOn(GetTenantSubscriptionUseCase.prototype, 'execute').mockResolvedValue(
      output({ status, suspendedAt: new Date('2026-11-01T12:00:00.000Z'), expiresAt: null, planSlug: 'COPYSYNC_LITE' }),
    );
    const res = await get(member);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status, suspendedAt: '2026-11-01T12:00:00.000Z', expiresAt: null, planSlug: 'lite' });
  });

  it.each([null, 'PLANO_ANTIGO'])('slug %s fora de PLAN_SLUGS vira null', async (planSlug) => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    vi.spyOn(GetTenantSubscriptionUseCase.prototype, 'execute').mockResolvedValue(output({ planSlug }));
    expect((await get(member)).json().data.planSlug).toBeNull();
  });

  it('401 sem token', async () => {
    const execute = vi.spyOn(GetTenantSubscriptionUseCase.prototype, 'execute');
    const res = await get({ 'x-tenant-id': 't1' });
    expect(res.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('401 sem X-Tenant-Id', async () => {
    const res = await get({ authorization: 'Bearer u1' });
    expect(res.statusCode).toBe(401);
  });

  it('403 não-membro, mesmo com tenant suspenso de outro', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'SUSPENDED' } });
    const execute = vi.spyOn(GetTenantSubscriptionUseCase.prototype, 'execute');
    const res = await get({ authorization: 'Bearer intruso', 'x-tenant-id': 't1' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(execute).not.toHaveBeenCalled();
  });
});
