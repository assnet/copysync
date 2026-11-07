import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { meRoutes } from './me.routes';

/* Fastify real + use case/presenter reais; repositório e hook de auth falsos. */
const db = vi.hoisted(() => ({ users: new Map<string, { id: string; email: string; name: string }>() }));
vi.mock('../../infrastructure/repositories/PrismaUserRepository', () => ({
  PrismaUserRepository: class {
    findById = async (id: string) => db.users.get(id) ?? null;
  },
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    request.user = { userId: auth.slice(7), isSuperAdmin: false };
  },
}));

let app: FastifyInstance;
const get = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/api/me/checkout-prefill', headers });

beforeEach(async () => {
  db.users.clear();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    properties: { success: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
  });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /me/checkout-prefill', () => {
  it('401 sem login', async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.json())).not.toContain('@');
  });

  it('200 com e-mail e nome válidos, no-store e sem campo extra', async () => {
    db.users.set('u1', { id: 'u1', email: 'Ana@Exemplo.com', name: 'Ana  Souza' });
    const res = await get({ authorization: 'Bearer u1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      success: true,
      data: { email: 'ana@exemplo.com', confirmEmail: 'ana@exemplo.com', name: 'Ana Souza' },
    });
  });

  it('200 omite nome fora do padrão do gateway', async () => {
    db.users.set('u1', { id: 'u1', email: 'ana@exemplo.com', name: 'Ana #1' });
    const res = await get({ authorization: 'Bearer u1' });
    expect(res.json().data).toEqual({ email: 'ana@exemplo.com', confirmEmail: 'ana@exemplo.com' });
  });

  it('200 vazio para usuário inexistente', async () => {
    const res = await get({ authorization: 'Bearer ghost' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: {} });
  });
});
