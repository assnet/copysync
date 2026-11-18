import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { usagePageViewRoutes } from './usagePageViews.routes';

/* Contrato HTTP sem banco: auth falsa, tenant por header, contador trocado por espião. */
const holder = vi.hoisted(() => ({
  markOnce: null as unknown as ReturnType<typeof vi.fn<(event: unknown) => Promise<void>>>,
  superAdmin: false,
  suspended: false,
}));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../infrastructure/featureUsageContainer', async () => {
  const { RecordPageViewUseCase } = await import('../../application/use-cases/RecordPageViewUseCase');
  return {
    recordPageViewUseCase: () =>
      new RecordPageViewUseCase({ recorder: { increment: vi.fn(async () => undefined), markOnce: (e) => holder.markOnce(e) }, log: { warn: vi.fn() } }),
  };
});
vi.mock('../../../../shared/http/hooks/authHook', async () => {
  const { UnauthorizedError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
      if (!request.headers.authorization) throw new UnauthorizedError();
      request.user = { userId: 'user-a', isSuperAdmin: holder.superAdmin };
    },
  };
});
vi.mock('../../../../shared/http/hooks/tenantHook', async () => {
  const { TenantSuspendedError } = await import('../../../../shared/errors/internal/TeamErrors');
  return {
    tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
      if (holder.suspended) throw new TenantSuspendedError();
      const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? 'tenant-a';
      request.tenantContext = { userId: 'user-a', tenantId, role: 'ADMIN', isSuperAdmin: holder.superAdmin };
    },
  };
});

const URL = '/api/usage/page-views';
const AUTH = { authorization: 'Bearer x' };
const flush = () => new Promise((r) => setTimeout(r, 0));
let app: FastifyInstance;

beforeEach(async () => {
  holder.markOnce = vi.fn(async () => undefined);
  holder.superAdmin = false;
  holder.suspended = false;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(usagePageViewRoutes, { prefix: '/api/usage' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const post = (payload: unknown, tenant = 'tenant-a', headers: Record<string, string> = AUTH) =>
  app.inject({ method: 'POST', url: URL, headers: { ...headers, 'x-tenant-id': tenant }, payload: payload as object });

describe('POST /usage/page-views', () => {
  it('sem token: 401 sem gravar', async () => {
    const res = await post({ key: 'view:offers' }, 'tenant-a', {});
    expect(res.statusCode).toBe(401);
    expect(holder.markOnce).not.toHaveBeenCalled();
  });

  it('204 e markOnce só com conta, chave, tipo e instante (sem usuário, URL ou IP)', async () => {
    const res = await post({ key: 'view:offers' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    await flush();
    expect(holder.markOnce).toHaveBeenCalledTimes(1);
    const event = holder.markOnce.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['at', 'featureKey', 'kind', 'tenantId']);
    expect(event).toMatchObject({ tenantId: 'tenant-a', featureKey: 'view:offers', kind: 'ACCESS' });
    expect(event.at).toBeInstanceOf(Date);
  });

  it.each([
    ['chave fora da lista', { key: 'view:admin-usage' }],
    ['chave de recurso', { key: 'offer_generator' }],
    ['sem chave', {}],
  ])('%s: 400 sem gravar', async (_l, payload) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    await flush();
    expect(holder.markOnce).not.toHaveBeenCalled();
  });

  it('campo a mais (url) é descartado pelo schema e nunca chega ao contador', async () => {
    expect((await post({ key: 'view:offers', url: '/offers?x=1' })).statusCode).toBe(204);
    await flush();
    expect(JSON.stringify(holder.markOnce.mock.calls)).not.toMatch(/offers\?|url/);
  });

  it('super admin: 204 sem gravar', async () => {
    holder.superAdmin = true;
    expect((await post({ key: 'view:offers' })).statusCode).toBe(204);
    await flush();
    expect(holder.markOnce).not.toHaveBeenCalled();
  });

  it('conta suspensa: para no tenantHook e não grava', async () => {
    holder.suspended = true;
    const res = await post({ key: 'view:offers' });
    expect(res.statusCode).toBe(403);
    await flush();
    expect(holder.markOnce).not.toHaveBeenCalled();
  });

  it('falha do contador: 204 mesmo assim', async () => {
    holder.markOnce = vi.fn(async () => {
      throw new Error('db down');
    });
    expect((await post({ key: 'view:dashboard' })).statusCode).toBe(204);
    await flush();
    expect(holder.markOnce).toHaveBeenCalledTimes(1);
  });

  it('mesma chave 5 vezes no dia: 5 × markOnce (o banco ignora as repetidas)', async () => {
    for (let i = 0; i < 5; i++) expect((await post({ key: 'view:offers' })).statusCode).toBe(204);
    await flush();
    expect(holder.markOnce).toHaveBeenCalledTimes(5);
  });

  it('limite por conta: 61ª chamada em um minuto → 429 RATE_LIMITED; outra conta segue livre', async () => {
    for (let i = 0; i < 60; i++) expect((await post({ key: 'view:offers' })).statusCode).toBe(204);
    const blocked = await post({ key: 'view:offers' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect((await post({ key: 'view:offers' }, 'tenant-b')).statusCode).toBe(204);
  });

  it('handler termina em return reply e sem onSend', () => {
    const src = readFileSync(join(__dirname, 'usagePageViews.routes.ts'), 'utf8');
    expect(src.match(/return reply;/g)).toHaveLength(1);
    expect(src).not.toMatch(/onSend|copysync|waioprime/i);
  });
});
